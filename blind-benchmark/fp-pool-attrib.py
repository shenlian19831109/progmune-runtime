#!/usr/bin/env python3
"""
FP 观测池违规归因器 —— R21「动工前先量化收益上限」的量尺（2026-09-21）

读 blind-benchmark/reports/fp-pool-results.json，把每条 perFunction 违规打上
「候选抑制线索」的标签，算出每条线索能消掉多少条 —— 也就是它的**收益上限**。

为什么需要它：2026-09-21 E1 轮从 18 条【新增】违规里归纳出四条「规则侧校准线索」，
但全池共有 72 条违规，新增只占 25%，而且**分布有偏**（新增偏 Input Validation，
全池第一大项却是 Data Mutation Without Audit Trail，占 36%）。归纳样本选错，
线索清单就漏项。本脚本强制从**全量**违规里量，不靠印象。

⚠ 口径声明（重要）：
  启发式打标【偏乐观】——它给的是**上限**，不是实际收益。真动手前必须逐条人工看。
  每条线索的**反面风险**（过度抑制 ⇒ 漏报）不在本脚本里，写在 leads 表的 risk 字段。

⚠ 口径声明 v2（2026-09-23 加，别删）：
  **「归因」不等于「该抑制」。** 未归因占比下降有两条路：①真理解了，找到了可操作的
  类别；②把「不知道」改名成一条新线索。②是自欺 —— 收益上限会虚高，真动手时会发现
  根本消不掉。所以本脚本把结果分成两组：

    - **抑制候选（L 系列）**：有明确判据、可实施、误伤可控 ⇒ 计入收益上限
    - **真阳性形态（T 系列）**：确认报得对，**不计入**上限。它的作用是反向护栏 ——
      防止以后有人把它当 FP 改掉

  「无归属」= 既非 L 也非 T。**只认出形态、没认出抑制手段的，仍算无归属。**

  两组判据独立编写，可能在同一条目上同时命中（既「该抑制」又「不许改」）。这叫
  **判据冲突**，脚本会单独计数并打印：冲突条目既不计入上限、也不计入形态，
  必须人工裁决后才能归类 —— 各算各的会自相矛盾。

用法：
    python3 blind-benchmark/fp-pool-attrib.py            # 全池
    python3 blind-benchmark/fp-pool-attrib.py --slice X  # 只看一个切片
    python3 blind-benchmark/fp-pool-attrib.py --dump     # 逐条列出（人工判定时用）
"""

import argparse
import collections
import json
import os
import re
import time

HERE = os.path.dirname(os.path.abspath(__file__))
RESULTS = os.path.join(HERE, "reports", "fp-pool-results.json")

# ── 线索定义 ────────────────────────────────────────────────────────────────
# 每条线索 = 一个候选「抑制/降级」机制。tag() 只做【包含式】打标（一条违规可命中多条）。
MIGRATION_CALLS = {
    "createTable", "dropTable", "createForeignKey", "dropForeignKey",
    "addColumn", "dropColumn", "createEntityManager", "runMigrations",
}
QB_CALLS = {
    "where", "andWhere", "orWhere", "getMany", "getOne", "getCount",
    "leftJoinAndSelect", "orderBy", "limit", "offset", "select", "join",
    "createQueryBuilder", "find", "findOne", "skip", "take",
}
VALIDATOR_CALLS = {
    "validate", "validateOrReject", "validateSync", "checkSchema",
    "celebrate", "joi", "zod", "yup", "schema",
}
OPS_RULES = {
    "TLS Enforcement", "Rate Limiting", "API Without Rate Limiting",
    "Notification Without Retry",
}
REGISTRATION_RULES = {
    "Password Hashing", "Password Hashing (Weak)",
    "Registration Without Email Verification",
}
# 前端 API 客户端所在目录 —— 这些函数只是发 HTTP 请求，不是后端业务主体
FRONTEND_PATH = re.compile(r"(^|/)frontend/|(^|/)client/|/web/src/|(^|/)webapp/", re.I)
# 配置 / 构造器形态（类名或文件名）
CONFIG_SHAPE = re.compile(r"(Config|Builder|Options|Settings)(?=[A-Z0-9]|\b)", re.I)
BUILDER_METHOD = re.compile(r"^(add|set|with)[A-Z0-9]", re.I)
INPUT_RULES = {
    "Input Validation", "No Input Sanitization",
    "File Upload Without Validation",
}
# 真 HTTP/GraphQL 入口所在的文件 —— 这些不该被「工厂/装配」豁免误伤
ENTRY_PATH = re.compile(r"controller|resolver|route|handler|/api/|endpoint", re.I)
FACTORY_NAME = re.compile(r"^(create|make|build|setup|init)[A-Z0-9]|Loader$|Factory$", re.I)

