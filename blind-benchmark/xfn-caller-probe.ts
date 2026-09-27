/**
 * §49.1 跨函数数据流 —— 第一问：**入边到底有多少？**（2026-09-27）
 *
 * 背景（别跳过，否则会重复踩）：
 *   授权族与输入校验族剩下的 35 条误报，共同瓶颈是「分不清参数是否外部输入」。
 *   这事儿必须顺着调用链往上追，而此前所有结论都建立在 **fp-pool 切片** 上
 *   （切片入边为 0 的函数占 36%~42%）⇒ 于是得出「能力上限、没法做」。
 *
 *   但**产品路径扫的是全量工程，不是切片**。切片入边为 0 可能是切片的人为损失，
 *   不是世界的真相。本探针要证伪/证实这一点：
 *
 *     同一个仓库，全量源码 vs 切片，入边覆盖率分别是多少？
 *
 *   若全量上入边充足 ⇒ 「跨函数数据流不可行」这个结论是**被语料骗了**，
 *   后续可以在全量上落地；若全量上依然大片入边为 0 ⇒ 瓶颈在**边规则**或
 *   **回调式调用**，那要修的是边，不是判据。
 *
 * 第二问（顺带，为后续污点传播做可行性摸底）：
 *   gold 样本按 **TP / FP / UNKNOWN** 分组后，上溯 chain 上是否撞到
 *   req 入口（外部输入源头）/ auth 痕迹 / route 痕迹，分布有没有差别。
 *   注意：这一问**只做分布对照，不做判据**——分布可分 ≠ 判据安全（R79）。
 *
 * 用法：
 *   npx tsx blind-benchmark/xfn-caller-probe.ts --repo docmost --root /tmp/full-docmost
 *   npx tsx blind-benchmark/xfn-caller-probe.ts --repo docmost --root /tmp/full-docmost \
 *        --slice blind-benchmark/fp-pool/docmost --depth 3 --show 8
 *
 * 只读分析：不改 src，不进产品路径。
 */
import fs from "fs";
import path from "path";
import {
  buildGraph,
  selfFacts,
  hasAuthTrace,
  hasRouteTrace,
  type Graph,
} from "./call-graph-lib";

const HERE = __dirname;
const GOLD = path.join(HERE, "fp-gold.jsonl");

interface Args {
  repo: string;
  root: string;
  slice?: string;
  depth: number;
  show: number;
  /** 关闭 §49.8 的依赖注入边修复，得到「修复前」对照 */
  nodi: boolean;
  /** §49.8：额外建一张关 DI 的图做边级对照（同进程两张图，内存翻倍） */
  auditDi: boolean;
  /** §49.10：把每条 gold 的链上特征落成 JSON，供排序可行性量化（路线 A）使用 */
  json?: string;
}

function parseArgs(): Args {
  const a = process.argv.slice(2);
  const get = (k: string) => {
    const i = a.indexOf(k);
    return i >= 0 ? a[i + 1] : undefined;
  };
  const repo = get("--repo");
  const root = get("--root");
  if (!repo || !root) {
    console.error("用法: --repo <名> --root <全量目录> [--slice <切片目录>] [--depth 3] [--show 8]");
    process.exit(1);
  }
  return {
    repo,
    root,
    slice: get("--slice"),
    depth: Number(get("--depth") ?? 3),
    show: Number(get("--show") ?? 8),
    nodi: a.includes("--nodi"),
    auditDi: a.includes("--audit-di"),
    json: get("--json"),
  };
}

/**
 * 入边覆盖率：callers 为空的 callable 占比。keep 用于分层（§49.6）后重算。
 *
 * ⚠ kind==="constructor" **一律排除**：它是 §49.8 为了抽 DI 映射才加进图的，
 * 而构造函数由框架 `new` 出来，天然没有调用边 ⇒ 计入只会稀释分母，让修复**看起来变差**
 * （docmost 实测不排除时 44.8%，比修复前的 39.7% 还差——那是分母被自己的修复撑大了）。
 * 教训同 R73：改了图的构成，统计口径必须跟着改，否则读数反向。
 */
