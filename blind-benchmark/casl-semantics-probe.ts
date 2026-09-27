/**
 * §49.11 路线 B 可行性 —— 「读懂权限定义本身」这条路走得通吗？（2026-09-27）
 *
 * 背景：§49.9 把压制型判据三方向全否决，根因是**粒度差两级**——
 * 我们只有「这个类里有没有写鉴权代码」（**类级**事实），而判断一个告警真假需要的是
 * 「这个操作对这个资源有没有被授权」（**资源 × 动作**级断言）。R82 就是这条。
 *
 * 路线 B 要做的正是补上那两级：解析 CASL 这类能力声明，
 * 拿到具体的 (action, subject) 组合。
 *
 * 本探针只回答可行性的三个前置问题，**不改产品逻辑、不落地判据**：
 *
 *   Q1 能力**定义**能不能抽出来？  `can(SpaceCaslAction.Manage, SpaceCaslSubject.Settings)`
 *      —— action/subject 常常是**枚举成员**（`Manage = 'manage'`），得先把它解析成字面值
 *   Q2 使用点（controller 里那句 `ability.can(action, subject)`）的参数形态是什么？
 *      是两个都能解、只能解一个、还是一个都解不了（全是变量）？
 *      ⇒ 这直接决定这条路的工作量：全是变量就意味着还要做跨函数常量传播
 *   Q3 gold 样本所在的告警，有多大比例能关联到一个可解析的使用点？
 *      ⇒ 这是这条路能覆盖的**上界**（R77：先看清分母再谈收益）
 *
 * 用法：
 *   npx tsx blind-benchmark/casl-semantics-probe.ts --root /tmp/full-docmost --repo docmost
 *
 * 只读分析，引用 call-graph-lib 的现有工具（R59：不手抄一份文件遍历）。
 */
import fs from "fs";
import path from "path";
import { Project, SyntaxKind } from "ts-morph";
import { findSourceFiles } from "./call-graph-lib";

const HERE = __dirname;
const GOLD = path.join(HERE, "fp-gold.jsonl");

function parseArgs() {
  const a = process.argv.slice(2);
  const get = (k: string) => {
    const i = a.indexOf(k);
    return i >= 0 ? a[i + 1] : undefined;
  };
  const root = get("--root");
  const repo = get("--repo");
  if (!root || !repo) {
    console.error("用法: --root <全量目录> --repo <名>");
    process.exit(1);
  }
  return { root, repo };
}

/** 权限判定方法名。宁可宽：进 Q2 后再按实际串 eleg 过滤 */
const VERB_RE = /\.(can|cannot|allows|isAllowed|checkPermission|canActivate)$/;

interface CallPoint {
  file: string;
  /** 所在 callable 名（Class.method 或裸名），用于和 gold 对齐 */
  owner: string;
  verb: string;
  arg0: string;
  arg1: string;
  /** arg0 能否解析成字面值 */
  r0: boolean;
  /** arg1 能否解析成字面值 */
  r1: boolean;
  /** 是不是能力**定义点**（函数体内出现 AbilityBuilder / defineAbility） */
  isDef: boolean;
}

const args = parseArgs();

console.log(`\n══ §49.11 路线 B 可行性：${args.repo} ══`);
console.log(`全量根目录：${args.root}`);

const project = new Project({
  compilerOptions: { allowJs: false, noResolve: true, target: 99 },
  skipAddingFilesFromTsConfig: true,
});
const absFiles = findSourceFiles(args.root);
console.log(`源文件 ${absFiles.length} 个`);

/** Q1 前置：枚举成员表  EnumName.Member → 字面值（只收字符串枚举，够用且不会造假） */
const enumVals = new Map<string, string>();
/** 反向约束：只认**已知枚举名**，避免把任意的 `X.Y` 误当枚举解析 */
const enumNames = new Set<string>();

const callPoints: CallPoint[] = [];
let hasCaslPkg = 0;

