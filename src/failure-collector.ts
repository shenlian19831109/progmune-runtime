/**
 * Phase 7: Failure Corpus — collect and categorize emitter failures.
 *
 * Records every failed progmune_execute attempt with root cause classification.
 * Feeds the Emitter Intelligence loop: collect → classify → fix → verify.
 */

import * as fs from "fs";

export type RootCause =
  | "F01" | "F02" | "F03" | "F04" | "F05"
  | "F06" | "F07" | "F08" | "F09" | "F10";

export interface FailureRecord {
  id: string;
  timestamp: number;
  intent: string;
  stage: "plan" | "compile";
  plan?: string[];
  generated?: string;
  compileErrors?: string[];
  rootCause: RootCause;
  sessionId?: string;
}

const CORPUS_DIR = "failure-corpus";

/** Classify a compile error string into a root cause. */
/** Classify a compile error into a root cause category. */
/** @requires ERROR_STRING @produces ROOT_CAUSE */
/** @requires ERROR_STRING @produces ROOT_CAUSE */
export function classifyError(error: string): RootCause {
  if (!error) return "F10";
  if (error.includes("declares") && error.includes("locally")) return "F01";
  if (error.includes("Cannot find module") || error.includes("has no exported member")) return "F02";
  if (error.includes("is not assignable") || error.includes("Type")) return "F03";
  if (error.includes("Expected") && error.includes("arguments")) return "F04";
  if (error.includes("Cannot find name")) return "F06";
  if (error.includes("is not a function") || error.includes("not callable")) return "F05";
  if (error.includes("return") && error.includes("type")) return "F08";
  return "F10";
}

/** Classify a planning failure. */
/** Classify a planning failure into a root cause category. */
/** @requires ERROR_STRING @produces ROOT_CAUSE */
/** @requires ERROR_STRING @produces ROOT_CAUSE */
export function classifyPlanError(error: string): RootCause {
  if (!error) return "F10";
  if (error.includes("protocol") || error.includes("SSG")) return "F09";
  if (error.includes("Cannot read properties") || error.includes("undefined")) return "F07";
  return "F07"; // most plan failures are parsing issues
}

/** Record a failure and save to disk. */
/** Record a generation failure to the failure corpus. */
/** @requires FAILURE_EVENT @produces FAILURE_ID */
export function recordFailure(record: Omit<FailureRecord, "id" | "timestamp">): string {
  const id = `F-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const entry: FailureRecord = {
    ...record,
    id,
    timestamp: Date.now(),
  };

  try {
    if (!fs.existsSync(CORPUS_DIR)) fs.mkdirSync(CORPUS_DIR, { recursive: true });
    fs.writeFileSync(
      `${CORPUS_DIR}/${id}.json`,
      JSON.stringify(entry, null, 2),
      "utf-8"
    );
  } catch {}

  return id;
}

/** Load all recorded failures. */
/** Load all recorded failures from the failure corpus. */
/** @requires FAILURE_CORPUS @produces FAILURE_LIST */
/** @requires FAILURE_CORPUS @produces FAILURE_LIST */
/** @requires FAILURE_CORPUS @produces FAILURE_LIST */
export function loadFailures(): FailureRecord[] {
  if (!fs.existsSync(CORPUS_DIR)) return [];
  const failures: FailureRecord[] = [];
  for (const f of fs.readdirSync(CORPUS_DIR)) {
    if (!f.endsWith(".json") || f === "schema.json") continue;
    try {
      failures.push(JSON.parse(fs.readFileSync(`${CORPUS_DIR}/${f}`, "utf-8")));
    } catch {}
  }
  return failures.sort((a, b) => b.timestamp - a.timestamp);
}

/** Get failure statistics grouped by root cause. */
/** Get failure statistics grouped by root cause. */
/** @requires FAILURE_LIST @produces FAILURE_STATS */
/** @requires FAILURE_LIST @produces FAILURE_STATS */
/** @requires FAILURE_LIST @produces FAILURE_STATS */
/** @useWhen dashboard; health report; monitoring system status */
export function failureStats(): { total: number; byRootCause: Record<string, number>; topCause: string } {
  const failures = loadFailures();
  const byRootCause: Record<string, number> = {};
  for (const f of failures) {
    byRootCause[f.rootCause] = (byRootCause[f.rootCause] || 0) + 1;
  }
  const sorted = Object.entries(byRootCause).sort((a, b) => b[1] - a[1]);
  return {
    total: failures.length,
    byRootCause,
    topCause: sorted.length > 0 ? sorted[0][0] : "none",
  };
}

/** Format failure stats as readable text. */
/** Format failure statistics as a human-readable report. */
/** @requires FAILURE_STATS @produces FORMATTED_REPORT */
/** @requires FAILURE_STATS @produces FORMATTED_REPORT */
/** @requires FAILURE_STATS @produces FORMATTED_REPORT */
/** @useWhen generating readable reports; CLI output; CI summary */
export function formatFailureStats(): string {
  const stats = failureStats();
  if (stats.total === 0) return "No failures recorded yet.";

  const lines = [
    `Failure Corpus: ${stats.total} failures`,
    `Top cause: ${stats.topCause}`,
    "",
  ];

  const sorted = Object.entries(stats.byRootCause).sort((a, b) => b[1] - a[1]);
  const max = sorted[0]?.[1] || 1;
  for (const [cause, count] of sorted) {
    const bar = "█".repeat(Math.round((count / max) * 20));
    const pct = ((count / stats.total) * 100).toFixed(0) + "%";
    lines.push(`  ${cause}: ${bar} ${count} (${pct})`);
  }

  return lines.join("\n");
}
