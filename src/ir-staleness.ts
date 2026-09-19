import * as fs from "fs";
import * as path from "path";

/**
 * ir.json 陈旧性判定（2026-09-19，独立于污点试点立项）。
 *
 * 背景（真实事故，两次会话级误判）：
 * - trust 引擎的自动提取是「缺才提取」：项目已有 ir.json 就以文件为准、不重生成。
 * - 该语义在【源码变了但 ir.json 没变】的场景下静默过期——
 *   ① 分析器读的是旧调用序列（fix-regression 复测结论可能是哑值）；
 *   ② P4.5 注解合并读同一个 ir.json，旧文件让新加的 @protocol 注解不生效。
 * - fr-005 首扫报 0（`rm ir.json` 后才报出）、污点试点 V1 的「标记注入但 trust 报 0」
 *   根因都是同一处。
 *
 * 政策：mtime 比对，不做「每次全量重提」。
 * - 全量重提对 skyvern 级项目是 5–10 分钟量级成本，不能默认付；
 * - 只在【存在源文件 mtime > ir.json mtime】时才重提，常量级开销（一次 stat 遍历）。
 * 政策：mtime 比对，不做「每次全量重提」。
 * - 全量重提对 skyvern 级项目是 5–10 分钟量级成本，不能默认付；对本仓库
 *   （22k 源文件）足以触发单测 30s 超时——实测教训，见 tests/trust/engine.test.ts。
 * - 只在【存在源文件 mtime > ir.json mtime】时才重提（一次 stat 遍历，恒定成本）。
 * - 超大仓库（遍历被 MAX_STATS 截断）默认【只警告不重提】：此时 freshness 证据
 *   不完整，自动重提会把 CLI 拖到分钟级。确需重提时显式 PROGMUNE_IR_REEXTRACT=always。
 *
 * 策略阀 `PROGMUNE_IR_REEXTRACT`：
 * - 未设（auto）：遍历完整且陈旧 → 重提；遍历被截断 → 只警告
 * - always      ：只要陈旧就重提（自担成本，用于批量语料复测）
 * - never       ：回到旧语义（永不重提），但会打「IR 可能陈旧」警告——不允许静默。
 */

/** 会被提取器读取的源码后缀（跨语言；不在表内的文件不影响 IR 内容）。 */
const SOURCE_EXT = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".c", ".h", ".cc", ".cpp", ".hpp",
  ".go", ".java", ".rs", ".rb", ".php", ".cs", ".swift", ".kt", ".scala",
]);

/** 不可能是业务源码、且体量足以毁掉遍历成本的目录。 */
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", "coverage", ".next",
  ".nuxt", ".turbo", ".cache", "__pycache__", ".venv", "venv", "vendor",
  "target", "bin", "obj", ".gradle", ".idea", ".vscode", ".workbuddy",
]);

/** 防御性上限：超大仓库不做无界遍历（宁可漏判也不卡死）。 */
const MAX_STATS = 20_000;
const MAX_DEPTH = 12;

/**
 * auto 模式下愿意为「一次 IR 重提」买单的项目规模上限（源码文件数）。
 * 超过则只警告不自动重提——重提成本随文件数超线性增长，本仓库（万级源文件）
 * 实测足以把单测推过 30s 超时。
 */
const AUTO_REEXTRACT_FILE_BUDGET = 5_000;

export type IrFreshnessReason =
  | "missing"        // ir.json 不存在 → 按现语义也必须提取
  | "source-newer"   // 存在源码比 ir.json 新 → 陈旧
  | "fresh"          // ir.json 不早于任何源码 → 以文件为准
  | "no-sources";    // 扫不到任何源文件 → 无证据，保守按 fresh 处理

export interface IrFreshnessOptions {
  /** 覆盖默认 MAX_STATS（测试用） */
  maxStats?: number;
  maxDepth?: number;
  /** 覆盖默认 AUTO_REEXTRACT_FILE_BUDGET（测试用） */
  autoBudget?: number;
}

export interface IrFreshness {
  /** ir.json 是否存在 */
  exists: boolean;
  /** 是否需要（重新）提取 */
  stale: boolean;
  reason: IrFreshnessReason;
  irMtimeMs: number | null;
  /** 证据文件：首个（且通常是最新）新于 ir.json 的源码 */
  newestSourceMtimeMs: number | null;
  newestSourcePath: string | null;
  scannedFiles: number;
  /** 是否触碰到了上限（见下）——判定证据不完整 */
  truncated: boolean;
  /** 遍历是否完整覆盖：false 意味着「fresh」不可信（超大仓库的代价取舍） */
  evidenceComplete: boolean;
  /** 源码规模是否超出 auto 模式愿意重提的预算 */
  exceedsAutoBudget: boolean;
}

