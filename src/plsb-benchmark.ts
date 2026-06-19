/**
 * PLSB-100: Protocol Lifecycle Security Benchmark v1.0
 *
 * The first benchmark specifically designed for protocol lifecycle
 * vulnerabilities — missing states, missing edges, and illegal
 * transitions that traditional SAST cannot see.
 *
 * Categories (Protocol Weakness Taxonomy v1):
 *   RESOURCE LIFECYCLE:
 *     PLS-001 Missing Release     — Acquire→Use...no Release
 *     PLS-002 Double Release       — Release→Release (illegal)
 *     PLS-003 Use After Release    — Release→Use (illegal)
 *   AUTH LIFECYCLE:
 *     PLS-004 Missing Auth         — Action without prior Verify
 *     PLS-005 Session Fixation     — Session not invalidated
 *     PLS-006 Privilege Escalation — Lower privilege→Higher action
 *   TRANSACTION LIFECYCLE:
 *     PLS-007 Missing Commit       — Begin→...no Commit|Rollback
 *     PLS-008 Double Commit        — Commit→Commit (illegal)
 *   MEMORY LIFECYCLE:
 *     PLS-009 Missing Free         — Alloc→...no Free
 *     PLS-010 Double Free          — Free→Free (illegal)
 *     PLS-011 Use After Free       — Free→Use (illegal)
 *   STATE CONSISTENCY:
 *     PLS-012 Race Condition       — Check→Modify without lock
 *     PLS-013 Workflow Bypass      — Skip required intermediate state
 *
 * This IS the defensible asset — a verified dataset that defines
 * a new security category.
 */

import { loadGoldDataset, runGoldBenchmark, GoldBenchmarkResult } from "./gold-cve";
import { buildTieredDataset } from "./gold-tiers";
import * as fs from "fs";
import * as path from "path";

// ═══════════════════════════════════════════════════════════════
// Protocol Weakness Taxonomy
// ═══════════════════════════════════════════════════════════════

export interface PLSWeakness {
  id: string;           // PLS-001
  name: string;         // "Missing Release"
  category: string;     // "resource_leak"
  description: string;
  example_broken: string[];
  example_expected: string[];
}

export const PROTOCOL_WEAKNESS_TAXONOMY: PLSWeakness[] = [
  {
    id: "PLS-001", name: "Missing Release", category: "resource_leak",
    description: "Resource acquired (Acquire) but never released. The lifecycle terminates without the required Release step.",
    example_broken: ["open", "read"],
    example_expected: ["open", "read", "close"],
  },
  {
    id: "PLS-002", name: "Double Release", category: "resource_leak",
    description: "Resource released twice. Second Release is an illegal transition — the resource is already freed.",
    example_broken: ["open", "close", "close"],
    example_expected: ["open", "close"],
  },
  {
    id: "PLS-003", name: "Use After Release", category: "use_after_free",
    description: "Resource accessed after release. The Use step occurs after the Release has already invalidated the resource state.",
    example_broken: ["open", "close", "read"],
    example_expected: ["open", "read", "close"],
  },
  {
    id: "PLS-004", name: "Missing Authorization", category: "auth_bypass",
    description: "Privileged action performed without prior authentication/authorization. The Verify step is absent from the lifecycle.",
    example_broken: ["generate_token", "access_resource"],
    example_expected: ["verify_password", "generate_token", "access_resource"],
  },
  {
    id: "PLS-005", name: "Session Fixation", category: "session_fixation",
    description: "Session not invalidated after logout. Old session tokens remain valid, enabling session hijacking.",
    example_broken: ["verify_password", "create_session", "logout"],
    example_expected: ["verify_password", "create_session", "invalidate_session", "logout"],
  },
  {
    id: "PLS-006", name: "Privilege Escalation", category: "privilege_escalation",
    description: "User with lower privilege performs higher-privilege action. A privilege boundary is crossed without validation.",
    example_broken: ["login_as_user", "delete_all_records"],
    example_expected: ["login_as_user", "verify_admin_role", "delete_all_records"],
  },
  {
    id: "PLS-007", name: "Missing Commit", category: "transaction_violation",
    description: "Transaction started (Begin) but never terminated with Commit or Rollback. Writes are lost or dangling.",
    example_broken: ["begin_tx", "insert_record"],
    example_expected: ["begin_tx", "insert_record", "commit_tx"],
  },
  {
    id: "PLS-008", name: "Double Commit", category: "transaction_violation",
    description: "Transaction committed twice. Second Commit is an illegal transition — the transaction is already closed.",
    example_broken: ["begin_tx", "commit_tx", "commit_tx"],
    example_expected: ["begin_tx", "commit_tx"],
  },
  {
    id: "PLS-009", name: "Missing Free", category: "resource_leak",
    description: "Memory allocated (Alloc) but never freed. The lifecycle terminates without the required Free step.",
    example_broken: ["malloc", "use_buffer"],
    example_expected: ["malloc", "use_buffer", "free"],
  },
  {
    id: "PLS-010", name: "Double Free", category: "double_free",
    description: "Memory freed twice. Second Free is an illegal transition — the allocation is already released.",
    example_broken: ["malloc", "free", "free"],
    example_expected: ["malloc", "free"],
  },
  {
    id: "PLS-011", name: "Use After Free", category: "use_after_free",
    description: "Memory accessed after free. The Use occurs after Free has already invalidated the allocation.",
    example_broken: ["malloc", "free", "use_buffer"],
    example_expected: ["malloc", "use_buffer", "free"],
  },
  {
    id: "PLS-012", name: "Race Condition", category: "race_condition",
    description: "Check-then-act without proper synchronization. State changes between Check and Act steps.",
    example_broken: ["check_file_exists", "open_file"],
    example_expected: ["check_file_exists", "acquire_lock", "open_file", "release_lock"],
  },
  {
    id: "PLS-013", name: "Workflow Bypass", category: "missing_validation",
    description: "Required intermediate validation step skipped. The workflow jumps directly from start to privileged action.",
    example_broken: ["receive_request", "execute_query"],
    example_expected: ["receive_request", "validate_input", "authorize_action", "execute_query"],
  },
];