LEADS = {
    "L1-迁移/种子脚本豁免": {
        "idea": "TypeORM 迁移 / 种子脚本不处理外部输入，应豁免",
        "risk": "低。迁移脚本理论上可含数据处理，但无外部输入 ⇒ 抑制代价小",
    },
    "L2-ORM查询构造链": {
        "idea": "TypeORM/Prisma 查询构造链被 Input Validation 当成『缺校验』",
        "risk": "中偏高。分页/limit/offset 确实可能来自用户输入且未校验 ⇒ 一刀切会漏",
    },
    "L3-部署运维层建议降级": {
        "idea": "TLS / rate limit / retry 属部署层责任，应降级为建议级而非违规级",
        "risk": "低。本来就不是代码缺陷；降级不丢信息",
    },
    "L4-审计轨迹需前置条件": {
        "idea": "『改数据没写审计日志』应是【工程内已有审计设施】才报；全工程无审计设施 = 能力缺失，不是代码缺陷",
        "risk": "中。审计设施可能被命名成 logger/history/event ⇒ 探测不到就误抑制",
    },
    "L5-校验器词表缺口": {
        "idea": "calls 里已有 validate（class-validator）却仍报 Input Validation ⇒ 词表不认",
        "risk": "低。补词表是纯增益",
    },
    "L6-内部私有工具方法": {
        "idea": "私有/内部工具方法不应被要求做 Authorization",
        "risk": "中。私有方法也可能真处理鉴权分支 ⇒ 需看是否触及敏感资源",
    },
    "L7-工厂装配函数不是内容创建": {
        "idea": "create*/make*/build*/*Loader 是工厂与装配函数，被 Input Validation 当成『创建了内容却没校验输入』",
        "risk": "中。真创建（UserService.create）与工厂同名 ⇒ 要靠『是否接收外部输入』区分，实现成本不低",
    },
    "L8-register词义歧义": {
        "idea": "`register` 在 Fastify/Express 里是『注册插件/路由』，被当成『用户注册』，触发密码哈希与邮箱验证规则",
        "risk": "低。纯词义歧义，可用『同函数内是否出现密码/邮箱类调用』消歧",
    },
    "L9-Express中间件不是业务端点": {
        "idea": "Express/connect 中间件（(req,res,next)）被当成『认证/会话』主体，报 Session No Timeout / Input Validation",
        "risk": "中。中间件确实可能做鉴权 ⇒ 要看它是否真的终止请求（调用 res.end / 抛错）而非 next()",
    },
    "L10-框架ACL词表缺口": {
        "idea": "框架自带的 ACL 词（verdaccio 的 allow / can / deny）没被认成鉴权 ⇒ 有鉴权却报『未鉴权 / 缺归属检查』",
        "risk": "低。补词表是纯增益，但要注意 allow/can 也可能是普通单词",
    },
    "L11-registerDecorator词义歧义": {
        "idea": "class-validator 的 `registerDecorator` 被 identifierParse 拆出『register』，当成用户注册 ⇒ 触发密码哈希/邮箱验证。已证伪：NoUrls 的 calls 只有 registerDecorator/test/containsDomain，摘掉 registerDecorator 后 3 条违规全消失",
        "risk": "极低。纯词义歧义，且 registerDecorator 只有一个语义（注册校验装饰器）",
    },
    "L12-前端API客户端不是后端主体": {
        "idea": "frontend/ 下的 API 客户端函数（registerGuest/logInGuest，calls 是 sendRequest/asParsedJsonObject）只是发 HTTP 请求，却被当成后端注册/登录主体",
        "risk": "低。目录切分明确；但 monorepo 里 frontend/ 下若真有校验逻辑会误抑制 ⇒ 实施时宜叠加『calls 含 sendRequest/fetch/axios』",
    },
    "L13-配置构造器装配方法": {
        "idea": "ConfigBuilder.add*() 只写自身 config 对象（无外部输入、无业务实体），被 triggerOwnNameOnly 的 add* 判成内容创建。已证伪：addPackageAccess 的 calls 是空数组，纯靠函数名触发",
        "risk": "中。真配置校验方法也叫 add*/set* ⇒ 需叠加『不接收外部输入』（如无 req/body/DTO 形参）",
    },
}