/**
 * 扫描项目目录，找出最新修改的源码文件。
 *
 * 必须【完整遍历】（不做「找到第一个更新的就早退」）：早退会在超大仓库上
 * 把 truncated 信号抹掉——本仓库（22k 源文件）就是活例：早退后 evidenceComplete
 * 误为真 → 自动全量重提 → 单测 30s 超时。stat 扫一遍的成本远低于一次 IR 提取，
 * 换来的是可靠的 fresh 判定与可靠的大仓信号。
 *
 * @requires PROJECT_PATH @produces NEWEST_SOURCE
 * @tags ir, staleness, mtime
 */
function newestSourceUnder(
  root: string,
  opts: IrFreshnessOptions
): {
  mtimeMs: number | null;
  file: string | null;
  scannedFiles: number;
  truncated: boolean;
} {
  const maxStats = opts.maxStats ?? MAX_STATS;
  const maxDepth = opts.maxDepth ?? MAX_DEPTH;
  let newestMs: number | null = null;
  let newestFile: string | null = null;
  let scanned = 0;
  let truncated = false;

  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth || truncated) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // 权限 / 竞态删除：跳过
    }
    for (const ent of entries) {
      if (truncated) return;
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        if (ent.name.startsWith(".")) continue; // 隐藏目录多为工具产物
        walk(path.join(dir, ent.name), depth + 1);
        continue;
      }
      if (!ent.isFile()) continue;
      if (!SOURCE_EXT.has(path.extname(ent.name).toLowerCase())) continue;
      if (scanned >= maxStats) { truncated = true; return; }
      const full = path.join(dir, ent.name);
      let st: fs.Stats | undefined;
      try {
        st = fs.statSync(full, { throwIfNoEntry: false }) ?? undefined;
      } catch {
        st = undefined;
      }
      if (!st) continue;
      scanned++;
      if (newestMs === null || st.mtimeMs > newestMs) {
        newestMs = st.mtimeMs;
        newestFile = full;
      }
    }
  };

  walk(root, 0);
  return { mtimeMs: newestMs, file: newestFile, scannedFiles: scanned, truncated };
}

/**
 * 判定 ir.json 是否需要重新生成。
 *
 * - ir.json 不存在 → missing（需提取）
 * - 存在源码 mtime > ir.json mtime → source-newer（需重提）
 * - 其余 → fresh / no-sources（沿用磁盘文件）
 *
 * @requires PROJECT_PATH @produces IR_FRESHNESS
 * @tags ir, staleness, mtime
 * @useWhen evaluateTrust 决定是否自动提取 IR
 */
export function inspectIrFreshness(
  projectPath: string,
  irPathOverride?: string,
  opts: IrFreshnessOptions = {}
): IrFreshness {
  const irPath = irPathOverride || path.join(projectPath, "ir.json");
  let irStat: fs.Stats | undefined;
  try {
    irStat = fs.statSync(irPath, { throwIfNoEntry: false }) ?? undefined;
  } catch {
    irStat = undefined;
  }

  const irMtimeMs = irStat ? irStat.mtimeMs : null;
  const src = newestSourceUnder(projectPath, opts);
  const exceedsAutoBudget = src.scannedFiles > (opts.autoBudget ?? AUTO_REEXTRACT_FILE_BUDGET);

  if (!irStat) {
    return {
      exists: false,
      stale: true,
      reason: "missing",
      irMtimeMs: null,
      newestSourceMtimeMs: src.mtimeMs,
      newestSourcePath: src.file,
      scannedFiles: src.scannedFiles,
      truncated: src.truncated,
      evidenceComplete: false, // 是否有证据都不影响：缺就必须提
      exceedsAutoBudget,
    };
  }

  if (src.mtimeMs === null) {
    // 扫不到源码（目标目录不是真源码根，或全是跳过后缀）：无证据 → 保守沿用。
    return {
      exists: true,
      stale: false,
      reason: "no-sources",
      irMtimeMs,
      newestSourceMtimeMs: null,
      newestSourcePath: null,
      scannedFiles: 0,
      truncated: src.truncated,
      evidenceComplete: !src.truncated,
      exceedsAutoBudget,
    };
  }

  // 严格大于：ir.json 与源码同刻写出（写源码→随后写 ir.json 的常见顺序）
  // 判为 fresh，避免把正常管线推入全量重提。
  const stale = irMtimeMs !== null && src.mtimeMs > irMtimeMs;
  return {
    exists: true,
    stale,
    reason: stale ? "source-newer" : "fresh",
    irMtimeMs,
    newestSourceMtimeMs: src.mtimeMs,
    newestSourcePath: src.file,
    scannedFiles: src.scannedFiles,
    truncated: src.truncated,
    evidenceComplete: !src.truncated,
    exceedsAutoBudget,
  };
}

/** 重提策略：auto（默认）/ always / never。 */
export type ReextractMode = "auto" | "always" | "never";

export function reextractMode(): ReextractMode {
  const v = (process.env.PROGMUNE_IR_REEXTRACT || "").toLowerCase();
  if (v === "always") return "always";
  if (v === "never" || v === "off" || v === "0" || v === "false") return "never";
  return "auto";
}

export function reextractEnabled(): boolean {
  return reextractMode() !== "never";
}
