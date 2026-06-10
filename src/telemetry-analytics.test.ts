/**
 * P2.5 Telemetry + Analytics + Benchmark Integration Tests
 *
 * Verifies:
 *   1. PlannerTelemetry records decisions and feedback
 *   2. Acceptance dashboard produces correct aggregates
 *   3. Benchmark harness runs against known fixtures
 *   4. 1000 simulated decisions produce a coherent dashboard
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { PlannerTelemetry, candidateFingerprint } from "./planner-telemetry";
import { getStrategyStats, getProtocolStats, getGoalStats, getTopAcceptedRepairs, getTopRejectedRepairs, generateDashboard, printDashboard } from "./analytics";
import { runBenchmark, printBenchmarkReport } from "./benchmark-harness";

// ═══════════════════════════════════════════════════════════════
// Candidate ID
// ═══════════════════════════════════════════════════════════════

describe("Candidate Fingerprint v2", () => {
  it("produces stable hash for same action sequence", () => {
    expect(candidateFingerprint("FileProtocol", ["open_file", "close_file"]))
      .toBe(candidateFingerprint("FileProtocol", ["open_file", "close_file"]));
  });

  it("different protocol = different hash (no collision)", () => {
    const a = candidateFingerprint("FileProtocol", ["close_file"]);
    const b = candidateFingerprint("AuthProtocol", ["close_file"]);
    expect(a).not.toBe(b);
  });

  it("different violationType = different hash", () => {
    const a = candidateFingerprint("FileProtocol", ["close_file"], "resource_leak");
    const b = candidateFingerprint("FileProtocol", ["close_file"], "missing_prerequisite");
    expect(a).not.toBe(b);
  });

  it("different functions = different hash", () => {
    expect(candidateFingerprint("FileProtocol", ["close_file"]))
      .not.toBe(candidateFingerprint("FileProtocol", ["flush"]));
  });
});

// ═══════════════════════════════════════════════════════════════
// Telemetry: record → query roundtrip
// ═══════════════════════════════════════════════════════════════

const TELEMETRY_DIR = path.resolve(__dirname, "..", "test-telemetry");
process.env.PROGMUNE_PROJECT_DIR = TELEMETRY_DIR;
fs.mkdirSync(TELEMETRY_DIR, { recursive: true });
fs.mkdirSync(path.join(TELEMETRY_DIR, ".progmune_corpus", "telemetry"), { recursive: true });

function createTelemetry(): PlannerTelemetry {
  return new PlannerTelemetry(
    path.join(TELEMETRY_DIR, ".progmune_corpus", "telemetry", `test-${Date.now()}.jsonl`)
  );
}

describe("PlannerTelemetry", () => {
  it("records a decision and returns an ID", () => {
    const t = createTelemetry();
    const id = t.recordDecision({
      goal: "safely write config file",
      protocol: "FileProtocol",
      candidates: [{
        candidateId: candidateFingerprint("FileProtocol", ["close_file"]),
        source: "protocol",
        evidenceSources: ["protocol"],
        actions: ["close_file"],
        explanation: "Close the file",
      }],
      selectedCandidateId: candidateFingerprint("FileProtocol", ["close_file"]),
    });
    expect(id).toMatch(/^PD-/);
    expect(t.size).toBe(1);
    expect(t.withFeedback).toBe(0);
  });

  it("records accepted feedback and updates acceptance rate", () => {
    const t = createTelemetry();
    const id = t.recordDecision({
      goal: "authenticate user",
      protocol: "AuthProtocol",
      candidates: [{
        candidateId: candidateFingerprint("FileProtocol", ["verify_password"]),
        source: "protocol",
        evidenceSources: ["protocol"],
        actions: ["verify_password", "generate_jwt"],
        explanation: "Full auth flow",
      }],
      selectedCandidateId: candidateFingerprint("FileProtocol", ["verify_password"]),
    });

    t.recordFeedback(id, { decision: "accepted", executionResult: { success: true, violations: [] }, userReason: "safer", timestamp: Date.now() });
    expect(t.withFeedback).toBe(1);
    expect(t.getAcceptanceRate()).toBe(1.0);
  });

  it("records rejected feedback", () => {
    const t = createTelemetry();
    const id = t.recordDecision({
      goal: "write file unsafely",
      protocol: "FileProtocol",
      candidates: [{
        candidateId: candidateFingerprint("FileProtocol", ["write_file"]),
        source: "antibody",
        evidenceSources: ["antibody"],
        actions: ["write_file"],
        explanation: "Just write",
      }],
      selectedCandidateId: candidateFingerprint("FileProtocol", ["write_file"]),
    });

    t.recordFeedback(id, { decision: "rejected", userReason: "irrelevant", timestamp: Date.now() });
    expect(t.withFeedback).toBe(1);
    expect(t.getAcceptanceRate()).toBe(0.0);
  });

  it("records execution result with latency", () => {
    const t = createTelemetry();
    const id = t.recordDecision({
      goal: "quick operation",
      protocol: "FileProtocol",
      candidates: [{
        candidateId: "q",
        source: "corpus",
        evidenceSources: ["corpus"],
        actions: ["flush"],
        explanation: "Quick flush",
      }],
    });

    t.recordExecutionResult(id, true, [], 42);
    const events = t.all();
    const ev = events.find(e => e.id === id);
    expect(ev?.feedback?.executionResult?.success).toBe(true);
    expect(ev?.cost?.latencyMs).toBe(42);
  });
});

// ═══════════════════════════════════════════════════════════════
// Telemetry: aggregation queries
// ═══════════════════════════════════════════════════════════════

describe("Telemetry aggregation", () => {
  it("getAcceptanceBySource breaks down by strategy", () => {
    const t = createTelemetry();

    // Corpus: 2 accepted out of 2
    for (let i = 0; i < 2; i++) {
      const id = t.recordDecision({
        goal: "test",
        protocol: "FileProtocol",
        candidates: [{
          candidateId: candidateFingerprint("FileProtocol", ["close_file"]),
          source: "corpus",
          evidenceSources: ["corpus"],
          actions: ["close_file"],
          explanation: "close",
        }],
        selectedCandidateId: candidateFingerprint("FileProtocol", ["close_file"]),
      });
      t.recordFeedback(id, { decision: "accepted", userReason: "safer", timestamp: Date.now() });
    }

    // Protocol: 1 accepted out of 1
    const pid = t.recordDecision({
      goal: "test",
      protocol: "FileProtocol",
      candidates: [{
        candidateId: candidateFingerprint("FileProtocol", ["close_file"]),
        source: "protocol",
        evidenceSources: ["protocol"],
        actions: ["close_file"],
        explanation: "close",
      }],
      selectedCandidateId: candidateFingerprint("FileProtocol", ["close_file"]),
    });
    t.recordFeedback(pid, { decision: "accepted", userReason: "faster", timestamp: Date.now() });

    // Antibody: 0 accepted out of 1
    const aid = t.recordDecision({
      goal: "test",
      protocol: "FileProtocol",
      candidates: [{
        candidateId: candidateFingerprint("FileProtocol", ["flush"]),
        source: "antibody",
        evidenceSources: ["antibody"],
        actions: ["flush"],
        explanation: "flush instead",
      }],
      selectedCandidateId: candidateFingerprint("FileProtocol", ["flush"]),
    });
    t.recordFeedback(aid, { decision: "rejected", userReason: "incorrect", timestamp: Date.now() });

    const stats = getStrategyStats(t);
    expect(stats.length).toBe(3);

    const corpus = stats.find(s => s.strategy === "corpus")!;
    expect(corpus.rate).toBe(1.0); // 100%
    expect(corpus.accepted).toBe(2);

    const protocol = stats.find(s => s.strategy === "protocol")!;
    expect(protocol.rate).toBe(1.0);

    const antibody = stats.find(s => s.strategy === "antibody")!;
    expect(antibody.rate).toBe(0.0);
  });

  it("getTopAcceptedRepairs returns ranked list", () => {
    const t = createTelemetry();
    const fp = candidateFingerprint("FileProtocol", ["close_file"]);

    for (let i = 0; i < 3; i++) {
      const id = t.recordDecision({
        goal: "safely write config file",
        protocol: "FileProtocol",
        candidates: [{
          candidateId: fp,
          source: "corpus",
          evidenceSources: ["corpus", "protocol"],
          actions: ["close_file"],
          explanation: "close",
        }],
        selectedCandidateId: fp,
      });
      t.recordFeedback(id, { decision: "accepted", userReason: "safer", timestamp: Date.now() });
    }

    const tops = getTopAcceptedRepairs(t);
    expect(tops.length).toBeGreaterThanOrEqual(1);
    expect(tops[0].actions).toBe("close_file");
    expect(tops[0].count).toBe(3);
    expect(tops[0].goal).toBe("safely write config file");
  });
});

// ═══════════════════════════════════════════════════════════════
// Dashboard
// ═══════════════════════════════════════════════════════════════

describe("Acceptance Dashboard", () => {
  it("generates a complete dashboard report", () => {
    const t = createTelemetry();

    // Seed with FileProtocol decisions
    const fp = candidateFingerprint("FileProtocol", ["close_file"]);
    for (let i = 0; i < 5; i++) {
      const id = t.recordDecision({
        goal: "safely write config file",
        protocol: "FileProtocol",
        candidates: [{
          candidateId: fp,
          source: i < 4 ? "corpus" : "protocol",
          evidenceSources: i < 4 ? ["corpus"] : ["protocol"],
          actions: ["close_file"],
          explanation: "close",
        }],
        selectedCandidateId: fp,
      });
      if (i < 4) t.recordFeedback(id, { decision: "accepted", userReason: "safer", timestamp: Date.now() });
      else t.recordFeedback(id, { decision: "rejected", userReason: "incorrect", timestamp: Date.now() });
    }

    // Seed with AuthProtocol
    const ap = candidateFingerprint("FileProtocol", ["verify_password"]);
    for (let i = 0; i < 3; i++) {
      const id = t.recordDecision({
        goal: "authenticate user",
        protocol: "AuthProtocol",
        candidates: [{
          candidateId: ap,
          source: "corpus",
          evidenceSources: ["corpus", "protocol"],
          actions: ["verify_password", "generate_jwt"],
          explanation: "auth flow",
        }],
        selectedCandidateId: ap,
      });
      t.recordFeedback(id, { decision: "accepted", userReason: "safer", timestamp: Date.now() });
    }

    const report = generateDashboard(t);

    expect(report.summary.totalDecisions).toBe(8);
    expect(report.summary.withFeedback).toBe(8);
    // 7 accepted out of 8 = 87.5%
    expect(report.summary.overallAcceptanceRate).toBe(7 / 8);

    expect(report.byProtocol.length).toBe(2);
    const fileProto = report.byProtocol.find(p => p.protocol === "FileProtocol")!;
    expect(fileProto.rate).toBe(4 / 5);

    const authProto = report.byProtocol.find(p => p.protocol === "AuthProtocol")!;
    expect(authProto.rate).toBe(1.0);

    expect(report.topAccepted.length).toBeGreaterThan(0);
    expect(report.topRejected.length).toBeGreaterThan(0);

    // Dashboard prints without crashing
    printDashboard(t);
  });
});

// ═══════════════════════════════════════════════════════════════
// Benchmark harness
// ═══════════════════════════════════════════════════════════════

describe("Benchmark harness", () => {
  it("runs against benchmark fixtures and produces report", async () => {
    const report = await runBenchmark();

    expect(report.cases).toBeGreaterThanOrEqual(5);
    expect(report.top1Rate).toBeGreaterThanOrEqual(0);
    expect(report.top1Rate).toBeLessThanOrEqual(1);
    expect(report.top3Rate).toBeGreaterThanOrEqual(0);
    expect(report.top3Rate).toBeLessThanOrEqual(1);
    expect(report.avgLatencyMs).toBeGreaterThan(0);
    expect(report.avgCandidates).toBeGreaterThan(0);

    // Print for visual inspection
    printBenchmarkReport(report);
  }, 30_000);
});

// ═══════════════════════════════════════════════════════════════
// 1000 simulated decisions → coherent dashboard
// ═══════════════════════════════════════════════════════════════

describe("1000-simulated-decisions smoke test", () => {
  it("produces coherent dashboard after 1000 simulated decisions", () => {
    const t = createTelemetry();

    const strategies = ["corpus", "protocol", "antibody"];
    const protocols = ["FileProtocol", "AuthProtocol", "DBProtocol", "IRProtocol"];
    const goals: Record<string, string[]> = {
      FileProtocol: ["safely write config file", "read file and close it", "append and close file"],
      AuthProtocol: ["authenticate user", "create user session", "verify and logout"],
      DBProtocol: ["connect and query", "insert record safely", "migrate and clean up"],
      IRProtocol: ["extract and validate", "emit validated code", "record session"],
    };

    const repairs: Record<string, string[]> = {
      FileProtocol: ["open_file→write_file→close_file", "open_file→read_file→close_file", "open_file→append→close_file"],
      AuthProtocol: ["verify_password→generate_jwt→create_session", "verify_password→generate_jwt→logout", "verify_password→create_session→logout"],
      DBProtocol: ["connect_db→query_db→disconnect_db", "connect_db→insert→disconnect_db", "connect_db→migrate→disconnect_db"],
      IRProtocol: ["extractIR→validateAction", "validateActionSequence→emitCode", "extractIR→emitCode→recordSession"],
    };

    // Acceptance probabilities per strategy (matching expected hierarchy)
    const acceptProb: Record<string, number> = { corpus: 0.90, protocol: 0.84, antibody: 0.72 };

    for (let i = 0; i < 1000; i++) {
      const protocol = protocols[i % protocols.length];
      const goalList = goals[protocol];
      const repairList = repairs[protocol];
      const goal = goalList[i % goalList.length];
      const repair = repairList[i % repairList.length];
      const source = strategies[i % strategies.length];

      const cid = candidateFingerprint(protocol, repair.split("→"));

      const id = t.recordDecision({
        goal,
        protocol,
        candidates: [{
          candidateId: cid,
          source,
          evidenceSources: [source],
          actions: repair.split("→"),
          explanation: `Repair: ${repair}`,
        }],
        selectedCandidateId: cid,
        cost: { latencyMs: 2 + Math.random() * 10, actionCount: repair.split("→").length },
      });

      // Accept with strategy-specific probability
      if (Math.random() < acceptProb[source]) {
        const reasons: Array<"safer" | "faster" | "clearer" | "more_auditable"> = ["safer", "faster", "clearer", "more_auditable"];
        const reason = reasons[Math.floor(Math.random() * reasons.length)];
        const rating = (reason === "safer" || reason === "faster") ? (4 + Math.floor(Math.random() * 2)) as 4 | 5 : (3 + Math.floor(Math.random() * 2)) as 3 | 4;
        t.recordFeedback(id, { decision: "accepted", userReason: reason, timestamp: Date.now() });
      } else {
        t.recordFeedback(id, { decision: "rejected", userReason: Math.random() < 0.5 ? "incorrect" : "irrelevant", timestamp: Date.now() });
      }
    }

    // Verify coherence
    const report = generateDashboard(t);

    expect(report.summary.totalDecisions).toBe(1000);
    expect(report.summary.withFeedback).toBe(1000);

    // Overall acceptance should be between 72% and 90%
    expect(report.summary.overallAcceptanceRate).toBeGreaterThan(0.70);
    expect(report.summary.overallAcceptanceRate).toBeLessThan(0.92);

    // Strategy hierarchy: corpus > protocol > antibody
    const stratStats = getStrategyStats(t);
    const corpus = stratStats.find(s => s.strategy === "corpus")!;
    const protocol = stratStats.find(s => s.strategy === "protocol")!;
    const antibody = stratStats.find(s => s.strategy === "antibody")!;

    expect(corpus.rate).toBeGreaterThan(protocol.rate);
    expect(protocol.rate).toBeGreaterThan(antibody.rate);

    // Top accepted repair should be present
    const topAccepted = getTopAcceptedRepairs(t, 3);
    expect(topAccepted.length).toBeGreaterThanOrEqual(3);

    // Top rejected repair should be present
    const topRejected = getTopRejectedRepairs(t, 3);
    expect(topRejected.length).toBeGreaterThanOrEqual(3);

    // Print dashboard for visual confirmation
    printDashboard(t);

    // Also print strategy stats as table
    console.log("\nStrategy Acceptance (1000 decisions):");
    for (const s of stratStats) {
      console.log(`  ${s.strategy.padEnd(16)} ${(s.rate * 100).toFixed(0)}%  (${s.accepted}/${s.total})`);
    }
  });
});
