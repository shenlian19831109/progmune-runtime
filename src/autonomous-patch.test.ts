/**
 * P5.3: Autonomous Patch Generation Tests
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { SkillLibrary, printSkillLibrary } from "./skill-library";
import { generatePatchesFromSkills, generateTemplatesFromSkills, runAutonomousPipeline, printAutonomousReport } from "./autonomous-patch";
import { KnowledgePatchStore } from "./knowledge-governance";
import { PlannerTelemetry, candidateFingerprint } from "./planner-telemetry";
import type { StateAnnotation } from "./ssg-validator";

const AUTO_DIR = path.resolve(__dirname, "..", "test-autonomous-patch");
process.env.PROGMUNE_PROJECT_DIR = AUTO_DIR;
fs.mkdirSync(AUTO_DIR, { recursive: true });
fs.mkdirSync(path.join(AUTO_DIR, ".progmune_corpus", "telemetry"), { recursive: true });
fs.mkdirSync(path.join(AUTO_DIR, ".progmune_corpus", "knowledge"), { recursive: true });

function seedLibrary(telemetry: PlannerTelemetry, rules: Map<string, StateAnnotation>): SkillLibrary {
  // File skill: 90% acceptance
  for (let i = 0; i < 30; i++) {
    const a = ["open_file", "write_file", "close_file"];
    const fp = candidateFingerprint("FileProtocol", a, "resource_leak");
    const id = telemetry.recordDecision({
      goal: "safely write config file", protocol: "FileProtocol", violationType: "resource_leak",
      candidates: [{ candidateId: fp, source: "protocol", evidenceSources: ["protocol"], actions: a, explanation: "full" }],
      selectedCandidateId: fp, cost: { latencyMs: 5 },
    });
    telemetry.recordFeedback(id, { decision: Math.random() < 0.92 ? "accepted" : "rejected", executionResult: { success: true, violations: [] }, timestamp: Date.now() });
  }

  // Auth skill: 88% acceptance
  for (let i = 0; i < 30; i++) {
    const a = ["verify_password", "generate_jwt", "create_session"];
    const fp = candidateFingerprint("AuthProtocol", a, "missing_prerequisite");
    const id = telemetry.recordDecision({
      goal: "authenticate user", protocol: "AuthProtocol", violationType: "missing_prerequisite",
      candidates: [{ candidateId: fp, source: "protocol", evidenceSources: ["protocol"], actions: a, explanation: "auth" }],
      selectedCandidateId: fp,
    });
    telemetry.recordFeedback(id, { decision: Math.random() < 0.88 ? "accepted" : "rejected", executionResult: { success: true, violations: [] }, timestamp: Date.now() });
  }

  const r = rules;
  const lib = new SkillLibrary();
  lib.learn(telemetry, r);
  return lib;
}

describe("Autonomous Patch Generation", () => {
  it("generates patches from high-confidence skills", () => {
    const rules = new Map<string, StateAnnotation>();
    rules.set("open_file", { pre_states: [], post_states: ["FILE_OPEN"] });
    rules.set("write_file", { pre_states: ["FILE_OPEN"], post_states: [] });
    rules.set("close_file", { pre_states: ["FILE_OPEN"], post_states: [], invalidate: ["FILE_OPEN"] });
    rules.set("verify_password", { pre_states: ["UNAUTHENTICATED"], post_states: ["PASSWORD_VERIFIED"] });
    rules.set("generate_jwt", { pre_states: ["PASSWORD_VERIFIED"], post_states: ["TOKEN_ISSUED"], invalidate: ["PASSWORD_VERIFIED"] });
    rules.set("create_session", { pre_states: ["TOKEN_ISSUED"], post_states: ["SESSION_ACTIVE"], invalidate: ["TOKEN_ISSUED"] });

    const telemetry = new PlannerTelemetry(
      path.join(AUTO_DIR, ".progmune_corpus", "telemetry", `auto-${Date.now()}.jsonl`)
    );
    const lib = seedLibrary(telemetry, rules);
    expect(lib.size).toBeGreaterThanOrEqual(2);

    const store = new KnowledgePatchStore(
      path.join(AUTO_DIR, ".progmune_corpus", "knowledge", `auto-patches-${Date.now()}.json`)
    );

    const results = generatePatchesFromSkills(lib, telemetry, store, 0.85);

    expect(results.length).toBeGreaterThanOrEqual(1);
    // File skill (92%) should be approved; Auth skill (88%) also above threshold
    const approved = results.filter(r => r.status === "approved");
    expect(approved.length).toBeGreaterThanOrEqual(1);

    printAutonomousReport({ skills: lib.size, patchesGenerated: results.length, patchesApproved: approved.length, patchesRejected: results.filter(r => r.status === "rejected").length, templatesGenerated: 0, summary: "" }, results);
  });

  it("generates templates from skills", () => {
    const rules = new Map<string, StateAnnotation>();
    rules.set("open_file", { pre_states: [], post_states: ["FILE_OPEN"] });
    rules.set("write_file", { pre_states: ["FILE_OPEN"], post_states: [] });
    rules.set("close_file", { pre_states: ["FILE_OPEN"], post_states: [], invalidate: ["FILE_OPEN"] });

    const telemetry = new PlannerTelemetry(
      path.join(AUTO_DIR, ".progmune_corpus", "telemetry", `tmpl-${Date.now()}.jsonl`)
    );
    const lib = seedLibrary(telemetry, rules);
    const templates = generateTemplatesFromSkills(lib);

    expect(templates.length).toBeGreaterThanOrEqual(1);
    // Template pattern should contain file operation keywords
    expect(templates.some(t => t.pattern.includes("open") && t.pattern.includes("write"))).toBe(true);
  });

  it("runs full autonomous pipeline", () => {
    const rules = new Map<string, StateAnnotation>();
    rules.set("open_file", { pre_states: [], post_states: ["FILE_OPEN"] });
    rules.set("write_file", { pre_states: ["FILE_OPEN"], post_states: [] });
    rules.set("close_file", { pre_states: ["FILE_OPEN"], post_states: [], invalidate: ["FILE_OPEN"] });
    rules.set("verify_password", { pre_states: ["UNAUTHENTICATED"], post_states: ["PASSWORD_VERIFIED"] });
    rules.set("generate_jwt", { pre_states: ["PASSWORD_VERIFIED"], post_states: ["TOKEN_ISSUED"], invalidate: ["PASSWORD_VERIFIED"] });
    rules.set("create_session", { pre_states: ["TOKEN_ISSUED"], post_states: ["SESSION_ACTIVE"], invalidate: ["TOKEN_ISSUED"] });

    const telemetry = new PlannerTelemetry(
      path.join(AUTO_DIR, ".progmune_corpus", "telemetry", `full-${Date.now()}.jsonl`)
    );
    const lib = seedLibrary(telemetry, rules);
    const store = new KnowledgePatchStore(
      path.join(AUTO_DIR, ".progmune_corpus", "knowledge", `full-patches-${Date.now()}.json`)
    );

    const report = runAutonomousPipeline(lib, telemetry, store);

    expect(report.skills).toBeGreaterThanOrEqual(2);
    expect(report.patchesApproved).toBeGreaterThanOrEqual(1);
    expect(report.templatesGenerated).toBeGreaterThanOrEqual(2);

    printAutonomousReport(report);
  });
});
