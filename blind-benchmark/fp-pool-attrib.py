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
}


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

    if (
        rule in INPUT_RULES
        and FACTORY_NAME.search(fn.split(".")[-1])
        and not ENTRY_PATH.search(file_l)
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

    return tags


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--slice", default=None)
    ap.add_argument("--dump", action="store_true", help="逐条列出命中")
    ap.add_argument("--snapshot", action="store_true",
                    help="把本次读数存进 reports/fp-pool-attrib-history.json（R25 用）")
    ap.add_argument("--check-saturation", action="store_true",
                    help="比较最近两次快照，按 R25 判据判定池是否饱和")
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

    total = len(rows)
    print(f"违规总数 {total}（{len({(r['repo'], r['fn']) for r in rows})} 个函数）\n")

    incl = collections.Counter()
    excl = collections.Counter()
    for r in rows:
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

    none = [r for r in rows if not r["tags"]]
    print("-" * 100)
    print(f"无任何线索命中：{len(none)} 条（{len(none)/total*100:.1f}%）← 这些是真要逐条看的")

    # 规则分布（找漏项用）
    print("\n规则分布（找漏列的线索）：")
    for rule, c in collections.Counter(r["rule"] for r in rows).most_common():
        print(f"  {c:3d} ({c/total*100:4.1f}%)  {rule}")

    if args.dump:
        print("\n逐条：")
        for r in rows:
            print(
                f"  [{','.join(r['tags']) or '-'}] {r['repo']}/{r['fn']}"
                f" ({r['file']}) :: {r['rule']}"
            )

    snapshot = {
        "date": time.strftime("%Y-%m-%d %H:%M"),
        # 用结果文件里的切片数，不要用 rows 里的去重仓库数——
        # 有切片（如纯 JS 的 gothinkster）一条违规都没有，会被漏掉，快照就少算一片
        "slices": len(data),
        "total": total,
        "leads": {name: round(incl[name] / total * 100, 1) if total else 0
                  for name in LEADS},
        "unattributed_pct": round(len(none) / total * 100, 1) if total else 0,
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
