/**
 * P3.16-17: Protocol Gap Mining Tests
 */

import { describe, it, expect } from "vitest";
import {
  analyzeProtocolGaps, computeKnowledgeScores,
  printGapReport, printKnowledgeScores,
} from "./protocol-gap-analyzer";
import type { AttributedCase } from "./evaluation-campaign";

function makeAttributedCases(): AttributedCase[] {
  return [
    { caseId: "c1", goal: "authenticate user", protocol: "AuthProtocol", violationType: "missing_prerequisite", expectedRepair: ["verify_password", "generate_jwt", "create_session"], plannerTop1: ["logout"], candidatesReturned: 1, rank: null, failureReason: "missing_candidate" },
    { caseId: "c2", goal: "authenticate user", protocol: "AuthProtocol", violationType: "missing_prerequisite", expectedRepair: ["verify_password", "generate_jwt", "create_session"], plannerTop1: ["logout"], candidatesReturned: 1, rank: null, failureReason: "missing_candidate" },
    { caseId: "c3", goal: "full auth lifecycle", protocol: "AuthProtocol", violationType: "missing_prerequisite", expectedRepair: ["verify_password", "generate_jwt", "create_session", "logout"], plannerTop1: ["logout"], candidatesReturned: 1, rank: null, failureReason: "missing_candidate" },
    { caseId: "c4", goal: "safely write file", protocol: "FileProtocol", violationType: "resource_leak", expectedRepair: ["open_file", "write_file", "flush_file", "close_file"], plannerTop1: ["close_file"], candidatesReturned: 1, rank: null, failureReason: "missing_candidate" },
    { caseId: "c5", goal: "safely write file", protocol: "FileProtocol", violationType: "resource_leak", expectedRepair: ["open_file", "write_file", "flush_file", "close_file"], plannerTop1: ["close_file"], candidatesReturned: 1, rank: null, failureReason: "missing_candidate" },
    { caseId: "c6", goal: "query db safely", protocol: "DBProtocol", violationType: "missing_prerequisite", expectedRepair: ["connect_db", "query_db", "disconnect_db"], plannerTop1: ["disconnect_db"], candidatesReturned: 1, rank: null, failureReason: "missing_candidate" },
    { caseId: "c7", goal: "auth then file then db", protocol: "FileProtocol", violationType: "resource_leak", expectedRepair: ["verify_password", "open_file", "write_file", "close_file", "connect_db", "query_db", "disconnect_db"], plannerTop1: ["close_file"], candidatesReturned: 1, rank: null, failureReason: "missing_candidate" },
    { caseId: "c8", goal: "success case", protocol: "FileProtocol", violationType: "resource_leak", expectedRepair: ["open_file", "write_file", "close_file"], plannerTop1: ["open_file", "write_file", "close_file"], candidatesReturned: 3, rank: 1, failureReason: "success" },
  ];
}

describe("Protocol Gap Analyzer", () => {
  it("identifies missing actions from failures", () => {
    const cases = makeAttributedCases();

    // Build rules map: only existing protocol functions
    const rules = new Map<string, Set<string>>();
    rules.set("AuthProtocol", new Set(["verify_password", "generate_jwt", "create_session", "logout", "revoke_token"]));
    rules.set("FileProtocol", new Set(["open_file", "read_file", "write_file", "close_file"]));
    rules.set("DBProtocol", new Set(["connect_db", "query_db", "disconnect_db"]));
    rules.set("IRProtocol", new Set(["extractIR", "validateAction", "validateActionSequence", "emitCode", "recordSession"]));

    const report = analyzeProtocolGaps(cases, rules);

    expect(report.failuresAnalyzed).toBe(7); // 8 total, 1 success
    expect(report.gaps.length).toBeGreaterThan(0);

    // flush_file should appear as a missing action
    const missingActions = report.gaps.filter(g => g.kind === "missing_action");
    expect(missingActions.some(g => g.item === "flush_file")).toBe(true);

    // flush_file appears in 2 cases (c4, c5)
    const flushGap = missingActions.find(g => g.item === "flush_file");
    expect(flushGap?.frequency).toBe(2);

    printGapReport(report);
  });

  it("computes knowledge scores per protocol", () => {
    const cases = makeAttributedCases();
    const scores = computeKnowledgeScores(cases);

    expect(scores.length).toBe(4);

    // FileProtocol has success case → higher score
    const file = scores.find(s => s.protocol === "FileProtocol")!;
    expect(file.successRate).toBeGreaterThan(0);

    printKnowledgeScores(scores);
  });
});
