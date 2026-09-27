/**
 * 按调用闭包采样（2026-09-24，§三十六）
 *
 * 动机（R48）：现有切片器 fp-pool-fetch.py 是**按文件独立采样**（打分 + 按目录轮转
 * 截断）。单位是「文件」，而调用链的单位是「入口 → 被调用者」这条路径 ⇒ 采样时把
 * 路径两端各自独立决定是否保留，链自然被切断。docmost 实测：426 个 .ts 取 118
 * （采样率 27%），链两端同采中概率≈平方 ⇒ 真值 UNKNOWN 37 条里只有 19% 能追溯
 * 到调用者。这不是实现问题，是采样方式决定了机制上限。
 *
 * 本脚本把采样单位换成**调用闭包**：
 *   ① 定入口（路由/控制器方法） ② 从入口沿调用边向下 BFS 取闭包
 *   ③ 名额不够时**丢整个入口**，绝不从闭包中间抽文件（那等于又回到按文件采样）
 *
 * 同时给出对照评测：同一预算（默认 120 文件）下，闭包切片 vs 旧轮转切片，
 * 对 gold UNKNOWN 的「链完整度」（自身在片内 / 调用者在片内 / 带鉴权的调用者在片内）。
 *
 * 用法：
 *   npx tsx blind-benchmark/closure-sample.ts --src /tmp/full-docmost --out docmost-closure \
 *        [--max-files 120] [--per-entry 30] [--depth 3] [--baseline docmost] [--gold-repo docmost] [--dry]
 *
 * 纯语料侧工具：不改 src，不进扫描路径。
 */
import fs from "fs";
import path from "path";
import {
  buildGraph,
  Graph,
  ROUTE_DECOR_RE,
  GUARD_DECOR_RE,
  hasAuthTrace,
  hasRouteTrace,
  selfFacts,
  EXCLUDE_DIRS,
  ROUTE_REG_RE,
} from "./call-graph-lib";

const HERE = __dirname;
const POOL = path.join(HERE, "fp-pool");
const OUT_DIR = path.join(HERE, "reports");

const flag = (args: string[], name: string): string => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : "";
};

/* ---------------- 入口识别 ---------------- */

const ROUTE_FILE_RE = /(^|\/)[^/]*\.(controller|controllers|route|routes|router|handler|handlers)\.ts$/i;
const ROUTE_DIR_RE = /(^|\/)(controllers?|routes?|routers?|handlers?|api)(\/|$)/i;

function isEntry(g: Graph, i: number): boolean {
  const f = g.facts[i];
  if (hasRouteTrace(g, i)) return true; // @Controller / @Get / @Post …
  if (ROUTE_FILE_RE.test(f.file)) return true;
  if (ROUTE_DIR_RE.test(f.file)) return true;
  return false;
}

/** 入口（路由/控制器方法）下标，确定序：同文件相邻，再按名字 */
export function entryFacts(g: Graph): number[] {
  return g.facts
    .map((_, i) => i)
    .filter((i) => isEntry(g, i))
    .sort((a, b) => {
      const fa = g.facts[a].file;
      const fb = g.facts[b].file;
      if (fa !== fb) return fa < fb ? -1 : 1;
      return g.facts[a].name < g.facts[b].name ? -1 : 1;
    });
}

/** 「文件 → 含入口」集合（reach-view 判定路径终点用） */
export function entryFiles(g: Graph): Set<string> {
  return new Set(entryFacts(g).map((i) => g.facts[i].file));
}

/**
 * 入口**文件**集合 = 装饰器入口 ∪ 文件级路由注册（`router.get(` 等）。
 * 路径终点用文件级更合适：Express 系没有装饰器，但注册点确实在那个文件里。
 */
export function entryFilesFor(g: Graph, src: string): Set<string> {
  const s = entryFiles(g);
  for (const rel of g.files) {
    try {
      if (ROUTE_REG_RE.test(fs.readFileSync(path.join(src, rel), "utf8"))) s.add(rel);
    } catch {
      /* 读不动就跳过 */
    }
  }
  return s;
}