function inDegreeStats(g: Graph, keep?: (i: number) => boolean) {
  const idx = g.facts
    .map((_, i) => i)
    .filter((i) => (keep ? keep(i) : true) && g.facts[i].kind !== "constructor");
  const n = idx.length;
  let zero = 0;
  const hist = new Map<number, number>();
  for (const i of idx) {
    const c = g.callers[i]?.length ?? 0;
    if (c === 0) zero++;
    const b = c >= 5 ? 5 : c;
    hist.set(b, (hist.get(b) ?? 0) + 1);
  }
  return { n, zero, zeroPct: n ? ((zero / n) * 100).toFixed(1) : "0", hist, idx };
}

/** 从 start 沿入边上溯 depth 层，返回访问到的 fact 下标（不含 start 自身） */
function walkUp(g: Graph, start: number, depth: number): number[] {
  const seen = new Set<number>();
  let frontier = [start];
  for (let d = 0; d < depth; d++) {
    const next: number[] = [];
    for (const i of frontier) {
      for (const c of g.callers[i] ?? []) {
        if (seen.has(c)) continue;
        seen.add(c);
        next.push(c);
      }
    }
    if (!next.length) break;
    frontier = next;
  }
  return [...seen];
}

interface ChainFeat {
  matched: boolean;
  inDeg: number;
  upReached: number;
  /** 入口输入痕迹 = req.* 字面（req.body…）**或** 装饰器注入（@Body()…） */
  reachReq: boolean;
  reachReqLit: boolean;
  reachReqDecor: boolean;
  reachAuth: boolean;
  reachRoute: boolean;
}

function chainFeat(g: Graph, fn: string, file: string | undefined, depth: number): ChainFeat {
  const hits = selfFacts(g, fn, file);
  if (!hits.length) {
    return {
      matched: false, inDeg: 0, upReached: 0,
      reachReq: false, reachReqLit: false, reachReqDecor: false,
      reachAuth: false, reachRoute: false,
    };
  }
  // 多个候选时取入边最多的那个（最像"被真调用的那个"）
  const idx = hits.slice().sort((a, b) => (g.callers[b]?.length ?? 0) - (g.callers[a]?.length ?? 0))[0];
  const up = walkUp(g, idx, depth);
  const lit = up.some((i) => g.facts[i].hasReqParam);
  const decor = up.some((i) => g.facts[i].hasDecoratedInput);
  return {
    matched: true,
    inDeg: g.callers[idx]?.length ?? 0,
    upReached: up.length,
    reachReq: lit || decor,
    reachReqLit: lit,
    reachReqDecor: decor,
    reachAuth: up.some((i) => hasAuthTrace(g, i)),
    // §49.4：装饰器路由（NestJS）**或**语句级路由注册（Express/Koa/Fastify）——
    // 只认前者会让 Express 系仓库的 route 痕迹恒为 0
    reachRoute: up.some((i) => hasRouteTrace(g, i) || g.facts[i].hasRouteReg),
  };
}

function pct(x: number, n: number) {
  return n ? `${((x / n) * 100).toFixed(0)}%` : "—";
}

