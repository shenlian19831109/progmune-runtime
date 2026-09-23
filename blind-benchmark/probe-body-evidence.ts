#!/usr/bin/env npx tsx
/**
 * probe-body-evidence.ts —— 函数体证据探针（R29/R38 产物）
 *
 * 存在理由：§三十 用「临时文本脚本抓函数体」估 C/D 两类证据的命中数，报了 0。
 * 但同一个探针漏掉了 `export const x = async () =>` 形态，导致 gothinkster 3 条
 * 不在预测内 —— 说明**该探针系统性低估命中**。它报的 0 不可信。
 * 本探针改用 ts-morph AST 收集所有函数形态，作为正式可复现资产留存。
 *
 * 用法：npx tsx blind-benchmark/probe-body-evidence.ts [--rule "Input Validation"]
 * 输出：reports/probe-body-evidence.json + 控制台摘要
 *
 * 纪律：本脚本只**估命中数**，不判定。命中条目必须逐条人眼确证（R30）后才进代码。
 */

import { Project, Node, SyntaxKind } from "ts-morph";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "..");
const POOL = path.join(__dirname, "fp-pool");
const RESULTS = path.join(__dirname, "reports", "fp-pool-results.json");
const GOLD = path.join(__dirname, "fp-gold.jsonl");
const OUT = path.join(__dirname, "reports", "probe-body-evidence.json");

const RULE_RE = new RegExp(process.argv.includes("--rule")
  ? process.argv[process.argv.indexOf("--rule") + 1]
  : "input validation", "i");

/* ---------------- 证据判据（只做粗筛，命中后仍需人眼确证） ---------------- */