# ── 真阳性形态（登记，不是抑制候选）──────────────────────────────────────────
# ⚠ 为什么单独列：见文件头「口径声明 v2」。把「不知道」改名成一条线索就能让
#   未归因下降，但那是自欺 —— 收益上限会虚高，动手时会发现根本消不掉。
#   这类条目的作用是【反向护栏】：确认它们是对的，防止以后被当 FP 改掉。
SHAPES = {
    "T1-业务服务写入方法": "Service/Repo 的 add*/create*（如 FavoriteService.addFavorite，calls=[insert]）真的在写业务数据 ⇒ 报 Input Validation 是对的",
    "T2-子实体创建未验父": "Data Integrity 的 add*/create*（addAlias / createToken）真的创建子实体 ⇒ 报缺外键检查是对的",
}

# 口径版本。v1 = 只有抑制候选、未区分真阳性形态；v2 = 二分 + 剔除冲突。
ATTRIB_SCHEMA = "v2"

# ---- 真值分层（导出真值集时用）------------------------------------------
# 【为什么必须分层】LEADS 里绝大多数是**启发式**打标，给的是收益「上限」，不是事实。
#   L4(132) / L7(30) / L9(22) / L6(18) / L3(17) / L8(12) / L10(7) / L1(5) 从未逐条核验过。
# 把启发式标签当 gold 去算「一致率」，等于拿猜测当标准答案 —— 判不一致时无法归因
# （可能是 jev 错，也可能是启发式错）。所以每条必须带 gold_confidence。
VERIFIED_FP_LEADS = {
    "L11-registerDecorator词义歧义",   # 3 条，摘掉 registerDecorator 后违规全消失（决定性证据）
    "L12-前端API客户端不是后端主体",     # 15 条，源码确认为 PostApiRequestBuilder，只发 HTTP
    "L13-配置构造器装配方法",           # 27 条，ConfigBuilder.add* 的 calls 为空数组
}
# 人工看过源码、确认是真业务创建的条目（前一轮 L7/T1 判据冲突时裁决出来的）
VERIFIED_TP_KEYS = {
    "docmost/GroupService.createGroup":
        "收 CreateGroupDto、带 trx 事务 ⇒ 真业务创建，不是工厂（2026-09-23 源码裁决）",
    "hedgedoc/ApiTokenService.createToken":
        "真创建 token（2026-09-23 源码裁决）",
    "hoppscotch/AdminService.createATeam":
        "调 teamService.createTeam ⇒ 真业务创建（2026-09-23 源码裁决）",
    # ↓ 2026-09-23 jev 实验前补核（TP 侧太少，会导致「永远判 FP」的傻瓜基线也拿高分）
    "hoppscotch/AdminResolver.createTeamByAdmin":
        "GraphQL Mutation，@Args 收 userUid/name 后直接 adminService.createATeam，"
        "函数体内无任何输入校验 ⇒ 报 Input Validation 是对的（源码确证）",
    "w3tecch-express-typescript-boilerplate/PetResolver.addPet":
        "@Arg('pet') pet: PetInput → new PetModel(); newPet.name = pet.name; newPet.age = pet.age "
        "直接赋值后 create，全程无校验 ⇒ 报 Input Validation 是对的（源码确证）",
    "docmost/CollabHistoryService.addContributors":
        "async addContributors(pageId, userIds) 只判 userIds.length===0 就 redis.sadd，"
        "无任何内容校验 ⇒ 报 Input Validation 是对的（源码确证）",
    "docmost/LabelService.addLabelsToPage":
        "收 names: string[]，只做 name.trim() 就 labelRepo.findOrCreate，无校验 ⇒ 报得对（源码确证）",
}