const resolveArg = (raw: string): { ok: boolean; val: string } => {
  const t = raw.trim();
  if (/^['"`].*['"`]$/.test(t)) return { ok: true, val: t.slice(1, -1) };
  if (/^\d+$/.test(t)) return { ok: true, val: t };
  const m = t.match(/^([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)$/);
  if (m && enumNames.has(m[1])) {
    const v = enumVals.get(`${m[1]}.${m[2]}`);
    if (v !== undefined) return { ok: true, val: v };
  }
  return { ok: false, val: t };
};

for (const f of absFiles) {
  let sf: any;
  try {
    sf = project.addSourceFileAtPath(f);
  } catch {
    continue;
  }
  const rel = path.relative(args.root, f);
  const text = sf.getFullText?.() ?? "";
  if (text.includes("@casl/ability")) hasCaslPkg++;

  // 枚举（先全仓收一遍：定义文件可能在使用文件之后被读到，两趟更稳，这里一趟也能覆盖文件内）
  for (const en of sf.getEnums?.() ?? []) {
    const nm = en.getName?.();
    if (!nm) continue;
    enumNames.add(nm);
    for (const mb of en.getMembers?.() ?? []) {
      const init = mb.getInitializer?.();
      if (!init) continue;
      const v = String(init.getText()).trim();
      if (/^['"`].*['"`]$/.test(v)) enumVals.set(`${nm}.${mb.getName()}`, v.slice(1, -1));
    }
  }
}

// 第二趟：解析调用点（枚举表此时已完整）
for (const f of absFiles) {
  let sf: any;
  try {
    sf = project.addSourceFileAtPath(f);
  } catch {
    continue;
  }
  const rel = path.relative(args.root, f);
  for (const fn of [
    ...(sf.getFunctions?.() ?? []),
    ...(sf.getClasses?.() ?? []).flatMap((c: any) => [
      ...(c.getMethods?.() ?? []),
      ...(c.getConstructors?.() ?? []),
    ]),
  ]) {
    const cn = fn.getParent?.().getName?.();
    const owner = cn ? `${cn}.${fn.getName?.() ?? "constructor"}` : String(fn.getName?.() ?? "?");
    const bodyText = fn.getBody?.()?.getText?.() ?? "";
    const isDef = /AbilityBuilder|defineAbility|createMongoAbility/.test(bodyText);
    for (const c of fn.getDescendantsOfKind?.(SyntaxKind.CallExpression) ?? []) {
      const expr = String(c.getExpression().getText()).replace(/\s+/g, "");
      // ⚠ R81 第三次现身：能力**定义**点用的是从 AbilityBuilder 解构出来的**裸 can/cannot**
      // （`const { can, build } = new AbilityBuilder(...)`），而**使用**点是 `ability.cannot(...)`。
      // 只认带点的那种 ⇒ 定义点恒为 0，Q1 直接假失败。
      const isVerbCall =
        /\.(can|cannot|allows|isAllowed|checkPermission|canActivate)$/.test(expr) ||
        (isDef && /^(can|cannot)$/.test(expr));
      if (!isVerbCall) continue;
      const ps = c.getArguments?.() ?? [];
      const a0 = ps[0] ? String(ps[0].getText()) : "";
      const a1 = ps[1] ? String(ps[1].getText()) : "";
      if (!a0) continue;
      const clean = String(c.getExpression().getText()).replace(/\s+/g, "");
      callPoints.push({
        file: rel,
        owner,
        verb: (clean.match(/([A-Za-z_$][\w$]*)$/) ?? ["", clean])[1],
        arg0: a0,
        arg1: a1,
        r0: resolveArg(a0).ok,
        r1: a1 ? resolveArg(a1).ok : false,
        isDef,
      });
    }
  }
}

/** 真正的**能力语义**动词。canActivate 是 NestJS 守卫的接口方法，不是资源级判定 ⇒ 单列对照 */
const CASL_VERB_RE = /^(can|cannot|allows|isAllowed)$/;

const defs = callPoints.filter((c) => c.isDef && CASL_VERB_RE.test(c.verb));
const uses = callPoints.filter((c) => !c.isDef && CASL_VERB_RE.test(c.verb));
const guards = callPoints.filter((c) => !CASL_VERB_RE.test(c.verb));

console.log(`\n── Q1 能力定义点 ──`);
console.log(`   引用 @casl/ability 的文件 ${hasCaslPkg} 个`);
console.log(`   枚举 ${enumNames.size} 个，其中可解析的字符串成员 ${enumVals.size} 条`);
console.log(`   能力定义内的规则点 ${defs.length} 条（can/cannot 调用）`);
const defBoth = defs.filter((c) => c.r0 && c.r1).length;
console.log(
  `   两个参数都能解析成字面值的 ${defBoth} / ${defs.length} (${defs.length ? ((defBoth / defs.length) * 100).toFixed(0) : "—"}%)`
);
console.log(`   样例：`);
defs.slice(0, 6).forEach((c) =>
  console.log(
    `     ${c.file.slice(0, 46).padEnd(48)} ${c.verb}(${resolveArg(c.arg0).val || c.arg0.slice(0, 16)}, ${
      c.arg1 ? resolveArg(c.arg1).val || c.arg1.slice(0, 20) : "—"
    })`
  )
);

console.log(`\n── Q2 使用点（业务代码里真正做判定的那句）──`);
console.log(`   使用点 ${uses.length} 条`);
const both = uses.filter((c) => c.r0 && c.r1).length;
const onlyAct = uses.filter((c) => c.r0 && !c.r1).length;
const onlySub = uses.filter((c) => !c.r0 && c.r1).length;
const none = uses.filter((c) => !c.r0 && !c.r1).length;
const pct = (x: number, n: number) => (n ? `${((x / n) * 100).toFixed(0)}%` : "—");
console.log(`   动作+资源都可解析 ${both} (${pct(both, uses.length)})  ← 这条路能直接吃到`);
console.log(`   只有动作可解析   ${onlyAct} (${pct(onlyAct, uses.length)})  ← 还要把资源追出来`);
console.log(`   只有资源可解析   ${onlySub} (${pct(onlySub, uses.length)})`);
console.log(`   两个都不可解析   ${none} (${pct(none, uses.length)})  ← 必须做跨函数常量传播`);
console.log(`   样例：`);
uses.slice(0, 8).forEach((c) =>
  console.log(
    `     ${c.owner.slice(0, 34).padEnd(36)} ${c.verb}(${c.arg0.slice(0, 22)}, ${c.arg1.slice(0, 22)})`
  )
);

// ── Q3 gold 覆盖上界 ──
const rows = fs
  .readFileSync(GOLD, "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l))
  .filter((r: any) => r.repo === args.repo);
const ownerSet = new Set(uses.map((c) => c.owner));
const fileSet = new Set(uses.map((c) => c.file));
const bareOf = (s: string) => (s.includes(".") ? s.split(".").pop()! : s);

const inOwner = rows.filter((r: any) => {
  const fn = String(r.fn ?? "");
  const bare = bareOf(fn);
  return [...ownerSet].some((o) => o === fn || bareOf(o) === bare);
}).length;
const inFile = rows.filter((r: any) => {
  const f = String(r.file ?? "");
  return [...fileSet].some((k) => k === f || k.endsWith(f));
}).length;

console.log(`\n── Q3 gold 覆盖上界（${args.repo} ${rows.length} 条）──`);
console.log(
  `   ① **同一函数里**就写了权限判定 ${inOwner} (${pct(inOwner, rows.length)})` +
    `  ← 严格的天花板：只有这些能直接用 (动作, 资源) 去比对`
);
console.log(
  `   ② 同一文件里有权限判定     ${inFile} (${pct(inFile, rows.length)})` +
    `  ← 宽松上界：还要靠文件级归属去够，可信度低得多`
);
console.log(
  `   ③ 两者之差 ${inFile - inOwner} 条需要「跨函数把权限意图挪过来」才能真正用上`
);
const missing = rows
  .filter((r: any) => {
    const fn = String(r.fn ?? "");
    const bare = bareOf(fn);
    return ![...ownerSet].some((o) => o === fn || bareOf(o) === bare);
  })
  .slice(0, 5)
  .map((r: any) => `${String(r.fn).slice(0, 38).padEnd(40)} ${String(r.gold).padEnd(8)} ${r.file}`);
console.log(`   ⇒ R77：这就是这条路能影响的**分母**，低于它的收益不值这一轮工程`);
missing.forEach((m) => console.log(`     未命中：${m}`));

// ── Q4：结构化输出（§49.14）—— 给排序评估用 ──
// 路线 B 的真问题不是「能不能解析」（Q1/Q2 都是 100%），而是**解析出来能影响几条告警**（Q3）。
// 但「影响几条」还不够：还要知道这部分的**边际收益** —— 已经有 §49.13 的排序方案（AUC 0.895）了，
// B 只能在它的基础上加。所以这里把每条 gold 的 CASL 命中情况导出，交给 rank-signals 侧去算
// 「加上这个信号后 AUC 变不变」。若不变，B 就不值那个工程量（R77 的分母意识）。
// ⚠ `get` 是 parseArgs 内部的局部函数，这里拿不到 ⇒ 直接从 argv 取
const _argv = process.argv.slice(2);
const _ji = _argv.indexOf("--json");
const jsonOut = _ji >= 0 ? _argv[_ji + 1] : undefined;
if (jsonOut) {
  const lines = rows.map((r: any) => {
    const fn = String(r.fn ?? "");
    const bare = bareOf(fn);
    const f = String(r.file ?? "");
    return JSON.stringify({
      repo: r.repo,
      fn,
      file: f,
      rule: String(r.rule ?? ""),
      gold: String(r.gold ?? ""),
      caslOwner: [...ownerSet].some((o) => o === fn || bareOf(o) === bare) ? 1 : 0,
      caslFile: [...fileSet].some((k) => k === f || k.endsWith(f)) ? 1 : 0,
    });
  });
  fs.writeFileSync(path.resolve(jsonOut), lines.join("\n") + "\n", "utf8");
  console.log(`[casl] 结构化输出 ${lines.length} 条 → ${jsonOut}`);
}

console.log("\n读法：");
console.log("  ① Q1 过不了就没必要往下做（连定义都抽不出来）；");
console.log("  ② Q2 的「两个都不可解析」占比直接等于**额外工程量**——它要求跨函数常量传播；");
console.log("  ③ Q3 的天花板低于底座收益时，这条路就不值（R77：先看清分母）。\n");
