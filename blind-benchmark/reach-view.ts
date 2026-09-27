/**
 * 「谁会走到我」——入口根可达性视图（2026-09-25，§三十七）
 *
 * 动机（承 §36.5 的归因）：docmost 37 条 UNKNOWN 里 **17 条** 严调用边与宽调用边都追不到
 * 调用者，只有**文件级 import** 能指出谁引用了我。而 import ≠ call（R52）⇒ **它不能当判据**，
 * 只能当**候选提示**：告诉判定者"这条链可能从哪个路由进来、路径上哪一层带守卫"，
 * 确认动作仍由人或更高层机制完成。本脚本只生产提示，不生产结论。
 *
 * 视图定义：从目标所在文件出发，沿**反向 import 边**（谁 import 了我）上溯，
 * 直到撞上一个入口文件（含 @Controller/@Get/… 的文件）。得到的路径即
 * 「入口 → … → 我」的候选链，路径上带守卫装饰器的节点是可疑的鉴权层。
 *
 * 用法：
 *   npx tsx blind-benchmark/reach-view.ts --src /tmp/full-docmost --gold-repo docmost \
 *        [--slice docmost] [--budget 118] [--depth 4] [--max-paths 5] [--show 6]
 *
 * --slice 给定池内切片名时，会同时报告"证据在切片里还剩多少"，并自动补算
 * 同预算的闭包切片 / 轮转切片做对照（接 §三十六 的采样结论）。
 *
 * 只读分析，不改 src，不进扫描路径。
 */
import fs from "fs";
import path from "path";
import { buildGraph, Graph, hasAuthTrace, hasRouteTrace, selfFacts } from "./call-graph-lib";
import {
  importFileEdges,
  calleeFileEdges,
  unionEdges,
  reverseImports,
  roundRobinSlice,
  pickClosure,
  entryFacts,
  entryFiles,
  entryFilesFor,
  type FileEdges,
} from "./closure-sample";

const HERE = __dirname;
const POOL = path.join(HERE, "fp-pool");
const OUT_DIR = path.join(HERE, "reports");

const flag = (args: string[], name: string): string => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : "";
};

interface Target {
  fn: string;
  rule: string;
  file: string;
  gold?: string;
}

interface ReachRow {
  fn: string;
  rule: string;
  file: string;
  isEntry: boolean;
  reachable: boolean;
  minDepth: number;
  entryCount: number;
  authOnPath: boolean;
  guardFiles: string[];
  samplePath: string[];
  /** 与严调用边的一致性：严边的调用者文件是否出现在 import 路径上 */
  strictCallerOnPath: boolean | null;
}

/** 反向 BFS：从 start 沿「谁 import 了我」上溯，找所有能到达的入口 */
function reachUp(
  rev: FileEdges,
  start: string,
  allow: Set<string>,
  entrySet: Set<string>,
  depth: number
): { entries: Map<string, number>; prev: Map<string, string> } {
  const dist = new Map<string, number>([[start, 0]]);
  const prev = new Map<string, string>();
  const entries = new Map<string, number>();
  let frontier = [start];
  for (let d = 1; d <= depth; d++) {
    const next: string[] = [];
    for (const f of frontier) {
      for (const p of rev.get(f) ?? []) {
        if (!allow.has(p) || dist.has(p)) continue;
        dist.set(p, d);
        prev.set(p, f);
        if (entrySet.has(p)) entries.set(p, d);
        next.push(p);
      }
    }
    if (!next.length) break;
    frontier = next;
  }
  return { entries, prev };
}

function pathFrom(prev: Map<string, string>, start: string, end: string): string[] {
  const out = [end];
  let cur = end;
  while (prev.has(cur) && cur !== start) {
    cur = prev.get(cur)!;
    out.unshift(cur);
    if (out.length > 32) break;
  }
  return out;
}

