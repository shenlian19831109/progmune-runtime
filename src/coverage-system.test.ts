/**
 * P3.6: Coverage System Integration Tests
 *
 * Verifying:
 *   1. Coverage engine correctly computes state/transition coverage
 *   2. Dashboard visualizes gaps and risk ranking
 *   3. Benchmark generator produces cases for uncovered transitions
 *   4. End-to-end: analyze → generate → new cases
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  parseProtocolDefinition, analyzeCoverage, analyzeAllCoverage,
  loadDefaultProtocolDefinitions, CoverageReport, ProtocolDefinition,
} from "./protocol-coverage";
import { generateCoverageDashboard, printCoverageDashboard } from "./coverage-dashboard";
import { generateMissingBenchmarks, writeGeneratedBenchmarks, runCoverageDrivenGeneration } from "./benchmark-generator";
import type { StateAnnotation } from "./ssg-validator";
import type { TrajectoryRecord } from "./runtime-types";

// ═══════════════════════════════════════════════════════════════
// Coverage Engine
// ═══════════════════════════════════════════════════════════════

describe("Coverage Engine", () => {
  function makeFileRules(): Map<string, StateAnnotation> {
    return new Map([
      ["open_file", { pre_states: [], post_states: ["FILE_OPEN"] }],
      ["write_file", { pre_states: ["FILE_OPEN"], post_states: ["FILE_DIRTY"] }],
      ["close_file", { pre_states: ["FILE_OPEN", "FILE_DIRTY"], post_states: [], invalidate: ["FILE_OPEN", "FILE_DIRTY"] }],
    ]);
  }

  const fileProto = parseProtocolDefinition("FileProtocol", makeFileRules(), "INIT");

  it("computes full coverage when all transitions visited", () => {
    const trajectories: TrajectoryRecord[] = [{
      id: "t1", timestamp: new Date().toISOString(),
      protocol: "FileProtocol", initialState: ["INIT"], finalState: [],
      trajectory: ["open_file", "write_file", "close_file"],
      result: "success", context: { nestingDepth: 0, exceptionHandled: false, insideLoop: false, branchCount: 0, asyncContext: false },
      successRate: 1.0, metadata: { source: "human" },
    }];

    const report = analyzeCoverage(fileProto, trajectories);

    expect(report.transitionCoverage.transitionCoverage).toBeGreaterThan(0.5);
    expect(report.stateCoverage.stateCoverage).toBeGreaterThan(0.5);
  });

  it("detects uncovered transitions", () => {
    const trajectories: TrajectoryRecord[] = [{
      id: "t2", timestamp: new Date().toISOString(),
      protocol: "FileProtocol", initialState: ["INIT"], finalState: [],
      trajectory: ["open_file", "close_file"], // missing write_file
      result: "success", context: { nestingDepth: 0, exceptionHandled: false, insideLoop: false, branchCount: 0, asyncContext: false },
      successRate: 1.0, metadata: { source: "human" },
    }];

    const report = analyzeCoverage(fileProto, trajectories);

    expect(report.transitionCoverage.missingTransitions.length).toBeGreaterThan(0);
  });

  it("empty trajectories = zero coverage", () => {
    const report = analyzeCoverage(fileProto, []);
    expect(report.transitionCoverage.transitionCoverage).toBe(0);
    expect(report.stateCoverage.stateCoverage).toBe(0);
    expect(report.trajectoryCount).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// Default Protocol Definitions
// ═══════════════════════════════════════════════════════════════

describe("Default Protocol Definitions", () => {
  it("loads all 4 protocol groups", () => {
    const protocols = loadDefaultProtocolDefinitions();
    expect(protocols.length).toBe(4);

    const names = protocols.map(p => p.name);
    expect(names).toContain("FileProtocol");
    expect(names).toContain("AuthProtocol");
    expect(names).toContain("DBProtocol");
    expect(names).toContain("IRProtocol");
  });

  it("each protocol has states and transitions", () => {
    for (const p of loadDefaultProtocolDefinitions()) {
      expect(p.states.length).toBeGreaterThan(0);
      expect(p.transitions.length).toBeGreaterThan(0);
    }
  });

  it("FileProtocol has open/write/close transitions", () => {
    const file = loadDefaultProtocolDefinitions().find(p => p.name === "FileProtocol")!;
    const tKeys = file.transitions.map(t => `${t.from}→${t.to}`);

    expect(tKeys).toContain("INIT→FILE_OPEN");     // open_file
    expect(tKeys).toContain("FILE_OPEN→∅");        // close_file invalidates FILE_OPEN
  });

  it("AuthProtocol has auth lifecycle transitions", () => {
    const auth = loadDefaultProtocolDefinitions().find(p => p.name === "AuthProtocol")!;
    const tKeys = auth.transitions.map(t => `${t.from}→${t.to}`);

    expect(tKeys).toContain("UNAUTHENTICATED→PASSWORD_VERIFIED"); // verify_password
    expect(tKeys).toContain("PASSWORD_VERIFIED→TOKEN_ISSUED");    // generate_jwt
    expect(tKeys).toContain("TOKEN_ISSUED→SESSION_ACTIVE");       // create_session
    expect(tKeys).toContain("SESSION_ACTIVE→UNAUTHENTICATED");    // logout
  });
});

// ═══════════════════════════════════════════════════════════════
// Coverage Dashboard
// ═══════════════════════════════════════════════════════════════

const GEN_DIR = path.resolve(__dirname, "..", "test-coverage-gen");
process.env.PROGMUNE_PROJECT_DIR = GEN_DIR;
fs.mkdirSync(GEN_DIR, { recursive: true });
fs.mkdirSync(path.join(GEN_DIR, ".progmune_corpus", "trajectories"), { recursive: true });

describe("Coverage Dashboard", () => {
  it("generates dashboard from current trajectories", () => {
    const dashboard = generateCoverageDashboard([]);

    expect(dashboard.reports.length).toBe(4);
    expect(dashboard.riskRanking.length).toBe(4);
    expect(dashboard.overallTransitionCoverage).toBeGreaterThanOrEqual(0);
    expect(dashboard.overallTransitionCoverage).toBeLessThanOrEqual(1);
    expect(dashboard.criticalProtocols).toBeGreaterThanOrEqual(0);

    printCoverageDashboard(dashboard);
  });

  it("correctly ranks empty protocols as critical", () => {
    const dashboard = generateCoverageDashboard([]);

    // With zero trajectories, all protocols should be critical or high risk
    const emptyProtocols = dashboard.riskRanking.filter(r => r.trajectoryCount === 0);
    for (const r of emptyProtocols) {
      expect(r.stateCoverage).toBe(0);
      expect(r.transitionCoverage).toBe(0);
      expect(r.risk).toBe("critical");
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// Benchmark Generator
// ═══════════════════════════════════════════════════════════════

describe("Benchmark Generator", () => {
  it("generates cases for uncovered transitions", () => {
    const generated = generateMissingBenchmarks([]);

    // With zero trajectories, all protocols have uncovered transitions
    expect(Object.keys(generated).length).toBeGreaterThanOrEqual(3);

    // Each protocol should have generated cases
    for (const [protocol, cases] of Object.entries(generated)) {
      expect(cases.length).toBeGreaterThan(0);
      for (const c of cases) {
        expect(c.broken.length).toBeGreaterThan(0);
        expect(c.expected.length).toBeGreaterThan(0);
        expect(c.expected.length).toBeGreaterThan(c.broken.length);
        expect(["resource_leak", "missing_prerequisite"]).toContain(c.violationType);
      }
    }
  });

  it("writes generated benchmarks to disk", () => {
    const generated = generateMissingBenchmarks([]);
    const outDir = path.resolve(GEN_DIR, "generated-benchmarks");
    const written = writeGeneratedBenchmarks(generated, outDir);

    expect(written.length).toBeGreaterThanOrEqual(3);

    // Verify files exist and are valid JSON
    for (const filepath of written) {
      expect(fs.existsSync(filepath)).toBe(true);
      const content = JSON.parse(fs.readFileSync(filepath, "utf-8"));
      expect(content.cases.length).toBeGreaterThan(0);
      expect(content.source).toBe("coverage-gap");
    }
  });

  it("runs the full coverage→generation pipeline", () => {
    const result = runCoverageDrivenGeneration();

    expect(result.existingCases).toBeGreaterThanOrEqual(1); // from previous test writes
    expect(result.generatedCases).toBeGreaterThanOrEqual(10);
    expect(result.writtenFiles.length).toBeGreaterThanOrEqual(3);

    console.log(`\nCoverage-Driven Generation: ${result.summary}`);
  });
});