/**
 * 闭包取片。名额不够时**丢整个入口**（R48），不从闭包中间抽文件。
 * 返回选中文件（已去重、已排序）与被跳过的入口。
 */
/** 旧版 top-N：按路径排序取前 N。实际 fp-pool/docmost 就是这么切的（118/118 完全吻合） */
export function alphaSlice(files: string[], budget: number): Set<string> {
  return new Set([...files].sort().slice(0, budget));
}

export function pickClosure(
  g: Graph,
  entries: number[],
  edges: FileEdges,
  budget: number,
  cap: number,
  depth: number
): { files: string[]; used: number; skipped: number } {
  const chosen = new Set<string>();
  let used = 0;
  let skipped = 0;
  for (const e of entries) {
    const c = closureFromFiles(edges, g.facts[e].file, depth, cap);
    const add = c.files.filter((f) => !chosen.has(f));
    if (chosen.size + add.length > budget) {
      skipped++;
      continue;
    }
    add.forEach((f) => chosen.add(f));
    used++;
  }
  return { files: [...chosen].sort(), used, skipped };
}

/* ---------------- 文件级边：调用边 / import 边 ---------------- */

export type FileEdges = Map<string, Set<string>>;
export type Mode = "callee" | "import" | "hybrid";

function addEdge(m: FileEdges, a: string, b: string) {
  if (a === b) return;
  const s = m.get(a) ?? new Set<string>();
  s.add(b);
  m.set(a, s);
}

/** 调用边（v3 严边）塌到文件级 */
export function calleeFileEdges(g: Graph): FileEdges {
  const m: FileEdges = new Map();
  g.callees.forEach((cs, i) => {
    const a = g.facts[i].file;
    for (const c of cs) addEdge(m, a, g.facts[c].file);
  });
  return m;
}

/**
 * import 边（文件级，高召回）。
 * 与调用边分工：调用边是**判据**用的（R49：假边 ⇒ 误判，宁可漏）；
 * import 边只决定**把哪些文件放进切片**（假边只是浪费名额，不会误判）。
 * 采样阶段可以而且应该用高召回的边——这是两种边混用的全部理由。
 */
/**
 * 仓库内的「包名 → 目录」映射（monorepo 工作区）与 tsconfig paths 别名。
 *
 * 为什么必须做：monorepo 里跨包引用写的是**包名**（`import x from '@verdaccio/core'`），
 * 不是相对路径。只认相对说明符 ⇒ 跨包边全断 ⇒ 可达性视图在 verdaccio 上恒为 0。
 */
function aliasTable(root: string): { pkgs: [string, string][]; paths: [string, string][] } {
  const pkgs: [string, string][] = [];
  const walkPkg = (d: string, depth: number) => {
    if (depth > 4) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (!e.isDirectory() || EXCLUDE_DIRS.has(e.name.toLowerCase())) continue;
      const p = path.join(d, e.name);
      if (fs.existsSync(path.join(p, "package.json"))) {
        try {
          const j = JSON.parse(fs.readFileSync(path.join(p, "package.json"), "utf8"));
          if (typeof j.name === "string") pkgs.push([j.name, path.relative(root, p)]);
        } catch {
          /* 忽略坏 package.json */
        }
      }
      walkPkg(p, depth + 1);
    }
  };
  try {
    walkPkg(root, 0);
  } catch {
    /* 只读失败就算了 */
  }

  const paths: [string, string][] = [];
  try {
    const raw = fs.readFileSync(path.join(root, "tsconfig.json"), "utf8").replace(/\/\*.*?\*\//gs, "");
    const j = JSON.parse(raw);
    const p = j?.compilerOptions?.paths ?? {};
    for (const [k, v] of Object.entries<unknown>(p)) {
      if (!Array.isArray(v) || typeof v[0] !== "string") continue;
      if (!k.endsWith("/*") || !String(v[0]).endsWith("/*")) continue; // 只处理通配别名
      paths.push([k.slice(0, -1), String(v[0]).slice(0, -1)]); // "@x/" -> "src/y/"
    }
  } catch {
    /* 无 tsconfig 或解析失败 */
  }
  return { pkgs, paths };
}