function sliceTsFiles(dir: string): Set<string> {
  const out = new Set<string>();
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (["node_modules", "dist", ".git"].includes(e.name)) continue;
        walk(path.join(d, e.name));
      } else if (/\.tsx?$/.test(e.name)) {
        out.add(path.relative(dir, path.join(d, e.name)));
      }
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const src = flag(args, "--src");
  const goldRepo = flag(args, "--gold-repo");
  const sliceName = flag(args, "--slice");
  const budget = Number(flag(args, "--budget") || 0);
  const depth = Number(flag(args, "--depth") || 4);
  const maxPaths = Number(flag(args, "--max-paths") || 5);
  const show = Number(flag(args, "--show") || 6);
  const outName = flag(args, "--out") || goldRepo;

  if (!src || !goldRepo) {
    console.error("用法: --src <全量源码> --gold-repo <名> [--slice <池内切片名>] [--budget N]");
    process.exit(1);
  }

  const g = buildGraph(src);
  const impEdges = importFileEdges(src, g.files);
  // reverseImports 返回 Map<string,string[]>（给 evaluate 用），这里换成 Set 形态的反向边
  const rev: FileEdges = new Map(
    [...reverseImports(impEdges)].map(([k, v]) => [k, new Set(v)])
  );
  const entrySet = entryFilesFor(g, src);

  // 带守卫/鉴权痕迹的文件（路径上出现它 ⇒ 这一层可能是鉴权层）
  const guardFiles = new Set<string>();
  g.facts.forEach((f, i) => {
    if (hasAuthTrace(g, i)) guardFiles.add(f.file);
  });

  const targets: Target[] = [];
  for (const line of fs.readFileSync(path.join(HERE, "fp-gold.jsonl"), "utf8").trim().split("\n")) {
    const j = JSON.parse(line);
    if (j.repo !== goldRepo) continue;
    targets.push({ fn: j.fn, rule: j.rule, file: j.file || "", gold: j.gold });
  }
  const all = args.includes("--all");
  const unk = all ? targets : targets.filter((t) => t.gold === "UNKNOWN");
  console.log(
    `[reach] 目标：${goldRepo} 全 ${targets.length} 条` +
      (all ? `（--all：全部出提示）` : `，其中 UNKNOWN ${unk.length} 条`)
  );
  console.log(`[reach] 入口文件 ${entrySet.size} 个，带守卫痕迹文件 ${guardFiles.size} 个`);

  const evaluate = (label: string, allow: Set<string>, list: Target[]) => {
    const rows: ReachRow[] = list.map((t) => {
      const self = selfFacts(g, t.fn, t.file);
      const file = self.length ? g.facts[self[0]].file : t.file;
      const isEntry = self.length ? self.some((i) => hasRouteTrace(g, i)) : false;
      // 严调用边的调用者（用于一致性校验）
      const strictCallerFiles = new Set<string>();
      if (self.length) {
        const seen = new Set<number>(self);
        let frontier = self;
        for (let d = 0; d < 2; d++) {
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
          next.forEach((i) => strictCallerFiles.add(g.facts[i].file));
          frontier = next;
        }
      }

      if (isEntry || !allow.has(file)) {
        return {
          fn: t.fn,
          rule: t.rule,
          file,
          isEntry,
          reachable: false,
          minDepth: 0,
          entryCount: 0,
          authOnPath: false,
          guardFiles: [],
          samplePath: [],
          strictCallerOnPath: strictCallerFiles.size ? false : null,
        };
      }

      const { entries, prev } = reachUp(rev, file, allow, entrySet, depth);
      const ordered = [...entries.entries()].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1)).slice(0, maxPaths);
      const paths = ordered.map(([e]) => pathFrom(prev, file, e));
      const onPath = new Set<string>();
      paths.forEach((p) => p.forEach((f) => onPath.add(f)));
      // ⚠ 必须排除目标自身所在文件：`JwtAuthGuard.handleRequest` 这类目标本身就在守卫文件里，
      //   不排除会得到「26/26 路径带守卫」这种自证伪的满分（第一版就栽在这）。
      const guardsOnPath = [...onPath].filter((f) => f !== file && guardFiles.has(f));
      return {
        fn: t.fn,
        rule: t.rule,
        file,
        isEntry,
        reachable: entries.size > 0,
        minDepth: ordered.length ? ordered[0][1] : 0,
        entryCount: entries.size,
        authOnPath: guardsOnPath.length > 0,
        guardFiles: guardsOnPath.slice(0, 4),
        samplePath: paths[0] ?? [],
        strictCallerOnPath: strictCallerFiles.size
          ? [...strictCallerFiles].some((f) => onPath.has(f))
          : null,
      };
    });

    const covered = rows.filter((r) => r.reachable);
    const withAuth = covered.filter((r) => r.authOnPath);
    // ⚠ 分母只能是「非入口且可达」：入口自己就是链头，没有上游路径，
    //   把它们算进"不一致"会凭空造出假的不一致（hedgedoc 第一版就多出 4 条）
    const scorable = rows.filter((r) => !r.isEntry && r.reachable);
    const agree = scorable.filter((r) => r.strictCallerOnPath === true).length;
    const disagree = scorable.filter((r) => r.strictCallerOnPath === false).length;
    const nonEntry = rows.filter((r) => !r.isEntry);
    const medEntry = covered.length
      ? [...covered.map((r) => r.entryCount)].sort((a, b) => a - b)[Math.floor(covered.length / 2)]
      : 0;
    // 提示具体到能人工核吗：入口越少越可核（>10 个入口等于没说）
    const bucket = (n: number) => (n === 1 ? "1" : n <= 3 ? "2-3" : n <= 10 ? "4-10" : ">10");
    const actionable = covered.filter((r) => r.entryCount <= 3).length;
    console.log(
      `  ${label.padEnd(18)} 文件 ${String(allow.size).padStart(4)} | 非入口目标 ${String(nonEntry.length).padStart(2)} | ` +
        `可达 ${String(covered.length).padStart(2)} | 路径带守卫 ${String(withAuth.length).padStart(2)} | ` +
        `入口数中位 ${String(medEntry).padStart(3)} | 可人工核(≤3入口) ${String(actionable).padStart(2)} | 与严边一致 ${agree}/不一致 ${disagree}`
    );
    return {
      label,
      files: allow.size,
      nonEntry: nonEntry.length,
      reachable: covered.length,
      authOnPath: withAuth.length,
      medianEntryCount: medEntry,
      actionable,
      buckets: covered.reduce((m: Record<string, number>, r) => {
        const k = bucket(r.entryCount);
        m[k] = (m[k] ?? 0) + 1;
        return m;
      }, {}),
      strictAgree: agree,
      strictDisagree: disagree,
      rows,
    };
  };

  const results: Record<string, unknown> = {};
  console.log(`\n[reach] 可达性视图（UNKNOWN ${unk.length} 条）`);
  results.full = evaluate("全量（上界）", new Set(g.files), unk);

  const poolSet = sliceName ? sliceTsFiles(path.join(POOL, sliceName)) : new Set<string>();
  if (sliceName && poolSet.size) {
    const b = budget || poolSet.size;
    results.pool = evaluate(`池内切片 ${sliceName}`, poolSet, unk);
    const hyb = unionEdges(calleeFileEdges(g), impEdges);
    const entries = entryFacts(g);
    const closureFiles = pickClosure(g, entries, hyb, b, 30, 3).files;
    results.closure = evaluate(`闭包切片(${b})`, new Set(closureFiles), unk);
    results.roundRobin = evaluate(`轮转切片(${b})`, new Set(roundRobinSlice(g.files, b)), unk);
  }

  /**
   * 「提示收窄」是真还是假？
   * 切片里入口数变少，可能因为**路径被切掉**（文件不在片内 ⇒ 那条链看不见），
   * 而不是提示真的更精确。凡 slice 入口数 < 全量入口数的，都是**假精确**，
   * 逐条标出来——否则会把"文件缺失"当成"提示更集中"来庆祝。
   */
  if (results.pool) {
    const full = results.full as ReturnType<typeof evaluate>;
    const pool = results.pool as ReturnType<typeof evaluate>;
    const byKey = new Map(full.rows.map((r) => [`${r.file}|${r.fn}`, r]));
    let narrowed = 0;
    let lostReach = 0;
    for (const r of pool.rows) {
      const f = byKey.get(`${r.file}|${r.fn}`);
      if (!f) continue;
      if (f.reachable && !r.reachable) lostReach++;
      else if (f.reachable && r.reachable && r.entryCount < f.entryCount) narrowed++;
    }
    console.log(
      `\n[reach] 真假校验：切片上入口数**变少**的有 ${narrowed} 条（收窄可能来自文件缺失）、` +
        `可达性直接丢失 ${lostReach} 条 —— 这些"更具体"是假精确，不能当收益`
    );
    (results as Record<string, unknown>).narrowing = { narrowed, lostReach };
  }

  // 抽样打印几条，肉眼确认提示是否可懂
  const rFull = results.full as ReturnType<typeof evaluate>;
  console.log(`\n[reach] 示例（全量，前 ${show} 条可达目标）`);
  for (const r of rFull.rows.filter((x) => x.reachable).slice(0, show)) {
    console.log(`  ${r.fn}  [${r.rule}]`);
    console.log(`     ${r.file}`);
    console.log(`     入口 ${r.entryCount} 个（最短 ${r.minDepth} 跳）守卫层: ${r.guardFiles.join(", ") || "（无）"}`);
    console.log(`     路径: ${[...r.samplePath].reverse().join("  →  ")}`);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, `reach-view-${outName}.json`);
  fs.writeFileSync(out, JSON.stringify({ src, goldRepo, depth, targets: unk.length, results }, null, 1));
  console.log(`\n[reach] 报告 ${out}`);
}

if (process.argv[1] && /reach-view\.ts$/.test(process.argv[1])) main();
