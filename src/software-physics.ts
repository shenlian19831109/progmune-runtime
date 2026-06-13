/**
 * P6.2: Software Physics Engine — Protocol Structure Learning
 *
 * Maps diverse function names to abstract protocol patterns.
 * This is the bridge from "Function Memorization" to "Protocol Learning."
 *
 * Core insight: fopen, sqlite3_open, db_connect, socket() are all
 * the SAME thing — RESOURCE_ACQUIRE. The system should learn the
 * pattern, not the name.
 *
 * Five fundamental Software Physics patterns:
 *   1. Acquire-Release   (resource lifecycle)
 *   2. Lock-Unlock       (mutual exclusion)
 *   3. Begin-Commit      (transactional consistency)
 *   4. Authenticate-Act  (identity verification)
 *   5. Allocate-Free     (memory lifecycle)
 */

// ═══════════════════════════════════════════════════════════════
// Software Physics Patterns
// ═══════════════════════════════════════════════════════════════

export type PhysicsPattern =
  | "RESOURCE_ACQUIRE"
  | "RESOURCE_USE"
  | "RESOURCE_RELEASE"
  | "LOCK_ACQUIRE"
  | "LOCK_RELEASE"
  | "TRANSACTION_BEGIN"
  | "TRANSACTION_COMMIT"
  | "TRANSACTION_ROLLBACK"
  | "AUTHENTICATE"
  | "AUTHORIZE"
  | "MEMORY_ALLOCATE"
  | "MEMORY_FREE"
  | "UNKNOWN";

export interface PhysicsAnnotation {
  function: string;
  pattern: PhysicsPattern;
  confidence: number;
  phase: "acquire" | "use" | "release" | "other";
}

/**
 * Keyword-based pattern recognition.
 *
 * Maps function name substrings to Software Physics patterns.
 * This is a lightweight symbolic approach — no ML needed.
 */
const PHYSICS_KEYWORDS: Record<string, { pattern: PhysicsPattern; phase: PhysicsAnnotation["phase"] }> = {
  // Acquire patterns
  open:    { pattern: "RESOURCE_ACQUIRE",  phase: "acquire" },
  connect: { pattern: "RESOURCE_ACQUIRE",  phase: "acquire" },
  create:  { pattern: "RESOURCE_ACQUIRE",  phase: "acquire" },
  alloc:   { pattern: "MEMORY_ALLOCATE",   phase: "acquire" },
  malloc:  { pattern: "MEMORY_ALLOCATE",   phase: "acquire" },
  accept:  { pattern: "RESOURCE_ACQUIRE",  phase: "acquire" },
  begin:   { pattern: "TRANSACTION_BEGIN", phase: "acquire" },
  start:   { pattern: "TRANSACTION_BEGIN", phase: "acquire" },

  // Release patterns
  close:    { pattern: "RESOURCE_RELEASE",   phase: "release" },
  disconnect: { pattern: "RESOURCE_RELEASE", phase: "release" },
  destroy:  { pattern: "RESOURCE_RELEASE",   phase: "release" },
  free:     { pattern: "MEMORY_FREE",        phase: "release" },
  release:  { pattern: "RESOURCE_RELEASE",   phase: "release" },
  finalize: { pattern: "RESOURCE_RELEASE",   phase: "release" },
  commit:   { pattern: "TRANSACTION_COMMIT", phase: "release" },
  rollback: { pattern: "TRANSACTION_ROLLBACK", phase: "release" },
  finish:   { pattern: "TRANSACTION_COMMIT", phase: "release" },

  // Use patterns
  read:   { pattern: "RESOURCE_USE", phase: "use" },
  write:  { pattern: "RESOURCE_USE", phase: "use" },
  query:  { pattern: "RESOURCE_USE", phase: "use" },
  exec:   { pattern: "RESOURCE_USE", phase: "use" },
  send:   { pattern: "RESOURCE_USE", phase: "use" },
  recv:   { pattern: "RESOURCE_USE", phase: "use" },
  step:   { pattern: "RESOURCE_USE", phase: "use" },

  // Lock patterns
  lock:   { pattern: "LOCK_ACQUIRE",  phase: "acquire" },
  unlock: { pattern: "LOCK_RELEASE",  phase: "release" },
  mutex:  { pattern: "LOCK_ACQUIRE",  phase: "acquire" },

  // Auth patterns
  verify:  { pattern: "AUTHENTICATE", phase: "acquire" },
  auth:    { pattern: "AUTHENTICATE", phase: "acquire" },
  login:   { pattern: "AUTHENTICATE", phase: "acquire" },
  logout:  { pattern: "RESOURCE_RELEASE", phase: "release" },
  signin:  { pattern: "AUTHENTICATE", phase: "acquire" },
  signout: { pattern: "RESOURCE_RELEASE", phase: "release" },
};