export function importFileEdges(root: string, files: string[]): FileEdges {
  const set = new Set(files);
  const m: FileEdges = new Map();
  const { pkgs, paths } = aliasTable(root);
  const resolveSpec = (from: string, spec: string): string | null => {
    const tryBase = (base: string): string | null => {
      for (const cand of [base + ".ts", base + ".tsx", path.join(base, "index.ts"), base]) {
        if (set.has(cand)) return cand;
      }
      return null;
    };
    if (spec.startsWith(".")) {
      return tryBase(path.normalize(path.join(path.dirname(from), spec)));
    }
    // 工作区包名：`@scope/pkg` 或 `@scope/pkg/sub`
    for (const [name, dir] of pkgs) {
      if (spec === name || spec.startsWith(name + "/")) {
        const rest = spec.slice(name.length).replace(/^\//, "");
        const hit =
          tryBase(path.normalize(path.join(dir, rest))) ||
          tryBase(path.normalize(path.join(dir, "src", rest)));
        if (hit) return hit;
      }
    }
    // tsconfig paths 别名：`@docmost/db/foo` → `src/database/foo`
    for (const [from2, to] of paths) {
      if (spec.startsWith(from2)) {
        const hit = tryBase(path.normalize(to + spec.slice(from2.length)));
        if (hit) return hit;
      }
    }
    return null;
  };
  for (const rel of files) {
    let text = "";
    try {
      text = fs.readFileSync(path.join(root, rel), "utf8");
    } catch {
      continue;
    }
    for (const mt of text.matchAll(/from\s+["']([^"']+)["']/g)) {
      const t = resolveSpec(rel, mt[1]);
      if (t) addEdge(m, rel, t);
    }
    // require(...) / import() 动态形态也收（老工程常见）
    for (const mt of text.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)) {
      const t = resolveSpec(rel, mt[1]);
      if (t) addEdge(m, rel, t);
    }
  }
  return m;
}

export function unionEdges(a: FileEdges, b: FileEdges): FileEdges {
  const m: FileEdges = new Map();
  for (const [k, v] of a) m.set(k, new Set(v));
  for (const [k, v] of b) {
    const s = m.get(k) ?? new Set<string>();
    v.forEach((x) => s.add(x));
    m.set(k, s);
  }
  return m;
}

/* ---------------- 闭包 ---------------- */

interface Closure {
  files: string[];
  rings: string[][];
  truncated: boolean;
}

function closureFromFiles(
  edges: FileEdges,
  startFile: string,
  depth: number,
  fileCap: number
): Closure {
  const seen = new Set<string>([startFile]);
  const rings: string[][] = [[startFile]];
  let frontier = [startFile];
  let truncated = false;
  for (let d = 1; d <= depth; d++) {
    const next: string[] = [];
    for (const f of frontier) for (const t of edges.get(f) ?? []) if (!seen.has(t)) next.push(t);
    next.sort();
    if (!next.length) break;
    // 整环放不下就停手：宁可少一环，也不要在环内挑文件（挑了就破坏"闭合"）
    if (seen.size + next.length > fileCap) {
      truncated = true;
      break;
    }
    next.forEach((f) => seen.add(f));
    rings.push(next);
    frontier = next;
  }
  return { files: [...seen], rings, truncated };
}

/* ---------------- 对照评测 ---------------- */

interface Target {
  fn: string;
  rule: string;
  file: string;
}

function callersUpTo(g: Graph, starts: number[], depth: number): number[] {
  const seen = new Set<number>(starts);
  const out: number[] = [];
  let frontier = starts;
  for (let d = 1; d <= depth; d++) {
    const next: number[] = [];
    for (const i of frontier) {
      for (const c of g.callers[i]) {
        if (!seen.has(c)) {
          seen.add(c);
          next.push(c);
        }
      }
    }
    if (!next.length) break;
    out.push(...next);
    frontier = next;
  }
  return out;
}