# 【核验 T1 时的实测记录，2026-09-23】抽查 10 条，**只有 2 条能确证为 TP**，其余存疑：
#   - AttachmentController.uploadFile / uploadAvatarOrLogo：其实**已有**校验措施
#     （req.file 的 limits:{fileSize,fields,files}、calls 里的 includes = mimetype 白名单）
#     ⇒ T1 判据把它们当「缺校验」，属**判据噪声**，不可当 gold
#   - AttachmentService.uploadToDrive：是 uploadFile 的内部实现，不是入口，形态更像 L6
# ⇒ 这条记录本身就是「启发式标签不能当真值」的实证 —— 见设计稿 §二十九。
# 整条线索都已核验的（目前没有 —— T1 的 29 条只有上面 3 条经过人工裁决）
VERIFIED_TP_SHAPES = set()


def tag(row: dict) -> list:
    """返回该违规命中的线索列表（可多条）。"""
    calls = set(row["calls"])
    fn = row["fn"]
    file_l = row["file"].lower()
    rule = row["rule"]
    tags = []

    if (
        "migration" in file_l
        or "/seed" in file_l
        or "seed" in file_l
        or re.search(r"Table\d+$", fn)
        or re.search(r"^\w*\.seed$", fn)
        or (calls & MIGRATION_CALLS)
    ):
        tags.append("L1-迁移/种子脚本豁免")

    if "createQueryBuilder" in calls or len(calls & QB_CALLS) >= 3:
        tags.append("L2-ORM查询构造链")

    if rule in OPS_RULES:
        tags.append("L3-部署运维层建议降级")

    if rule == "Data Mutation Without Audit Trail":
        tags.append("L4-审计轨迹需前置条件")

    if calls & VALIDATOR_CALLS and "Validation" in rule:
        tags.append("L5-校验器词表缺口")

    if fn.startswith("_") or (
        rule.startswith("Authorization") and len(calls) <= 4
    ):
        tags.append("L6-内部私有工具方法")

    # L7 的排除项（2026-09-23 由判据冲突裁决得出）：Service/Repo/Controller/Resolver
    # 里的 create* 是**真业务创建**（如 GroupService.createGroup 收 CreateGroupDto、
    # AdminService.createATeam 调 teamService.createTeam），不是工厂装配。
    # 此前未排除 ⇒ L7 把 3 条真阳性算进了自己的收益上限。
    biz_cls = re.search(r"(Service|Repo|Repository|Controller|Resolver)$",
                        fn.split(".")[0] if "." in fn else "", re.I)
    if (
        rule in INPUT_RULES
        and FACTORY_NAME.search(fn.split(".")[-1])
        and not ENTRY_PATH.search(file_l)
        and not biz_cls
    ):
        tags.append("L7-工厂装配函数不是内容创建")

    if rule in REGISTRATION_RULES and "register" in calls:
        tags.append("L8-register词义歧义")

    # Express / connect 中间件（(req,res,next)）不是业务端点，却被当成认证/会话主体。
    # 判据：calls 里出现 next，或文件在 middleware 目录下。
    if "next" in calls or "middleware" in file_l:
        tags.append("L9-Express中间件不是业务端点")

    # 框架自带的 ACL 词（verdaccio 的 allow/can/deny）没被认成鉴权 ⇒ 有鉴权却报未鉴权
    if calls & {"allow", "can", "deny"}:
        tags.append("L10-框架ACL词表缺口")

    # L11：class-validator 的 registerDecorator 被拆出 "register" ⇒ 当成用户注册。
    # 已证伪（2026-09-23）：摘掉该 call 后 NoUrls 的 3 条违规全部消失。
    if "registerDecorator" in calls and rule in REGISTRATION_RULES:
        tags.append("L11-registerDecorator词义歧义")

    # L12：frontend/ 下的 API 客户端只是发请求，不是后端主体。
    if FRONTEND_PATH.search(file_l):
        tags.append("L12-前端API客户端不是后端主体")

    # L13：Config/Builder/Options/Settings 的 add*/set*/with* 装配方法。
    cls = fn.split(".")[0] if "." in fn else ""
    base = fn.split(".")[-1]
    if (
        (CONFIG_SHAPE.search(cls) or CONFIG_SHAPE.search(file_l))
        and BUILDER_METHOD.match(base)
        and rule in INPUT_RULES
    ):
        tags.append("L13-配置构造器装配方法")

    return tags