/** §49.6 要读源文本判断前端信号；单文件读失败按空串处理（不影响分层，只少一个信号） */
function readMaybe(p: string): string {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

function reportStats(tag: string, s: ReturnType<typeof inDegreeStats>) {
  console.log(`\n── ${tag} ──`);
  console.log(`   callable ${s.n} 个，入边为 0 的 ${s.zero} 个（${s.zeroPct}%）`);
  const parts = [...s.hist.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}${k === 5 ? "+" : ""}:${v}`);
  console.log(`   入边分布 ${parts.join("  ")}`);
}

/**
 * §49.8 边审计：同一份源码跑两遍（关 DI / 开 DI），逐 callable 比对出边目标集合。
 *
 * 为什么要单独做：只看「入边为 0 降了多少」会把功劳算错——NestJS 的 DI 命名惯例恰好是
 * `notesService ⇒ NotesService`，旧的首字母大写猜测**多数也能蒙对**。猜测的真正代价不是
 * 连不上，而是**连错**（假边在下游会把上游特征算到错误的函数头上）。
 * ⇒ 分开报「新增边 / 消失边 / 相同边」，这正是 R74 的要求。
 */
function auditDiEdges(oldG: Graph, newG: Graph, show: number) {
  let same = 0;
  const addEx: string[] = [];
  const rmEx: string[] = [];
  for (let i = 0; i < oldG.facts.length; i++) {
    if (oldG.facts[i].kind === "constructor") continue;
    const a = new Set(oldG.callees[i] ?? []);
    const b = new Set(newG.callees[i] ?? []);
    for (const t of b) {
      if (a.has(t)) {
        same++;
      } else if (addEx.length < show) {
        addEx.push(
          `${oldG.facts[i].name.slice(0, 40)}  ⇒  ${newG.facts[t].name.slice(0, 40)}  (${basename(newG.facts[t].file)})`
        );
      }
    }
    for (const t of a) {
      if (!b.has(t) && rmEx.length < show)
        rmEx.push(
          `${oldG.facts[i].name.slice(0, 40)}  ⇏  ${oldG.facts[t].name.slice(0, 40)}  (旧：猜 ${oldG.facts[t].name.split(".")[0]})`
        );
    }
  }
  const nA = oldG.callees.reduce((s, c) => s + (c?.length ?? 0), 0);
  const nB = newG.callees.reduce((s, c) => s + (c?.length ?? 0), 0);
  console.log(`\n══ §49.8 边审计（同一份源码，关 DI vs 开 DI）══`);
  console.log(`   边总数：旧 ${nA} ⇒ 新 ${nB}（${nB >= nA ? "+" : ""}${nB - nA}）`);
  console.log(`   目标一致 ${same} 条 ← 旧规则蒙对的部分，DI 只是把它坐实成精确证据`);
  addEx.forEach((s) => console.log(`     新增边：${s}`));
  rmEx.forEach((s) => console.log(`     消失边：${s}  ← 旧规则可能连错的目标`));
}

const basename = (p: string) => (p.split("/").pop() ?? p);

const args = parseArgs();

/** §49.10：逐条 gold 的链上特征，--json 时落盘供排序量化用 */
const DUMP: Array<Record<string, unknown>> = [];

console.log(`\n══ §49.1 入边摸底：${args.repo} ══`);
console.log(`全量根目录：${args.root}`);
if (args.slice) console.log(`切片目录：${args.slice}`);
console.log(`上溯深度：${args.depth}`);

const gFull = buildGraph(args.root, false, { useDi: !args.nodi });
console.log(
  `   §49.8 有接收者的边：DI 精确命中 ${gFull.edgeStats.di} 条｜` +
    `DI 已定性但目标类无此方法（不猜，宁漏勿假）${gFull.edgeStats.diMiss} 条｜` +
    `退回味类名旧规则 ${gFull.edgeStats.guess} 条` +
    (args.nodi ? "（--nodi：已关闭 DI 修复，这是修复前对照）" : "")
);
reportStats(`全量 ${args.repo}`, inDegreeStats(gFull));
if (args.auditDi) {
  const gNoDi = buildGraph(args.root, true, { useDi: false });
  auditDiEdges(gNoDi, gFull, args.show);
}
{
  const lit = gFull.facts.filter((f) => f.hasReqParam).length;
  const dec = gFull.facts.filter((f) => f.hasDecoratedInput).length;
  const any = gFull.facts.filter((f) => f.hasReqParam || f.hasDecoratedInput).length;
  console.log(
    `   入口输入痕迹：req.* 字面 ${lit} 个｜@Body() 类装饰器 ${dec} 个｜合计 ${any} 个（${pct(any, gFull.facts.length)}）`
  );
}

let gSlice: Graph | null = null;
if (args.slice) {
  gSlice = buildGraph(args.slice);
  reportStats(`切片 ${args.repo}`, inDegreeStats(gSlice));
}

// ── 第二问：gold 分组的链上特征 ──
const rows = fs
  .readFileSync(GOLD, "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l))
  .filter((r: any) => r.repo === args.repo);

console.log(`\n── gold 样本（${args.repo}）：${rows.length} 条 ──`);

const groups = new Map<string, any[]>();
for (const r of rows) {
  const k = String(r.gold ?? "?");
  const a = groups.get(k) ?? [];
  a.push(r);
  groups.set(k, a);
}

for (const [label, list] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const feats = list.map((r: any) => chainFeat(gFull, r.fn, r.file, args.depth));
  // §49.10：逐条落地，供排序可行性量化（路线 A）。只记录可以自证的特征，不做任何打分。
  list.forEach((r: any, i: number) =>
    DUMP.push({
      repo: args.repo,
      fn: String(r.fn),
      file: String(r.file ?? ""),
      rule: String(r.rule ?? ""),
      gold: String(r.gold ?? "?"),
      inDeg: feats[i].inDeg,
      upReached: feats[i].upReached,
      reachReq: feats[i].reachReq,
      reachAuth: feats[i].reachAuth,
      reachRoute: feats[i].reachRoute,
    })
  );
  const m = feats.filter((f) => f.matched);
  const withIn = feats.filter((f) => f.inDeg > 0);
  console.log(
    `\n  [${label}] ${list.length} 条｜图上定位到 ${m.length}｜有入边 ${withIn.length} (${pct(withIn.length, list.length)})`
  );
  if (!m.length) continue;
  console.log(
    `      上溯 ${args.depth} 层可达节点中位数 ${
      m.map((f) => f.upReached).sort((a, b) => a - b)[Math.floor(m.length / 2)]
    }`
  );
  console.log(
    `      撞到 req 入口  ${feats.filter((f) => f.reachReq).length} (${pct(feats.filter((f) => f.reachReq).length, list.length)})` +
      `  ← 字面 ${feats.filter((f) => f.reachReqLit).length} / 装饰器 ${feats.filter((f) => f.reachReqDecor).length}`
  );
  const reqNoAuth = feats.filter((f) => f.reachReq && !f.reachAuth).length;
  const reqAuth = feats.filter((f) => f.reachReq && f.reachAuth).length;
  const noReq = feats.filter((f) => !f.reachReq).length;
  console.log(
    `      ①有入口&无鉴权 ${reqNoAuth} (${pct(reqNoAuth, list.length)})  ` +
      `②有入口&有鉴权 ${reqAuth} (${pct(reqAuth, list.length)})  ` +
      `③追不到入口 ${noReq} (${pct(noReq, list.length)})`
  );
  console.log(`      撞到 auth 痕迹 ${feats.filter((f) => f.reachAuth).length} (${pct(feats.filter((f) => f.reachAuth).length, list.length)})`);
  console.log(`      撞到 route 痕迹 ${feats.filter((f) => f.reachRoute).length} (${pct(feats.filter((f) => f.reachRoute).length, list.length)})`);

  // 逐条展示前 N 条，便于人工核对（不只是看聚合数字）
  for (const r of list.slice(0, args.show)) {
    const f = chainFeat(gFull, r.fn, r.file, args.depth);
    const flag = `${f.matched ? "" : "✗未定位 "}in=${f.inDeg} up=${f.upReached} ${
      f.reachReq ? "REQ " : "·   "
    }${f.reachAuth ? "AUTH " : "·    "}${f.reachRoute ? "ROUTE" : "·"}`;
    console.log(`        ${r.rule.slice(0, 34).padEnd(36)} ${String(r.fn).slice(0, 40).padEnd(42)} ${flag}`);
  }
}

// ════════ §49.6 分层：剥掉前端层再数入边（2026-09-27）════════
//
// 动机（§49.5 的悬案）：hedgedoc **全量**入边为 0 是 80.5%，反而比切片 54.4% 更差。
// 怀疑是**分母稀释** ——3510 个 callable 里大头可能是前端代码，它们本来就不该有后端调用边。
//
// ⚠ 「前端」不能靠猜目录：三仓结构完全不同（docmost 扁平 src/、hedgedoc 有 frontend/、
// verdaccio 是 packages/ui-components）。⇒ 用**多信号**判定，且**逐信号打印命中数**——
// 这与 R81 是同一个道理：只给合并值的话，某一层静默失效会被读成事实。
const FE_DIR_RE = /(^|\/)(frontend|front|client|spa|web|webapp|ui|ui-components)(\/|$)/i;
const FE_PKG_RE =
  /from\s+["'](react|react-dom|vue|@vue\/[^"']*|@angular\/[^"']*|svelte|next\/\w+|@emotion\/[^"']*|styled-components)["']/;
const FE_JSX_RE =
  /\buse(?:State|Effect|Memo|Callback|Ref|Reducer|Context|Store)\s*\(|\bReact\s*\.\s*FC\b|<\/[A-Za-z][\w.]*[\s>]/;

interface FeSig {
  dir: boolean;
  ext: boolean;
  pkg: boolean;
  jsx: boolean;
}
const feSigOf = (rel: string, text: string): FeSig => ({
  dir: FE_DIR_RE.test(rel.replace(/\\/g, "/")),
  ext: /\.tsx$/i.test(rel),
  pkg: FE_PKG_RE.test(text),
  jsx: FE_JSX_RE.test(text),
});
/**
 * §49.6a：JSX/Hook 信号**不参与判定**，只作佐证打印。
 *
 * 为什么降级：纯 `.ts` 的后端文件里写 HTML 字符串是常态——邮件模板、SEO meta 生成、
 * 导入导出（docmost 的 `public-space-seo.controller.ts` / `export.service.ts` 都被 `<\/div>`
 * 这类字符串命中）。让它参与判定 ⇒ 后端文件被误剥，**而"剥离"恰恰会把真值一起剥掉**。
 *
 * 教训与 R66 同源：一个信号的**误报方向若正好指向分母**，危害比不识别更大——
 * 表现为"入边覆盖率变好了"，实际是分子被盗走了。⇒ 弱信号只许佐证，不许单独定罪。
 */
const isFe = (s: FeSig) => s.dir || s.ext || s.pkg;

{
  const layer = new Map<string, boolean>();
  const sigCount = { dir: 0, ext: 0, pkg: 0, jsx: 0 };
  const aloneCount = { dir: 0, ext: 0, pkg: 0, jsx: 0 };
  const samples: string[] = [];
  for (const rel of gFull.files) {
    const text = readMaybe(path.join(args.root, rel));
    const s = feSigOf(rel, text);
    const fe = isFe(s);
    layer.set(rel, fe);
    const keys: (keyof FeSig)[] = ["dir", "ext", "pkg", "jsx"];
    for (const k of keys) if (s[k]) sigCount[k]++;
    const on = keys.filter((k) => s[k]);
    if (on.length === 1) aloneCount[on[0]]++;
    if (fe && samples.length < 6) samples.push(`${rel}  [${on.join("+") || "?"}]`);
  }
  const feFiles = [...layer.values()].filter(Boolean).length;
  console.log(`\n══ §49.6 前端/后端分层（${args.repo}）══`);
  console.log(
    `   文件 ${gFull.files.length} 个 ⇒ 前端 ${feFiles} / 后端 ${gFull.files.length - feFiles}`
  );
  console.log(
    `   信号命中：目录 ${sigCount.dir}｜.tsx ${sigCount.ext}｜前端包 import ${sigCount.pkg}｜JSX/Hook ${sigCount.jsx}`
  );
  console.log(
    `   只被单一信号命中：目录 ${aloneCount.dir}｜.tsx ${aloneCount.ext}｜包 ${aloneCount.pkg}｜JSX ${aloneCount.jsx}` +
      `  ← 只看这里能判断哪些信号是「凑数」的`
  );
  samples.forEach((s) => console.log(`     检出前端样本：${s}`));

  const be = (i: number) => layer.get(gFull.facts[i].file) !== true;
  const sAll = inDegreeStats(gFull);
  const sBe = inDegreeStats(gFull, be);
  const sFe = inDegreeStats(gFull, (i) => !be(i));
  reportStats(`全量 ${args.repo}（不分层，对照）`, sAll);
  reportStats(`**后端层** ${args.repo}`, sBe);
  reportStats(`前端层 ${args.repo}（分母稀释源）`, sFe);

  // 硬约束校验：gold 落在前端层的，一律要报出来。
  // 若真漏洞样本在前端层，说明「剥离」会把真值一起剥掉 ⇒ 分层口径不成立（R77 分母意识）。
  const notFound = new Map<string, number>();
  for (const r of rows) {
    const k = String(r.gold ?? "?");
    const hitF = gFull.files.find((f) => f === r.file || f.endsWith(String(r.file)));
    if (!hitF) {
      notFound.set(k, (notFound.get(k) ?? 0) + 1);
      continue;
    }
    if (layer.get(hitF)) {
      notFound.set(`前端层:${k}`, (notFound.get(`前端层:${k}`) ?? 0) + 1);
    }
  }
  console.log(
    `   ⚠ gold 分层校验：` +
      ([...notFound.entries()].map(([k, v]) => `${k} ${v}`).join("｜") || "全部落在后端层，分层没有切掉真值")
  );

  // ════════ §49.7 可修漏边量化 ════════
  // 入边为 0 不等于「没人调用」，也可能是「有人叫它，但边没连上」。后者**可修**。
  // 判据不用探针手算，用 buildGraph 自己产出的断链诊断（见 Graph.unresolved 的注释）。
  const zeroIdx = sBe.idx.filter((i) => (gFull.callers[i]?.length ?? 0) === 0);
  const bareOf = (n: string) => (n.includes(".") ? n.split(".").pop()! : n);
  let quoted = 0;
  const byCat: Record<string, number> = { thisMiss: 0, inj: 0, dup: 0, nf: 0 };
  const examples: string[] = [];
  for (const i of zeroIdx) {
    const c = gFull.unresolved.get(bareOf(gFull.facts[i].name));
    if (!c) continue;
    quoted++;
    const top = (["thisMiss", "inj", "dup", "nf"] as const)
      .slice()
      .sort((a, b) => c[b] - c[a])[0];
    if (c[top] > 0) byCat[top]++;
    if (examples.length < 8)
      examples.push(
        `${gFull.facts[i].name.slice(0, 38).padEnd(40)} 断链类=${top} 调用点=${c.thisMiss + c.inj + c.dup + c.nf} 来自 ${c.files.size} 文件`
      );
  }
  console.log(`\n══ §49.7 后端层入边为 0 的 ${zeroIdx.length} 个 callable 里，有多少是真断链 ══`);
  console.log(
    `   **有人调用它、但边没连上** ${quoted} (${pct(quoted, zeroIdx.length)})  ← 有证据的可修上界`
  );
  console.log(
    `   断链原因分解：this.缺失 ${byCat.thisMiss}｜依赖注入 this.svc.x() ${byCat.inj}｜` +
      `裸调用重名歧义 ${byCat.dup}｜本仓库无此定义 ${byCat.nf}`
  );
  examples.forEach((e) => console.log(`     ${e}`));
  console.log(
    `   真无调用参照 ${zeroIdx.length - quoted} (${pct(zeroIdx.length - quoted, zeroIdx.length)})` +
      `  ← 无任何调用点提及，是死代码或图外的动态入口`
  );
}

console.log("\n读法提示：");
console.log("  ① 全量入边为 0 的比例若显著低于切片的 36%~42% ⇒ 入边缺失是切片损失，不是世界真相；");
console.log("  ② ② 的各组分布**只做对照不做判据**——分布可分不等于判据安全（R79）；");
console.log("  ③ 未定位（✗）多的组说明 gold 的函数名/文件与全量源码对不上，先修定位再谈传播。\n");

if (args.json) {
  fs.writeFileSync(args.json, DUMP.map((d) => JSON.stringify(d)).join("\n") + "\n");
  console.log(`[dump] ${DUMP.length} 条 gold 特征 → ${args.json}`);
}