/**
 * 链/证据可见性。
 *
 * ⚠ 指标修正（2026-09-24，第一版口径错了）：把「调用者在片内」当成唯一证据，
 *   对**自身就是入口**的目标（控制器方法）是无效指标——入口的鉴权上下文写在
 *   自己的装饰器上，向上追溯本就无意义，不该判它"追不到"。
 *   正确口径：入口看自身，非入口看"谁走到我"（严调用边，退一步用文件级 import 边）。
 */
export function evaluate(
  g: Graph,
  targets: Target[],
  fileSet: Set<string>,
  depth: number,
  importParents: Map<string, string[]>
) {
  const rows = targets.map((t) => {
    const self = selfFacts(g, t.fn, t.file);
    const callers = self.length ? callersUpTo(g, self, depth) : [];
    const selfFile = self.length ? g.facts[self[0]].file : t.file;
    const isEntry = self.length ? self.some((i) => hasRouteTrace(g, i)) : false;
    const selfIn = self.some((i) => fileSet.has(g.facts[i].file));
    const callerIn = callers.some((i) => fileSet.has(g.facts[i].file));
    const authIn =
      callers.some((i) => hasAuthTrace(g, i) && fileSet.has(g.facts[i].file)) ||
      self.some((i) => hasAuthTrace(g, i) && fileSet.has(g.facts[i].file));
    // 文件级退路：谁 import 了我所在的这个文件（且那个文件在片内）
    const parentIn = (importParents.get(selfFile) ?? []).some((p) => fileSet.has(p));
    const routeParentIn = (importParents.get(selfFile) ?? []).some(
      (p) => fileSet.has(p) && g.facts.some((f, i) => f.file === p && hasRouteTrace(g, i))
    );
    const evident = isEntry ? selfIn : selfIn && (callerIn || routeParentIn);
    return {
      fn: t.fn,
      rule: t.rule,
      file: selfFile,
      isEntry,
      selfIn,
      callerIn,
      parentIn,
      routeParentIn,
      authIn,
      evident,
      decidable: evident && authIn,
    };
  });
  return {
    n: rows.length,
    selfIn: rows.filter((r) => r.selfIn).length,
    callerIn: rows.filter((r) => r.callerIn).length,
    parentIn: rows.filter((r) => r.parentIn).length,
    authIn: rows.filter((r) => r.authIn).length,
    evident: rows.filter((r) => r.evident).length,
    decidable: rows.filter((r) => r.decidable).length,
    rows,
  };
}

export function reverseImports(edges: FileEdges): Map<string, string[]> {
  const m: Map<string, string[]> = new Map();
  for (const [a, bs] of edges) {
    for (const b of bs) {
      const arr = m.get(b) ?? [];
      arr.push(a);
      m.set(b, arr);
    }
  }
  return m;
}

function sliceFiles(dir: string): Set<string> {
  const out = new Set<string>();
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (EXCLUDE_DIRS.has(e.name.toLowerCase())) continue;
        walk(path.join(d, e.name));
      } else if (/\.tsx?$/.test(e.name)) {
        out.add(path.relative(dir, path.join(d, e.name)));
      }
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}

/* ---------------- 旧采样器的等价复现（用于同预算对照） ---------------- */

/**
 * 复现 fp-pool-fetch.py 的 round_robin：优先分降序 + 路径升序排序后，
 * 按「前两级目录」分组轮转取文件。与 python 版逐行对齐（含 package.json/tsconfig
 * 的 priority=10，这里省略——它们不是 .ts，不进统计）。
 *
 * 有了它才能做**同预算**对照：否则"闭包切片"和"旧切片"的差别里混着文件数差异。
 */