// ═══════════════════════════════════════════════════════════════
// PLSB-100: Build and export the unified benchmark
// ═══════════════════════════════════════════════════════════════

export interface PLSBEntry {
  id: string;
  pls_id?: string;       // PLS-001, etc.
  category: string;
  severity: "critical" | "high" | "medium" | "low";
  broken: string[];
  expected: string[];
  verified: boolean;
  source: string;        // git_diff, curated, synthetic
  cve?: string;
  project?: string;
  notes?: string;
}

export interface PLSBenchmark {
  name: string;
  version: string;
  taxonomy: PLSWeakness[];
  entries: PLSBEntry[];
  metadata: {
    total: number;
    verified: number;
    byCategory: Record<string, number>;
    byPLS: Record<string, number>;
    coverage: { totalCategories: number; covered: number; uncovered: string[] };
  };
}

export function buildPLSB(): PLSBenchmark {
  const entries: PLSBEntry[] = [];

  // Source 1: Curated gold (20 cases)
  const curated = loadGoldDataset().cases;
  for (const c of curated) {
    entries.push({
      id: c.id,
      category: c.category,
      severity: c.severity,
      broken: c.broken,
      expected: c.expected,
      verified: true,
      source: "curated",
      notes: c.notes,
    });
  }

  // Source 2: Diff-based gold from gold-seed.json
  try {
    const seedPath = path.resolve(__dirname, "..", "benchmarks", "gold-seed.json");
    if (fs.existsSync(seedPath)) {
      const seed = JSON.parse(fs.readFileSync(seedPath, "utf-8"));
      for (const c of seed) {
        entries.push({
          id: `GOLD-${c.cve}`,
          category: c.category,
          severity: c.severity || "high",
          broken: c.before,
          expected: c.after,
          verified: true,
          source: "git_diff",
          cve: c.cve,
          project: c.project,
          notes: c.notes,
        });
      }
    }
  } catch {}

  // Map entries to PLS taxonomy IDs
  const catToPLS: Record<string, string> = {
    resource_leak: "PLS-001",
    auth_bypass: "PLS-004",
    use_after_free: "PLS-011",
    double_free: "PLS-010",
    race_condition: "PLS-012",
    data_corruption: "PLS-007",
    transaction_violation: "PLS-007",
    session_fixation: "PLS-005",
    privilege_escalation: "PLS-006",
    missing_validation: "PLS-013",
  };

  for (const e of entries) {
    e.pls_id = catToPLS[e.category] || undefined;
  }

  // Build metadata
  const byCategory: Record<string, number> = {};
  const byPLS: Record<string, number> = {};
  let verified = 0;

  for (const e of entries) {
    byCategory[e.category] = (byCategory[e.category] || 0) + 1;
    if (e.pls_id) byPLS[e.pls_id] = (byPLS[e.pls_id] || 0) + 1;
    if (e.verified) verified++;
  }

  const allPLS = PROTOCOL_WEAKNESS_TAXONOMY.map(t => t.id);
  const coveredPLS = [...new Set(entries.filter(e => e.pls_id).map(e => e.pls_id!))];
  const uncoveredPLS = allPLS.filter(id => !coveredPLS.includes(id));
  const coverage = {
    totalCategories: allPLS.length,
    covered: coveredPLS.length,
    uncovered: uncoveredPLS,
  };

  return {
    name: "Protocol Lifecycle Security Benchmark",
    version: "1.0.0",
    taxonomy: PROTOCOL_WEAKNESS_TAXONOMY,
    entries,
    metadata: {
      total: entries.length,
      verified,
      byCategory,
      byPLS,
      coverage,
    },
  };
}