def tag_shape(row: dict) -> list:
    """返回该违规所属的【真阳性形态】（只登记，不计入收益上限）。

    与 tag() 分开的理由见文件头「口径声明 v2」：两者混在一起会让「未归因」
    靠改名而下降，虚高收益上限。
    """
    fn = row["fn"]
    rule = row["rule"]
    cls = fn.split(".")[0] if "." in fn else ""
    base = fn.split(".")[-1]
    shapes = []

    # T1：业务服务写入方法真的在写数据 ⇒ Input Validation 报得对
    if (
        re.search(r"(Service|Repo|Repository|Controller|Resolver)$", cls, re.I)
        and re.match(r"^(add|create|post|upload|update)[A-Z0-9]", base, re.I)
        and rule in INPUT_RULES
    ):
        shapes.append("T1-业务服务写入方法")

    # T2：Data Integrity 报的子实体创建，形态正确
    if rule == "Data Integrity (Foreign Key)":
        shapes.append("T2-子实体创建未验父")

    return shapes


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--slice", default=None)
    ap.add_argument("--dump", action="store_true", help="逐条列出命中")
    ap.add_argument("--snapshot", action="store_true",
                    help="把本次读数存进 reports/fp-pool-attrib-history.json（R25 用）")
    ap.add_argument("--check-saturation", action="store_true",
                    help="比较最近两次快照，按 R25 判据判定池是否饱和")
    ap.add_argument("--export-jsonl", default=None, metavar="PATH",
                    help="导出真值集（每条一行 JSON），供 jev 实验消费")
    args = ap.parse_args()

    data = json.load(open(RESULTS))
    if args.slice:
        data = [s for s in data if args.slice in s["repo"]]

    rows = []
    for s in data:
        for f in s["perFunction"]:
            for v in f.get("safeguardViolations", []):
                rows.append(
                    dict(
                        repo=s["repo"], fn=f["name"], file=f["file"],
                        rule=v["rule"], calls=f.get("calls", []),
                    )
                )
    for r in rows:
        r["tags"] = tag(r)
        r["shapes"] = tag_shape(r)

    # ---- 导出真值集（供 jev 实验消费）------------------------------------
    # 【关键】gold 必须分层：只有人工逐条核验过的条目才是 verified。
    # 把启发式打标当 gold，等于拿猜测当标准答案 —— jev 与它不一致时无法归因
    # （可能是 jev 错，也可能是启发式错）。所以置信度必须随条目一起导出。
    if args.export_jsonl:
        out = []
        for r in rows:
            # 用「列表非空」判有无线索，不能用独占 ——
            # 命中多条线索的条目若按独占算，会被误归入 UNKNOWN（本次实测差 17 条）。
            lead_list = list(r["tags"])
            shape_list = list(r["shapes"])
            lead = lead_list[0] if len(lead_list) == 1 else None
            shape = shape_list[0] if len(shape_list) == 1 else None
            key = f"{r['repo']}/{r['fn']}"
            if lead_list and shape_list:
                gold, conf, why = "EXCLUDED", "unlabeled", "判据冲突，待人工裁决"
            elif lead_list:
                # 只有「命中的全部线索都已核验」才算 verified；
                # 混了启发式标签的条目不予升级（保守，防虚高）
                if lead_list and set(lead_list) <= VERIFIED_FP_LEADS:
                    gold, conf = "FP", "verified"
                    why = f"{'+'.join(lead_list)} 已逐条人工核验（见设计稿 §二十八）"
                else:
                    gold, conf = "FP", "heuristic"
                    why = f"{'+'.join(lead_list)} 仅启发式打标，未经逐条核验"
            elif shape_list:
                if key in VERIFIED_TP_KEYS or set(shape_list) <= VERIFIED_TP_SHAPES:
                    gold, conf = "TP", "verified"
                    why = VERIFIED_TP_KEYS.get(key, f"{'+'.join(shape_list)} 已核验")
                else:
                    gold, conf = "TP", "heuristic"
                    why = f"{'+'.join(shape_list)} 仅判据匹配，未经逐条核验"
            else:
                gold, conf, why = "UNKNOWN", "unlabeled", "无任何线索命中"
            out.append(dict(
                id=key + "::" + r["rule"],
                repo=r["repo"], fn=r["fn"], file=r["file"],
                rule=r["rule"], calls=r.get("calls", []),
                lead=lead, shape=shape,
                gold=gold, gold_confidence=conf, gold_reason=why,
                schema=ATTRIB_SCHEMA,
            ))
        with open(args.export_jsonl, "w", encoding="utf-8") as fh:
            for o in out:
                fh.write(json.dumps(o, ensure_ascii=False) + "\n")
        import collections as _c
        cc = _c.Counter((o["gold"], o["gold_confidence"]) for o in out)
        print(f"\n[export] 已写出 {len(out)} 条 → {args.export_jsonl}")
        for k in sorted(cc):
            print(f"  {k[0]:<9}{k[1]:<10}{cc[k]:>4}")

    # 判据冲突：同一条既被判「该抑制」又被判「不许改」⇒ 两组判据必有一个在猜。
    # 各算各的自相矛盾，所以**先从两组里都剔除**，再统计。
    conflict = [r for r in rows if r["tags"] and r["shapes"]]
    ok = [r for r in rows if not (r["tags"] and r["shapes"])]

    total = len(rows)
    print(f"违规总数 {total}（{len({(r['repo'], r['fn']) for r in rows})} 个函数）\n")

    incl = collections.Counter()
    excl = collections.Counter()
    for r in ok:  # 冲突条目不进任何一组
        for t in r["tags"]:
            incl[t] += 1
        if len(r["tags"]) == 1:
            excl[r["tags"][0]] += 1

    print(f"{'线索':<24}{'命中(含重叠)':>12}{'独占':>8}{'上限占比':>10}   反面风险")
    print("-" * 100)
    for name in LEADS:
        pct = incl[name] / total * 100 if total else 0
        print(
            f"{name:<24}{incl[name]:>10}{excl[name]:>8}{pct:>9.1f}%   {LEADS[name]['risk']}"
        )

    # 【真阳性形态】单独统计：它们**不该**被抑制，不计入收益上限
    shp = collections.Counter()
    for r in ok:
        for s in r["shapes"]:
            shp[s] += 1
    print("\n真阳性形态（登记用，**不计入**收益上限——这些报得对，不许改）：")
    for name in SHAPES:
        print(f"  {shp[name]:3d}  {name}  — {SHAPES[name]}")

    # 判据冲突：同一条既被判「该抑制」又被判「不许改」⇒ 两组判据必有一个在猜。
    # 各算各的自相矛盾，剔出来交人工裁决。
    if conflict:
        print(f"\n⚠ 判据冲突 {len(conflict)} 条（既在抑制候选、又在真阳性形态）"
              f" —— 已从两组中剔除，须人工裁决：")
        for r in conflict[:10]:
            print(f"   {r['repo']}/{r['fn']} :: {r['rule']}"
                  f" | L={r['tags']} T={r['shapes']}")
    else:
        print("\n判据冲突：0 条（当前数据下两组判据无交叠）")

    none = [r for r in rows if not r["tags"] and not r["shapes"]]
    print("-" * 100)
    print(f"无归属（既非抑制候选也非真阳性形态）：{len(none)} 条"
          f"（{len(none)/total*100:.1f}%）← 这些是真要逐条看的")
    print("注意：『无归属』的分母里已剔除真阳性形态 —— 只认形态不认抑制，"
          "不算归因成功。")

    # 规则分布（找漏项用）
    print("\n规则分布（找漏列的线索）：")
    for rule, c in collections.Counter(r["rule"] for r in rows).most_common():
        print(f"  {c:3d} ({c/total*100:4.1f}%)  {rule}")

    if args.dump:
        print("\n逐条：")
        for r in rows:
            mark = ",".join(r["tags"]) or "-"
            if r["shapes"]:
                mark += " <" + ",".join(r["shapes"]) + ">"
            print(f"  [{mark}] {r['repo']}/{r['fn']} ({r['file']}) :: {r['rule']}")

    snapshot = {
        "date": time.strftime("%Y-%m-%d %H:%M"),
        # 口径版本。v1 = 只有抑制候选、未区分真阳性形态；v2 = 二分 + 剔除冲突。
        # **跨版本的两条快照不可直接比较** —— 未归因下降可能只是口径变更。
        "schema": "v2",
        # 用结果文件里的切片数，不要用 rows 里的去重仓库数——
        # 有切片（如纯 JS 的 gothinkster）一条违规都没有，会被漏掉，快照就少算一片
        "slices": len(data),
        "total": total,
        "leads": {name: round(incl[name] / total * 100, 1) if total else 0
                  for name in LEADS},
        "unattributed_pct": round(len(none) / total * 100, 1) if total else 0,
        # v2：分开记，才看得出「未归因下降」是真归因还是改名
        "true_positive_pct": round(
            sum(1 for r in rows if r["shapes"]) / total * 100, 1) if total else 0,
    }

    if args.snapshot:
        hist_path = os.path.join(HERE, "reports", "fp-pool-attrib-history.json")
        hist = []
        if os.path.exists(hist_path):
            try:
                hist = json.load(open(hist_path))
            except Exception:  # noqa: BLE001
                hist = []
        hist.append(snapshot)
        json.dump(hist, open(hist_path, "w"), ensure_ascii=False, indent=1)
        print(f"\n[snapshot] 已存第 {len(hist)} 次读数 → reports/fp-pool-attrib-history.json")

    if args.check_saturation:
        hist_path = os.path.join(HERE, "reports", "fp-pool-attrib-history.json")
        if not os.path.exists(hist_path):
            print("\n[saturation] 没有历史快照，先跑 --snapshot")
            return 0
        hist = json.load(open(hist_path))
        if len(hist) < 2:
            print(f"\n[saturation] 只有 {len(hist)} 次读数，需要至少 2 次才能比较")
            return 0
        a, b = hist[-2], hist[-1]
        print(f"\n[saturation] {a['slices']} 片({a['total']} 条) → "
              f"{b['slices']} 片({b['total']} 条)")
        sa, sb = a.get("schema", "v1"), b.get("schema", "v1")
        if sa != sb:
            print(f"   ⚠ 口径不同（{sa} → {sb}），**本次比较无效**。\n"
                  f"     未归因占比的下降可能只是口径变更（例如 v2 把真阳性形态剔出分母），\n"
                  f"     不等于池更饱和。请以同口径内**第二次**快照起判。")
        # 空过防线（R23 家族）：新切片贡献太少时，「没漂移」不代表饱和，只代表没信息。
        added = b["total"] - a["total"]
        share = added / b["total"] * 100 if b["total"] else 0
        if share < 5:
            print(f"   ⚠ 这次比较**无效**：新切片只贡献 {added} 条（{share:.1f}% < 5%）。"
                  f"\n     贡献量不足时『各线索没漂移』是空过，不是饱和 —— "
                  f"典型原因是切片本身有偏（例如只切到某一个子目录）。先修切片再判。")
            return 0
        bad = []
        for name in LEADS:
            d = b["leads"].get(name, 0) - a["leads"].get(name, 0)
            flag = "✓" if abs(d) < 5 else "✗"
            if abs(d) >= 5:
                bad.append(f"{name} {d:+.1f}pp")
            print(f"   {flag} {name:<24} {a['leads'].get(name,0):>5.1f}% → "
                  f"{b['leads'].get(name,0):>5.1f}%  ({d:+.1f})")
        d = b["unattributed_pct"] - a["unattributed_pct"]
        print(f"   {'✓' if d <= 0 else '✗'} {'未归因':<24} "
              f"{a['unattributed_pct']:>5.1f}% → {b['unattributed_pct']:>5.1f}%  ({d:+.1f})")
        if d > 0:
            bad.append(f"未归因 {d:+.1f}pp（仍在涨）")
        if bad:
            print(f"\n[saturation] **未饱和**（R25）：{len(bad)} 项不达标 → {'; '.join(bad)}")
            print("             继续扩池，别开工。")
        else:
            print("\n[saturation] **已饱和**（R25 两条判据都过）⇒ 可以按当前优先级动手")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