export function roundRobinSlice(files: string[], maxFiles: number): string[] {
  const PREFERRED = ["src/", "api/", "server/", "app/", "packages/", "lib/"];
  const priority = (rel: string): number => {
    const low = rel.toLowerCase();
    let score = 0;
    PREFERRED.forEach((p, i) => {
      if (low.includes(p)) score = Math.max(score, PREFERRED.length - i);
    });
    if (low.includes("/test") || low.includes("/spec")) score -= 5;
    return score;
  };
  const sorted = [...files].sort((a, b) => {
    const pa = priority(a);
    const pb = priority(b);
    if (pa !== pb) return pb - pa;
    return a < b ? -1 : 1;
  });
  const groups = new Map<string, string[]>();
  const order: string[] = [];
  for (const rel of sorted) {
    const parts = rel.split(path.sep);
    const key = parts.length > 2 ? parts.slice(0, 2).join(path.sep) : parts[0] || ".";
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(rel);
  }
  const chosen: string[] = [];
  let i = 0;
  while (chosen.length < maxFiles) {
    let progressed = false;
    for (const key of order) {
      const g = groups.get(key)!;
      if (i < g.length) {
        chosen.push(g[i]);
        progressed = true;
        if (chosen.length >= maxFiles) break;
      }
    }
    if (!progressed) break;
    i++;
  }
  return chosen;
}

/* ---------------- 归因诊断：37 条为什么追不到调用者 ---------------- */

/**
 * 宽松解析器（只用于**诊断**，不用于判据）：
 *   有接收者 ⇒ 类名匹配不上也退回裸名（含 this.x() 同类内调用）；
 *   裸名 ⇒ 不再要求全局唯一。
 * 用途：区分「调用者真的不存在」与「严边规则把我自己饿死了」（R49 的代价）。
 */
function relaxedResolver(g: Graph): (q: { prop: string; method: string }) => number[] {
  return (q) => {
    if (q.prop) {
      const cls = q.prop.charAt(0).toUpperCase() + q.prop.slice(1);
      const strong = g.byFull.get(`${cls}.${q.method}`) ?? g.byFull.get(`${q.prop}.${q.method}`);
      if (strong && strong.length) return strong;
    }
    return g.byBare.get(q.method) ?? [];
  };
}