export function exportPLSB(benchmark: PLSBenchmark, filepath: string): void {
  fs.writeFileSync(filepath, JSON.stringify(benchmark, null, 2));
  console.log(`\n  PLSB exported: ${benchmark.metadata.total} entries → ${filepath}`);
  console.log(`  Verified: ${benchmark.metadata.verified}/${benchmark.metadata.total}`);
  console.log(`  Coverage: ${benchmark.metadata.coverage.covered}/${benchmark.metadata.coverage.totalCategories} PLS categories`);
  if (benchmark.metadata.coverage.uncovered.length > 0) {
    console.log(`  Uncovered: ${benchmark.metadata.coverage.uncovered.join(", ")}`);
  }
}

export function printPLSBReport(benchmark: PLSBenchmark): void {
  console.log(`\n╔════════════════════════════════════════════════════╗`);
  console.log(`║   ${benchmark.name}`);
  console.log(`║   Version ${benchmark.version} — ${benchmark.metadata.total} entries`);
  console.log(`╚════════════════════════════════════════════════════╝\n`);

  console.log(`  Taxonomy: ${benchmark.taxonomy.length} weakness types`);
  console.log(`  Verified entries: ${benchmark.metadata.verified}/${benchmark.metadata.total}`);
  console.log(`  Coverage: ${benchmark.metadata.coverage.covered}/${benchmark.metadata.coverage.totalCategories}`);
  console.log();

  console.log(`  ── Per PLS Category ──`);
  console.log(`  ${'PLS'.padEnd(8)} ${'Name'.padEnd(28)} ${'Count'.padEnd(6)}`);
  console.log(`  ${'─'.repeat(44)}`);
  for (const t of benchmark.taxonomy) {
    const count = benchmark.metadata.byPLS[t.id] || 0;
    const icon = count > 0 ? "✅" : "🆕";
    console.log(`  ${icon} ${t.id.padEnd(6)} ${t.name.padEnd(28)} ${String(count).padEnd(6)}`);
  }
  console.log();

  // Run detector benchmark against this dataset
  console.log(`  ── Detector Performance ──`);
  const goldDataset: any = {
    cases: benchmark.entries.filter(e => e.verified).map(e => ({
      id: e.id, category: e.category, severity: e.severity,
      broken: e.broken, expected: e.expected,
      verifiedBy: e.source, notes: e.notes,
    })),
    metadata: { total: benchmark.metadata.verified, byCategory: {}, verifiedBy: {} },
  };

  if (goldDataset.cases.length > 0) {
    const result = runGoldBenchmark(goldDataset);
    console.log(`  Verified recall:    ${(result.recall * 100).toFixed(0)}%`);
    console.log(`  Verified precision: ${(result.precision * 100).toFixed(0)}%`);
  }

  console.log(`\n  Open: benchmarks/plsb.json\n`);
}