/**
 * Canonicalize a function name to a Software Physics pattern.
 *
 * Examples:
 *   "fopen"       → RESOURCE_ACQUIRE
 *   "sqlite3_open" → RESOURCE_ACQUIRE
 *   "db_connect"  → RESOURCE_ACQUIRE
 *   "fclose"      → RESOURCE_RELEASE
 *   "ngx_close_connection" → RESOURCE_RELEASE
 */
export function canonicalize(fnName: string): PhysicsAnnotation {
  const lower = fnName.toLowerCase();

  let bestMatch: PhysicsAnnotation = { function: fnName, pattern: "UNKNOWN", confidence: 0, phase: "other" };

  for (const [keyword, info] of Object.entries(PHYSICS_KEYWORDS)) {
    if (lower.includes(keyword)) {
      // Longer keyword match = higher confidence
      // Longer keyword = higher base confidence
      // Position bonus: keywords at word boundaries get +0.2
      let confidence = keyword.length / lower.length;
      const kwPos = lower.indexOf(keyword);
      if (kwPos === 0 || (kwPos > 0 && lower[kwPos - 1] === '_')) confidence += 0.2;
      if (confidence > bestMatch.confidence) {
        bestMatch = { function: fnName, pattern: info.pattern, confidence, phase: info.phase };
      }
    }
  }

  return bestMatch;
}

/**
 * Canonicalize a sequence of function calls into a Physics phase sequence.
 *
 * Example:
 *   ["fopen", "fread", "fclose"] → [ACQUIRE, USE, RELEASE]
 */
export function canonicalizeSequence(fns: string[]): PhysicsAnnotation[] {
  return fns.map(canonicalize);
}

/**
 * Check if a call sequence forms a valid Software Physics pattern.
 *
 * A valid Acquire-Use-Release sequence: ACQUIRE → (USE*) → RELEASE
 * A valid transaction: BEGIN → (USE*) → COMMIT|ROLLBACK
 * A valid lock: LOCK → (USE*) → UNLOCK
 */
export function isValidPhysicsSequence(fns: string[]): { valid: boolean; pattern: string; detail: string } {
  if (fns.length < 2) return { valid: false, pattern: "none", detail: "Too short" };

  const seq = canonicalizeSequence(fns);
  const phases = seq.map(s => s.phase);

  const hasAcquire = phases.includes("acquire");
  const hasRelease = phases.includes("release");
  const lastRelease = phases.lastIndexOf("release");
  const firstAcquire = phases.indexOf("acquire");

  // Valid: acquire comes before release
  if (hasAcquire && hasRelease && firstAcquire < lastRelease) {
    const patterns = [...new Set(seq.map(s => s.pattern))];
    return { valid: true, pattern: patterns.join("→"), detail: `${patterns.length} physics patterns in valid order` };
  }

  return { valid: false, pattern: "incomplete", detail: "Missing acquire or release phase" };
}

// ═══════════════════════════════════════════════════════════════
// Cross-Repository Structure Mining
// ═══════════════════════════════════════════════════════════════

export interface CrossRepoAnalysis {
  repo: string;
  functions: string[];
  patterns: Map<PhysicsPattern, string[]>;
  coverage: number;  // fraction of functions mapped to a known pattern
}

/**
 * Analyze a repository's functions through the Software Physics lens.
 *
 * Maps every function name to a Physics pattern, groups by pattern,
 * and computes coverage (how many functions are recognized).
 */
export function analyzeRepoPhysics(
  repoName: string,
  functions: string[]
): CrossRepoAnalysis {
  const patterns = new Map<PhysicsPattern, string[]>();
  let recognized = 0;

  for (const fn of functions) {
    const annotation = canonicalize(fn);
    if (annotation.pattern !== "UNKNOWN") {
      recognized++;
      const list = patterns.get(annotation.pattern) || [];
      list.push(fn);
      patterns.set(annotation.pattern, list);
    }
  }

  return {
    repo: repoName,
    functions,
    patterns,
    coverage: functions.length > 0 ? recognized / functions.length : 0,
  };
}

/**
 * Compare two repositories to find shared Physics patterns.
 *
 * Even if the function names are completely different
 * (fopen vs sqlite3_open), the Physics patterns should match.
 */