function diag(g: Graph, targets: Target[], importEdges: FileEdges) {
  const relaxed = relaxedResolver(g);
  // 松弛边：只用宽松解析器重算一次 caller，看严边丢了多少
  const relaxedCallers: number[][] = g.facts.map(() => []);
  g.facts.forEach((f, i) => {
    const hit = new Set<number>();
    for (const q of f.qcalls) for (const t of relaxed(q)) if (t !== i) hit.add(t);
    for (const t of hit) relaxedCallers[t].push(i);
  });

  // 反向 import：哪些文件 import 了目标文件（文件级"谁可能调用我"）
  const importParents: Map<string, string[]> = new Map();
  for (const [a, bs] of importEdges) for (const b of bs) {
    const arr = importParents.get(b) ?? [];
    arr.push(a);
    importParents.set(b, arr);
  }

  const rows = targets.map((t) => {
    const self = selfFacts(g, t.fn, t.file);
    const strict = self.length ? callersUpTo(g, self, 2) : [];
    const loose = new Set<number>();
    if (self.length) {
      let frontier = self;
      const seen = new Set<number>(self);
      for (let d = 0; d < 2; d++) {
        const next: number[] = [];
        for (const i of frontier) for (const c of relaxedCallers[i]) if (!seen.has(c)) { seen.add(c); next.push(c); }
        if (!next.length) break;
        next.forEach((i) => loose.add(i));
        frontier = next;
      }
    }
    const file = self.length ? g.facts[self[0]].file : t.file;
    const parents = importParents.get(file) ?? [];
    const entryReachable = self.length
      ? self.some((i) => hasRouteTrace(g, i)) ||
        loose.size > 0 ||
        parents.some((p) => g.facts.some((f, i) => f.file === p && hasRouteTrace(g, i)))
      : false;
    return {
      fn: t.fn,
      file,
      selfFound: self.length > 0,
      isEntry: self.length ? self.some((i) => hasRouteTrace(g, i)) : false,
      strictCallers: strict.length,
      looseCallers: loose.size,
      importParents: parents.length,
      /** 三种证据里任意一种能把"谁会走到我"说清 ⇒ 链可见 */
      chainVisible: strict.length > 0 || loose.size > 0 || parents.length > 0,
      entryReachable,
    };
  });

  const n = rows.length;
  const noSelf = rows.filter((r) => !r.selfFound).length;
  const entryOnly = rows.filter((r) => r.selfFound && r.isEntry && r.strictCallers === 0).length;
  const strictMissLooseHit = rows.filter((r) => r.strictCallers === 0 && r.looseCallers > 0).length;
  const bothMiss = rows.filter((r) => r.strictCallers === 0 && r.looseCallers === 0).length;
  const importRescue = rows.filter(
    (r) => r.strictCallers === 0 && r.looseCallers === 0 && r.importParents > 0
  ).length;
  const invisible = rows.filter((r) => !r.chainVisible).length;

  console.log(`\n[diag] ${n} 条 UNKNOWN 的「追不到调用者」归因：`);
  console.log(`  ① 定义都没抽出来（名字/形态不在抽取面内）      ${noSelf}`);
  console.log(`  ② 自身就是入口（向上追溯本就无意义）           ${entryOnly}`);
  console.log(`  ③ 严边漏、宽边中（R49 精度优先的代价）        ${strictMissLooseHit}`);
  console.log(`  ④ 严宽都漏，但文件级 import 能指出谁引用了我    ${importRescue}`);
  console.log(`  ⑤ 三种证据全无（真·不可见）                   ${invisible}`);
  console.log(`  ⇒ 严边可见 ${rows.filter((r) => r.strictCallers > 0).length} / ` +
    `宽边可见 ${rows.filter((r) => r.looseCallers > 0).length} / ` +
    `任一种可见 ${rows.filter((r) => r.chainVisible).length}`);
  return { rows, summary: { n, noSelf, entryOnly, strictMissLooseHit, importRescue, invisible } };
}

/* ---------------- 落盘 ---------------- */

function materialize(src: string, dest: string, files: string[]) {
  fs.mkdirSync(dest, { recursive: true });
  for (const rel of files) {
    const s = path.join(src, rel);
    const d = path.join(dest, rel);
    fs.mkdirSync(path.dirname(d), { recursive: true });
    fs.copyFileSync(s, d);
  }
  // 根配置兜底：ts-morph 缺 tsconfig.json 直接抛错（切片必须自带）
  for (const cfg of ["tsconfig.json", "package.json"]) {
    const dst = path.join(dest, cfg);
    if (fs.existsSync(dst)) continue;
    let best: string | null = null;
    let bestDepth = 99;
    const walk = (d: string, depth: number) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) {
          if (EXCLUDE_DIRS.has(e.name.toLowerCase())) continue;
          walk(path.join(d, e.name), depth + 1);
        } else if (e.name === cfg && depth < bestDepth) {
          best = path.join(d, e.name);
          bestDepth = depth;
        }
      }
    };
    walk(src, 0);
    if (!best) continue;
    if (cfg === "tsconfig.json") {
      try {
        const j = JSON.parse(fs.readFileSync(best, "utf8"));
        // 子包 tsconfig 常 extends/references 指向切片外的路径，照抄会让 ts-morph 读空
        delete j.extends;
        delete j.references;
        delete j.include;
        delete j.exclude;
        fs.writeFileSync(dst, JSON.stringify(j, null, 2));
        continue;
      } catch {
        /* 解析失败就照抄 */
      }
    }
    fs.copyFileSync(best, dst);
  }
}

/* ---------------- main ---------------- */