const EVIDENCE: { id: string; desc: string; re: RegExp }[] = [
  // C1 校验库/校验框架调用
  { id: "C1_validate_call", desc: "class-validator/joi/yup 的 validate 系调用",
    re: /\.\s*(?:validateOrReject|validateSync|isValid|validate)\s*\(/ },
  { id: "C2_zod_parse", desc: "zod 系 schema.parse/safeParse（标识符须像 schema/validator/dto）",
    re: /\b[A-Za-z_$][\w$]*(?:[Ss]chema|[Vv]alidator|[Dd]to|Zod|Input|Payload|Body|Query|Params)[A-Za-z0-9_$]*\s*\.\s*(?:safeParse|parse)\s*\(/ },
  { id: "C3_schema_lib", desc: "Joi/yup/z 命名空间调用",
    re: /\b(?:Joi|joi|yup|z)\s*\.\s*(?:object|string|number|array|attempt|validate|assert)/ },
  { id: "C4_celebrate_express", desc: "express 校验中间件 celebrate/express-validator 的 check/body/query",
    re: /\b(?:celebrate|check|body|query|param|validationResult)\s*\(/ },

  // D 白名单/枚举成员检查
  { id: "D1_const_whitelist", desc: "大写白名单常量上的 includes/indexOf/has/test",
    re: /\b(?:ALLOWED|WHITE_?LIST|VALID|SUPPORTED|PERMITTED|KNOWN|ACCEPTED|ENUM|MIME|EXTENSIONS?|TYPES?)[A-Z0-9_]*\s*\.\s*(?:includes|indexOf|has|test)\s*\(/ },
  { id: "D2_array_literal_check", desc: "内联数组字面量的成员检查",
    re: /\[[^\]\n]{1,240}\]\s*\.\s*(?:includes|indexOf)\s*\(/ },
  { id: "D3_missing_member", desc: "成员检查后取反/判 -1（典型的「不在白名单就拒」）",
    re: /\.\s*(?:includes|indexOf)\s*\([^()\n]{0,80}\)\s*(?:===|-1|!==|\s*<\s*0)/ },
  { id: "D4_mime_check", desc: "mime/content-type 相关判定",
    re: /\b(?:mime|mimetype|content-?type)\b[\s\S]{0,120}?\b(?:includes|indexOf|test|match|startsWith)\s*\(/i },
];

/* ---------------- 收集某文件里所有「可调用声明」的 (fullName, node) ---------------- */

/* ---------------- 副作用证据（参数是否流向持久化 / 外部系统） ----------------
 * 候选 requireMarker 的支撑证据。动机：Input Validation 的 trigger 是纯函数名正则
 * （create|add|post|upload），判据手里只有名字。真值显示：
 *   - verified TP 里有 Service 层方法（无 req 对象，但有持久化：redis.sadd /
 *     labelRepo.findOrCreate / teamService.createTeam）
 *   - FP 侧是工厂与配置装配（createS3 / ConfigBuilder.addStorage，只构造对象）
 * ⇒ 区分点疑似「参数是否流向外部副作用」，而非「是否 HTTP 入口」。
 * 本组用于量化该判据在真值集上的 TP 覆盖率与 FP 压制率（R39：必须优于多数类基线）。
 */
const EFFECT: { id: string; desc: string; re: RegExp }[] = [
  { id: "S1_orm_write", desc: "ORM/repository 写入",
    re: /\b(?:save|create|update|insert|upsert|persist|remove|deleteMany|delete|findOrCreate|upsertMany|createMany|updateMany)\s*\(/ },
  { id: "S2_cache_write", desc: "缓存/Redis 写入",
    re: /\b(?:sadd|hset|hmset|lpush|rpush|setex|zadd|incr|append)\s*\(/ },
  { id: "S3_outbound", desc: "HTTP 出站 / 消息投递",
    re: /\b(?:fetch|axios|request|got|superagent)\s*[.(]|\bhttps?\.\s*(?:request|get|post)\s*\(|\b(?:publish|emit|send|dispatch)\s*\(/ },
  { id: "S4_fs_write", desc: "文件系统写入",
    re: /\b(?:writeFile|writeFileSync|appendFile|createWriteStream|mkdir|unlink|rm|rename|copyFile)\s*\(/ },
  // 动词表含 upload/put：docmost AttachmentService.uploadToDrive 是 verified 之外的
  // heuristic TP，函数体只有 `this.storageService.upload(filePath, fileContent)`。
  // 漏一个动词就丢一条真报 —— 分母要问「哪些形态还没被看见」（R19）。
  // 大小写不敏感（i）：webshape_E 的语料写的是 `repo.saveBanner(file)` ——
  // 小写 repo + 带后缀动词 saveBanner，大写前缀版两个条件都不满足 ⇒ 副作用证据
  // 漏判 ⇒ 该报的被本判据压掉（闸门当场转红 3 条）。合成语料比 FP 池更早暴露
  // 这个洞，因为它把形状写得很干净（R19：分母要含没被看见的形态）。
  { id: "S5_delegate_service", desc: "委托给 repo/service/storage 层（跨层写入，大小写不敏感）",
    re: /\b\w*(?:repo|repository|service|storage|dao|manager|gateway|client|provider)\s*\.\s*(?:create|add|save|update|insert|upsert|write|store|persist|set|upload|put|send|publish|remove|delete)[A-Za-z0-9_]*\s*\(/i },
  { id: "S6_prisma", desc: "prisma / knex / typeorm query builder 写入",
    re: /\bprisma\s*\.\s*\w+\s*\.\s*(?:create|update|upsert|delete|createMany|updateMany)\s*\(|\b(?:knex|db|connection|tx|trx)\s*\(\s*['"]\w+['"]\s*\)\s*\.\s*(?:insert|update|del)\s*\(/ },
  // S7：Kysely 链式写入（trx.insertInto(...).values(...).execute()）。
  // 加它的原因：GroupUserService.addUsersToGroupBatch 是 TP，但 S1-S6 全不命中
  // —— 它用的是 Kysely 链式 API。判据漏召回比判据误压制更该先补（R19 分母）。
  { id: "S7_qb_chain", desc: "Kysely/knex 链式 insertInto/updateTable/deleteFrom",
    re: /\.\s*(?:insertInto|updateTable|deleteFrom|insert|update|del|delete)\s*\(/ },
];

/** 副作用调用是否「吃到」本函数的参数（在匹配点后的窗口里找参数名） */
function argLinked(body: string, re: RegExp, paramNames: string[]): boolean {
  const names = paramNames.filter((n) => n && n.length >= 3);
  if (!names.length) return false;
  // 重建时必须带上原正则的 flags（S5 带 i，丢了它就会漏匹配 ⇒ 精化分支假性变差）
  const rx = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  let m: RegExpExecArray | null;
  while ((m = rx.exec(body)) !== null) {
    const win = body.slice(m.index, m.index + 220);
    for (const n of names) {
      if (new RegExp(`\\b${n.replace(/[$]/g, "\\$")}\\b`).test(win)) return true;
    }
  }
  return false;
}

/* ---------------- 入口迹象（判据做决定时「是否知道这是请求入口」） ---------------- */

const ENTRY: { id: string; desc: string; re: RegExp }[] = [
  { id: "X1_handler_decorator", desc: "NestJS/GraphQL 处理器装饰器",
    re: /@\s*(?:Get|Post|Put|Delete|Patch|Controller|Mutation|Query|Resolver|ResolveField|Subscription|MessagePattern|EventPattern|UseGuards|Public|Auth)\b/ },
  { id: "X2_route_registration", desc: "路由注册 app/router/server.get|post|use",
    re: /\b(?:app|router|server|fastify|express|api)\s*\.\s*(?:get|post|put|delete|patch|use|route|all)\s*\(/ },
  { id: "X3_request_object", desc: "函数体里读 req/request/ctx 上的请求字段",
    re: /\b(?:req|request|ctx|context)\s*\.\s*(?:body|query|params|headers|cookies|args|input|files|file)\b/ },
  { id: "X4_param_type", desc: "参数名/类型注解像请求对象或 DTO",
    re: /\b(?:req|request|ctx|context|args|input|payload|dto|body|query|params|data)\b\s*(?::|\.)?\s*(?:Request|Context|Args|Dto|Input|Payload|Body|Query|Params|any)?/ },
];

function collectCallables(sf: any): { fullName: string; simpleName: string; node: any }[] {
  const out: { fullName: string; simpleName: string; node: any }[] = [];

  // 1) 顶层 / 命名空间内函数声明
  for (const fn of sf.getFunctions()) {
    out.push({ fullName: fn.getName() || "<anon>", simpleName: fn.getName() || "<anon>", node: fn });
  }
  // 2) 变量箭头 / 函数表达式（含 export const x = async () => {}）
  for (const vd of sf.getVariableDeclarations()) {
    const init = vd.getInitializer();
    if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
      const n = vd.getName();
      out.push({ fullName: n, simpleName: n, node: init });
    }
  }
  // 3) 类方法 / 构造器
  for (const cls of sf.getClasses()) {
    const cn = cls.getName() || "<anon-class>";
    for (const m of [...cls.getMethods(), ...cls.getConstructors()]) {
      const mn = (m as any).getName ? (m as any).getName() : "constructor";
      out.push({ fullName: `${cn}.${mn}`, simpleName: mn, node: m });
    }
    // 4) 类属性上的箭头函数
    for (const p of cls.getProperties()) {
      const init = p.getInitializer();
      if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
        out.push({ fullName: `${cn}.${p.getName()}`, simpleName: p.getName(), node: init });
      }
    }
  }
  // 5) 对象字面量方法 / 属性箭头（浅层）
  for (const ol of sf.getDescendantsOfKind(SyntaxKind.ObjectLiteralExpression)) {
    for (const a of ol.getProperties()) {
      if (Node.isMethodDeclaration(a) || Node.isPropertyAssignment(a)) {
        const nm = (a as any).getName?.();
        if (!nm) continue;
        const init = Node.isPropertyAssignment(a) ? a.getInitializer() : a;
        if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init) || Node.isMethodDeclaration(a))) {
          out.push({ fullName: nm, simpleName: nm, node: init });
        }
      }
    }
  }
  return out;
}

function matches(cand: { fullName: string; simpleName: string }, target: string): boolean {
  if (cand.fullName === target) return true;
  if (!target.includes(".")) return cand.simpleName === target;
  const last = target.slice(target.lastIndexOf(".") + 1);
  const first = target.slice(0, target.indexOf("."));
  if (cand.simpleName !== last) return false;
  return cand.fullName.startsWith(first + ".") || cand.fullName === last;
}

/* ---------------- 主流程 ---------------- */

interface Item { repo: string; file: string; name: string; gold?: string; goldConfidence?: string; goldReason?: string }

function main() {
  const FROM_GOLD = process.argv.includes("--from-gold");
  const items: Item[] = [];
  if (FROM_GOLD) {
    // 真值集模式：带上 gold 标签，用于量化候选判据的 TP 覆盖率 / FP 压制率（R39）
    const gold = fs.readFileSync(GOLD, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    for (const g of gold) {
      if (RULE_RE.test(g.rule)) {
        items.push({ repo: g.repo, file: g.file, name: g.fn, gold: g.gold, goldConfidence: g.gold_confidence, goldReason: g.gold_reason });
      }
    }
    console.log(`[probe] 真值集模式（${path.basename(GOLD)}）`);
  } else {
    const res = JSON.parse(fs.readFileSync(RESULTS, "utf8"));
    for (const k of Object.keys(res)) {
      for (const f of res[k].perFunction || []) {
        for (const v of f.safeguardViolations || []) {
          if (RULE_RE.test(v.rule)) items.push({ repo: f.repo, file: f.file, name: f.name });
        }
      }
    }
  }
  console.log(`[probe] rule=${RULE_RE} 命中条目 ${items.length}`);

  const byRepo = new Map<string, Item[]>();
  for (const it of items) {
    if (!byRepo.has(it.repo)) byRepo.set(it.repo, []);
    byRepo.get(it.repo)!.push(it);
  }

  const rows: any[] = [];
  let resolved = 0, unresolved = 0;

  for (const [repo, list] of byRepo) {
    const absRoot = path.join(POOL, repo);
    if (!fs.existsSync(absRoot)) { console.warn(`[probe] 缺语料目录 ${absRoot}`); continue; }
    const proj = new Project({
      compilerOptions: { allowJs: true, target: 99, moduleResolution: 100, skipLibCheck: true },
      skipAddingFilesFromTsConfig: true,
    });
    // 只加载命中文件，避免整仓解析（本机 8GB，整仓会 OOM）
    const wanted = new Set(list.map((i) => i.file));
    const loaded = new Map<string, any>();
    for (const rel of wanted) {
      const abs = path.join(absRoot, rel);
      if (!fs.existsSync(abs)) continue;
      try { loaded.set(rel, proj.addSourceFileAtPath(abs)); } catch { /* ignore */ }
    }
    console.log(`[probe] ${repo}: 需 ${wanted.size} 文件，加载 ${loaded.size}`);

    for (const it of list) {
      const sf = loaded.get(it.file);
      if (!sf) { unresolved++; rows.push({ ...it, status: "FILE_MISSING", hits: [] }); continue; }
      const cands = collectCallables(sf);
      const hit = cands.filter((c) => matches(c, it.name));
      if (hit.length === 0) {
        unresolved++;
        rows.push({ ...it, status: "FN_NOT_FOUND", candidates: cands.slice(0, 12).map((c) => c.fullName), hits: [] });
        continue;
      }
      resolved++;
      const body = hit.map((h) => h.node.getText()).join("\n/* --- */\n");
      const deco = hit.flatMap((h) => (h.node.getDecorators?.() || []).map((d: any) => d.getText())).join("\n");
      const paramsTxt = hit.flatMap((h) => (h.node.getParameters?.() || []).map((p: any) => p.getText())).join(", ");
      const hits = EVIDENCE.filter((e) => e.re.test(body)).map((e) => ({
        id: e.id, desc: e.desc,
        snippet: (body.match(e.re) || [""])[0].slice(0, 160),
      }));
      // 入口迹象：X1-X3 看装饰器+函数体，X4 只看参数与装饰器（避免函数体里的杂词造成假阳性）
      const bodyCtx = deco + "\n" + body;
      const paramCtx = deco + "\n" + paramsTxt;
      const entrySignals = ENTRY
        .filter((e) => e.re.test(e.id === "X4_param_type" ? paramCtx : bodyCtx))
        .map((e) => e.id);
      const effectHits = EFFECT.filter((e) => e.re.test(bodyCtx)).map((e) => e.id);
      // 精化版：副作用调用必须吃到本函数的参数（否则只是工厂内部的基础设施调用）
      const pNames = hit.flatMap((h: any) => (h.node.getParameters?.() || []).map((p: any) => p.getName?.() || ""));
      const effectLinked = EFFECT.filter((e) => argLinked(bodyCtx, e.re, pNames)).map((e) => e.id);
      rows.push({ ...it, status: "OK", bodyLen: body.length, params: paramsTxt.slice(0, 200), hits, entrySignals, effectHits, effectLinked, paramNames: pNames });
    }
  }

  const hitRows = rows.filter((r) => r.hits && r.hits.length > 0);
  const byEvidence: Record<string, number> = {};
  for (const r of hitRows) for (const h of r.hits) byEvidence[h.id] = (byEvidence[h.id] || 0) + 1;

  // 入口迹象统计：X1-X3 任一命中 = 强入口迹象；只有 X4 = 弱；完全没有 = 非入口嫌疑
  const byEntry: Record<string, number> = {};
  let strong = 0, weakOnly = 0, none = 0;
  const noneList: string[] = [];
  for (const r of rows) {
    const s: string[] = r.entrySignals || [];
    for (const id of s) byEntry[id] = (byEntry[id] || 0) + 1;
    const hasStrong = s.some((x) => x !== "X4_param_type");
    if (hasStrong) strong++;
    else if (s.length) { weakOnly++; }
    else { none++; noneList.push(`${r.repo} ${r.name}  [${r.file}]`); }
  }

  // 副作用证据统计
  const byEffect: Record<string, number> = {};
  let effAny = 0, effNone = 0;
  for (const r of rows) {
    const s: string[] = r.effectHits || [];
    for (const id of s) byEffect[id] = (byEffect[id] || 0) + 1;
    if (s.length) effAny++; else effNone++;
  }

  // 真值交叉表：候选判据「必须有副作用证据才触发」的 TP 覆盖率 / FP 压制率
  let cross: any = null;
  if (FROM_GOLD) {
    const mk = () => ({ withEffect: 0, noEffect: 0 });
    const tab: Record<string, any> = {};
    const tabL: Record<string, any> = {};   // 精化版（要求参数流连接）
    for (const r of rows) {
      const g = r.gold || "UNKNOWN";
      tab[g] = tab[g] || mk(); tabL[g] = tabL[g] || mk();
      if ((r.effectHits || []).length) tab[g].withEffect++; else tab[g].noEffect++;
      if ((r.effectLinked || []).length) tabL[g].withEffect++; else tabL[g].noEffect++;
    }
    const tp = (tab.TP?.withEffect || 0) + (tab.TP?.noEffect || 0);
    const fp = (tab.FP?.withEffect || 0) + (tab.FP?.noEffect || 0);
    const labeled = tp + fp;
    const keptTP = tab.TP?.withEffect || 0;
    const lostTP = tab.TP?.noEffect || 0;
    const suppressedFP = tab.FP?.noEffect || 0;
    const keptFP = tab.FP?.withEffect || 0;
    const keptTP_L = tabL.TP?.withEffect || 0;
    const lostTP_L = tabL.TP?.noEffect || 0;
    const suppressedFP_L = tabL.FP?.noEffect || 0;
    const keptFP_L = tabL.FP?.withEffect || 0;
    const majority = Math.max(tp, fp) / (labeled || 1);
    cross = {
      tab, tabLinked: tabL,
      coarse: { tpRecall: keptTP / (tp || 1), fpSuppression: suppressedFP / (fp || 1), lostTP, keptFP,
        precisionAfter: keptTP / ((keptTP + keptFP) || 1), netGain: suppressedFP - lostTP },
      linked: { tpRecall: keptTP_L / (tp || 1), fpSuppression: suppressedFP_L / (fp || 1), lostTP: lostTP_L, keptFP: keptFP_L,
        precisionAfter: keptTP_L / ((keptTP_L + keptFP_L) || 1), netGain: suppressedFP_L - lostTP_L },
      precisionBefore: tp / (labeled || 1), majorityBaseline: majority, labeled,
    };
  }

  fs.writeFileSync(OUT, JSON.stringify({
    mode: FROM_GOLD ? "gold" : "results", rule: String(RULE_RE), total: items.length, resolved, unresolved,
    byEvidence, byEntry, byEffect, entrySplit: { strong, weakOnly, none },
    effectSplit: { any: effAny, none: effNone }, cross, rows,
  }, null, 1));

  console.log(`\n[probe] 解析成功 ${resolved} / 未解析 ${unresolved}`);
  console.log(`[probe] 有证据命中的条目 ${hitRows.length} / ${items.length}`);
  console.log("[probe] 各证据类型命中条目数：", JSON.stringify(byEvidence, null, 1));
  console.log("[probe] 各入口迹象命中条目数：", JSON.stringify(byEntry, null, 1));
  console.log(`[probe] 入口强度：强 ${strong} / 仅弱(X4) ${weakOnly} / 完全无迹象 ${none}`);
  console.log("[probe] 各副作用证据命中条目数：", JSON.stringify(byEffect, null, 1));
  console.log(`[probe] 副作用：有 ${effAny} / 无 ${effNone}`);
  if (cross) {
    const pct = (x: number) => (x * 100).toFixed(1) + "%";
    console.log("\n[probe] === 真值交叉表（候选判据：须有副作用证据才触发）===");
    console.log("   gold          粗判据：有/无      精化(参数流连接)：有/无");
    for (const g of Object.keys(cross.tab)) {
      const t = cross.tab[g], l = cross.tabLinked[g] || { withEffect: 0, noEffect: 0 };
      console.log(`   ${g.padEnd(10)} ${String(t.withEffect).padStart(6)}/${String(t.noEffect).padEnd(6)} ${String(l.withEffect).padStart(10)}/${l.noEffect}`);
    }
    console.log(`   现状 precision ${pct(cross.precisionBefore)}　多数类基线 ${pct(cross.majorityBaseline)}`);
    console.log(`   粗判据  ：TP 召回 ${pct(cross.coarse.tpRecall)}（丢 ${cross.coarse.lostTP}）　FP 压制 ${pct(cross.coarse.fpSuppression)}（留 ${cross.coarse.keptFP}）　precision ${pct(cross.coarse.precisionAfter)}　净 ${cross.coarse.netGain}`);
    console.log(`   精化判据：TP 召回 ${pct(cross.linked.tpRecall)}（丢 ${cross.linked.lostTP}）　FP 压制 ${pct(cross.linked.fpSuppression)}（留 ${cross.linked.keptFP}）　precision ${pct(cross.linked.precisionAfter)}　净 ${cross.linked.netGain}`);
  }
  if (noneList.length) {
    console.log("\n[probe] 完全无入口迹象的条目：");
    for (const l of noneList.slice(0, 40)) console.log("   - " + l);
    if (noneList.length > 40) console.log(`   ... 另 ${noneList.length - 40} 条见 JSON`);
  }
  console.log(`[probe] 明细 -> ${path.relative(ROOT, OUT)}`);
}

main();