export function compareRepoPhysics(a: CrossRepoAnalysis, b: CrossRepoAnalysis): {
  sharedPatterns: PhysicsPattern[];
  similarity: number;
  detail: string;
} {
  const aPatterns = new Set(a.patterns.keys());
  const bPatterns = new Set(b.patterns.keys());
  const shared = [...aPatterns].filter(p => bPatterns.has(p) && p !== "UNKNOWN");

  const totalPatterns = new Set([...aPatterns, ...bPatterns]);
  const similarity = totalPatterns.size > 0 ? shared.length / totalPatterns.size : 0;

  return {
    sharedPatterns: shared,
    similarity,
    detail: shared.length > 0
      ? `${shared.length} shared patterns (${shared.join(", ")})`
      : "No shared physics patterns — structurally unrelated",
  };
}

// ═══════════════════════════════════════════════════════════════
// Known Repository Signatures
// ═══════════════════════════════════════════════════════════════

export const KNOWN_REPO_SIGNATURES: Record<string, string[]> = {
  Redis:       ["createClient", "sendCommand", "readReply", "closeClient", "selectDB", "getKey", "setKey"],
  SQLite:      ["sqlite3_open", "sqlite3_prepare", "sqlite3_step", "sqlite3_finalize", "sqlite3_exec", "sqlite3_close"],
  nginx:       ["ngx_accept_connection", "ngx_read_request", "ngx_process_request", "ngx_send_response", "ngx_close_connection", "ngx_parse_headers"],
  PostgreSQL:  ["PQconnectdb", "PQexec", "PQfinish", "begin_transaction", "execute_query", "commit_transaction"],
  LevelDB:     ["DB_Open", "DB_Get", "DB_Put", "DB_Close", "DB_Write", "DB_Compact"],
};

export interface CrossRepoReport {
  analyses: CrossRepoAnalysis[];
  pairwise: { a: string; b: string; similarity: number }[];
  avgCoverage: number;
  avgSimilarity: number;
  verdict: "structure_learned" | "partial" | "name_memorized";
}

/**
 * Full cross-repository physics analysis.
 */
export function analyzeCrossRepoPhysics(): CrossRepoReport {
  const analyses: CrossRepoAnalysis[] = [];
  const pairwise: { a: string; b: string; similarity: number }[] = [];

  const repos = Object.entries(KNOWN_REPO_SIGNATURES);
  for (const [name, fns] of repos) {
    analyses.push(analyzeRepoPhysics(name, fns));
  }

  for (let i = 0; i < analyses.length; i++) {
    for (let j = i + 1; j < analyses.length; j++) {
      const comp = compareRepoPhysics(analyses[i], analyses[j]);
      pairwise.push({ a: analyses[i].repo, b: analyses[j].repo, similarity: comp.similarity });
    }
  }

  const avgCoverage = analyses.reduce((s, a) => s + a.coverage, 0) / analyses.length;
  const avgSimilarity = pairwise.reduce((s, p) => s + p.similarity, 0) / pairwise.length;

  const verdict: CrossRepoReport["verdict"] =
    avgSimilarity > 0.5 ? "structure_learned" :
    avgSimilarity > 0.3 ? "partial" :
    "name_memorized";

  return { analyses, pairwise, avgCoverage, avgSimilarity, verdict };
}

export function printCrossRepoReport(report: CrossRepoReport): void {
  console.log("\n╔════════════════════════════════════════════════════╗");
  console.log("║   P6.2 Software Physics — Cross-Repo Analysis      ║");
  console.log("╚════════════════════════════════════════════════════╝\n");

  console.log(`Repos Analyzed: ${report.analyses.length}`);
  console.log(`Avg Coverage:   ${(report.avgCoverage * 100).toFixed(0)}%`);
  console.log(`Avg Similarity: ${(report.avgSimilarity * 100).toFixed(0)}%`);
  console.log(`Verdict:        ${report.verdict.toUpperCase()}`);
  console.log();

  console.log("─── Per-Repo Physics Coverage ───");
  for (const a of report.analyses) {
    const cov = (a.coverage * 100).toFixed(0).padStart(4);
    const patternList = [...a.patterns.entries()]
      .filter(([p]) => p !== "UNKNOWN")
      .map(([p, fns]) => `${p}(${fns.length})`)
      .join(", ");
    console.log(`  ${a.repo.padEnd(12)} ${cov}%  patterns: ${patternList || "none"}`);
  }
  console.log();

  console.log("─── Pairwise Similarity ───");
  for (const p of report.pairwise) {
    const sim = (p.similarity * 100).toFixed(0).padStart(4);
    console.log(`  ${p.a.padEnd(12)} ↔ ${p.b.padEnd(12)} ${sim}%`);
  }
  console.log();
}