function main() {
  const args = process.argv.slice(2);
  const src = flag(args, "--src");
  const outName = flag(args, "--out");
  const maxFiles = Number(flag(args, "--max-files") || 120);
  const perEntry = Number(flag(args, "--per-entry") || 30);
  const depth = Number(flag(args, "--depth") || 3);
  const baseline = flag(args, "--baseline");
  const goldRepo = flag(args, "--gold-repo") || outName;
  const dry = args.includes("--dry");

  if (!src || !outName) {
    console.error("用法: --src <全量源码目录> --out <切片名> [--max-files N] [--per-entry N] [--depth N]");
    process.exit(1);
  }
  if (!fs.existsSync(src)) {
    console.error(`[closure] 源目录不存在: ${src}`);
    process.exit(1);
  }

  const g = buildGraph(src);

  const entries = g.facts.map((_, i) => i).filter((i) => isEntry(g, i));
  console.log(`[closure] 入口候选 ${entries.length} 个（路由/控制器方法）`);

  // 确定序：同文件的入口挨在一起（利于共享闭包），再按名字
  entries.sort((a, b) => {
    const fa = g.facts[a].file;
    const fb = g.facts[b].file;
    if (fa !== fb) return fa < fb ? -1 : 1;
    return g.facts[a].name < g.facts[b].name ? -1 : 1;
  });

  const eCallee = calleeFileEdges(g);
  const eImport = importFileEdges(src, g.files);
  const modes: { mode: Mode; edges: FileEdges }[] = [
    { mode: "callee", edges: eCallee },
    { mode: "import", edges: eImport },
    { mode: "hybrid", edges: unionEdges(eCallee, eImport) },
  ];
  console.log(
    `[closure] 文件级边：调用 ${[...eCallee.values()].reduce((a, s) => a + s.size, 0)} / ` +
      `import ${[...eImport.values()].reduce((a, s) => a + s.size, 0)}`
  );

  const pick = (edges: FileEdges, budget: number, cap: number = perEntry) =>
    pickClosure(g, entries, edges, budget, cap, depth);

  const picks = modes.map((m) => ({ ...m, ...pick(m.edges, maxFiles) }));
  const pickBudget = (edges: FileEdges, budget: number, cap?: number) =>
    new Set(pick(edges, budget, cap).files);

  for (const p of picks) {
    console.log(
      `  [${p.mode}] 采用入口 ${p.used} / 跳过 ${p.skipped}，切片文件 ${p.files.length}（预算 ${maxFiles}）`
    );
  }

  const writeMode = (flag(args, "--mode") || "hybrid") as Mode;
  const chosenPick = picks.find((p) => p.mode === writeMode)!;
  const files = chosenPick.files;

  if (!dry) {
    // --dest 可直接指定落盘目录（默认 fp-pool/<out>）。原型阶段先落 /tmp 试扫，
    // 别把还没定案的新切片塞进池子——fp-pool-scan 会把池子里的东西全扫一遍。
    const dest = flag(args, "--dest") || path.join(POOL, outName);
    if (fs.existsSync(dest)) {
      console.error(`[closure] 目标已存在，先手工删除: ${dest}`);
      process.exit(1);
    }
    materialize(src, dest, files);
    console.log(`[closure] 已落盘 ${dest}（mode=${writeMode}）`);
  }

  /* ---- 对照评测 ---- */
  const goldPath = path.join(HERE, "fp-gold.jsonl");
  const targets: Target[] = [];
  if (fs.existsSync(goldPath)) {
    for (const line of fs.readFileSync(goldPath, "utf8").trim().split("\n")) {
      const j = JSON.parse(line);
      if (j.repo !== goldRepo) continue;
      if (j.gold !== "UNKNOWN") continue;
      targets.push({ fn: j.fn, rule: j.rule, file: j.file || "" });
    }
  }
  console.log(`\n[eval] 真值目标（${goldRepo} / UNKNOWN）${targets.length} 条`);

  const impParents = reverseImports(eImport);
  const stat = (label: string, set: Set<string>) => {
    const r = evaluate(g, targets, set, 2, impParents);
    console.log(
      `  ${label.padEnd(22)} 文件 ${String(set.size).padStart(4)} | ` +
        `自身 ${String(r.selfIn).padStart(2)} | 调用者 ${String(r.callerIn).padStart(2)} | ` +
        `引用方 ${String(r.parentIn).padStart(2)} | 鉴权可见 ${String(r.authIn).padStart(2)} | ` +
        `证据完整 ${String(r.evident).padStart(2)} | 可定判 ${String(r.decidable).padStart(2)}`
    );
    return r;
  };

  // 先打上界：全量源码都进片时的链完整度 = 采样方式无论怎么改都超不过的天花板
  stat("全量（上界）", new Set(g.files));
  const rows: Record<string, unknown> = {};
  for (const p of picks) rows[p.mode] = stat(`闭包切片 [${p.mode}]`, new Set(p.files));
  const baseSet = baseline ? sliceFiles(path.join(POOL, baseline)) : new Set<string>();
  const rBase = baseline ? stat(`旧轮转切片（${baseline}）`, baseSet) : null;
  if (baseline && !baseSet.size) console.log(`  [warn] 基线切片 ${baseline} 不存在或为空`);

  const d = args.includes("--diag") ? diag(g, targets, eImport) : null;

  /* ---- 预算扫描：闭包采样到底在什么规模下才赢过旧轮转 ---- */
  if (args.includes("--sweep")) {
    const hyb = unionEdges(eCallee, eImport);
    console.log(`\n[sweep] 同预算对照（目标 ${targets.length} 条；每格 = 证据完整/可定判）`);
    console.log("  预算 | 闭包30       | 闭包15       | 旧 topN(路径序) | 现轮转       | 调用者可见 闭30/闭15/topN/轮转");
    for (const b of [30, 50, 80, 120, 180, 260, 390]) {
      const s30 = pickBudget(hyb, b, 30);
      const s15 = pickBudget(hyb, b, 15);
      const c30 = evaluate(g, targets, s30, 2, impParents);
      const c15 = evaluate(g, targets, s15, 2, impParents);
      const aSet = alphaSlice(g.files, b);
      const ra = evaluate(g, targets, aSet, 2, impParents);
      const rr = evaluate(g, targets, new Set(roundRobinSlice(g.files, b)), 2, impParents);
      const cell = (n: number, e: number, d: number) => `${String(n).padStart(3)}f ${String(e).padStart(2)}/${String(d).padStart(2)}`;
      console.log(
        `  ${String(b).padStart(4)} | ${cell(s30.size, c30.evident, c30.decidable)} | ${cell(s15.size, c15.evident, c15.decidable)} | ` +
          `${cell(aSet.size, ra.evident, ra.decidable)} | ${cell(b, rr.evident, rr.decidable)} | ` +
          `${String(c30.callerIn).padStart(2)} / ${String(c15.callerIn).padStart(2)} / ${String(ra.callerIn).padStart(2)} / ${String(rr.callerIn).padStart(2)}`
      );
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, `closure-sample-${outName}.json`);
  fs.writeFileSync(
    out,
    JSON.stringify(
      {
        src,
        outName,
        maxFiles,
        perEntry,
        depth,
        totalSourceFiles: g.files.length,
        callables: g.facts.length,
        entries: entries.length,
        mode: writeMode,
        picks: picks.map((p) => ({
          mode: p.mode,
          files: p.files.length,
          entriesUsed: p.used,
          entriesSkipped: p.skipped,
          sliceFiles: p.files,
        })),
        sliceFiles: files,
        eval: {
          targets: targets.length,
          ceiling: evaluate(g, targets, new Set(g.files), 2, impParents),
          byMode: rows,
          baseline: rBase ? { name: baseline, files: baseSet.size, ...rBase } : null,
          diag: d,
        },
      },
      null,
      1
    )
  );
  console.log(`\n[closure] 报告 ${out}`);
}

// 被 reach-view.ts 复用时不要自动跑 main
if (process.argv[1] && /closure-sample\.ts$/.test(process.argv[1])) main();
