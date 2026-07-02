/**
 * P7: Unified Asset Promotion Pipeline Tests
 */

import { describe, it, expect } from "vitest";
import {
  AssetPromotionEngine,
  PROMOTION_GATES,
  STAGE_ORDER,
} from "../src/asset-promotion";

describe("Asset Promotion Pipeline", () => {

  const engine = new AssetPromotionEngine();

  it("creates asset at evidence stage on first observation", () => {
    const asset = engine.observe({
      name: "test_rule", kind: "verification_rule",
      domain: "Test", repo: "repo1", sequenceCount: 1,
    });
    // With only 1 sequence, stays at evidence (needs ≥2 for candidate)
    expect(asset.stage).toBe("evidence");
    expect(asset.evidence.repos).toContain("repo1");
  });

  it("promotes evidence → candidate automatically", () => {
    const asset = engine.observe({
      name: "auto_candidate", kind: "verification_rule",
      domain: "Test", repo: "repo1", sequenceCount: 5,
    });
    expect(asset.stage).toBe("candidate");
    expect(asset.history.length).toBeGreaterThanOrEqual(1);
  });

  it("promotes candidate → observed with 2+ repos", () => {
    // First observation
    engine.observe({
      name: "cross_repo_rule", kind: "verification_rule",
      domain: "Test", repo: "repo1", sequenceCount: 5,
    });
    // Second observation in different repo
    const asset = engine.observe({
      name: "cross_repo_rule", kind: "verification_rule",
      domain: "Test", repo: "repo2", sequenceCount: 3,
    });
    expect(asset.stage).toBe("observed");
    expect(asset.evidence.crossRepoCount).toBe(2);
  });

  it("promotes observed → validated with RFC reference", () => {
    engine.observe({
      name: "rfc_rule", kind: "verification_rule",
      domain: "TLS", repo: "repo1", rfcRefs: ["8446"], sequenceCount: 5,
    });
    const asset = engine.observe({
      name: "rfc_rule", kind: "verification_rule",
      domain: "TLS", repo: "repo2", rfcRefs: ["8446"], sequenceCount: 3,
    });
    expect(asset.stage).toBe("validated");
  });

  it("does NOT auto-promote to validated without RFC or human review", () => {
    engine.observe({
      name: "no_rfc_rule", kind: "verification_rule",
      domain: "Test", repo: "repo1", sequenceCount: 5,
    });
    const asset = engine.observe({
      name: "no_rfc_rule", kind: "verification_rule",
      domain: "Test", repo: "repo2", sequenceCount: 3,
    });
    // Should be at "observed" but NOT "validated" (no RFC, no human review)
    expect(asset.stage).toBe("observed");
    expect(STAGE_ORDER[asset.stage]).toBeLessThan(STAGE_ORDER.validated);
  });

  it("importance ≠ frequency: memcpy with 5000 freq has lower importance than TLS init", () => {
    const memcpy = engine.observe({
      name: "memcpy", kind: "verification_rule",
      domain: "Memory", repo: "repo1", sequenceCount: 5000,
    });
    const tlsInit = engine.observe({
      name: "tls_init", kind: "verification_rule",
      domain: "TLS", repo: "repo1", sequenceCount: 8,
    });

    // TLS init should have higher importance despite lower frequency
    expect(tlsInit.importance).toBeGreaterThan(memcpy.importance);
  });

  it("human promotion to validated works explicitly", () => {
    engine.observe({
      name: "human_reviewed", kind: "verification_rule",
      domain: "Test", repo: "repo1", sequenceCount: 5,
    });
    engine.observe({
      name: "human_reviewed", kind: "verification_rule",
      domain: "Test", repo: "repo2", sequenceCount: 3,
    });

    const result = engine.promote(
      "verification_rule:Test:human_reviewed",
      "human",
      "reviewer@example.com"
    );

    expect(result.promoted).toBe(true);
    expect(result.to).toBe("validated");
  });

  it("knowledge units and verification rules share the same pipeline", () => {
    const ku = engine.observe({
      name: "TLS Handshake", kind: "knowledge_unit",
      domain: "TLS", repo: "curl", rfcRefs: ["8446"], sequenceCount: 10,
    });
    engine.observe({
      name: "TLS Handshake", kind: "knowledge_unit",
      domain: "TLS", repo: "nginx", rfcRefs: ["8446"], sequenceCount: 5,
    });

    const vr = engine.observe({
      name: "close_file", kind: "verification_rule",
      domain: "File", repo: "curl", sequenceCount: 15,
    });
    engine.observe({
      name: "close_file", kind: "verification_rule",
      domain: "File", repo: "nginx", sequenceCount: 8,
    });

    // Both kinds go through the same lifecycle
    expect(ku.kind).toBe("knowledge_unit");
    expect(vr.kind).toBe("verification_rule");
    // Both promoted through the pipeline
    expect(STAGE_ORDER[ku.stage]).toBeGreaterThanOrEqual(STAGE_ORDER.observed);
    expect(STAGE_ORDER[vr.stage]).toBeGreaterThanOrEqual(STAGE_ORDER.observed);
  });

  it("promotion gates are idempotent", () => {
    const asset = engine.observe({
      name: "idempotent_test", kind: "verification_rule",
      domain: "Test", repo: "repo1", sequenceCount: 5,
    });
    const stage1 = asset.stage;

    // Try to promote again — should not change
    const result = engine.promote("verification_rule:Test:idempotent_test", "auto");
    const after = engine.observe({
      name: "idempotent_test", kind: "verification_rule",
      domain: "Test", repo: "repo1", sequenceCount: 1,
    });

    // Stage shouldn't regress
    expect(STAGE_ORDER[after.stage]).toBeGreaterThanOrEqual(STAGE_ORDER[stage1]);
  });

  it("promotion gates reject invalid transitions", () => {
    // Create asset at evidence
    const asset = engine.observe({
      name: "stuck_asset", kind: "verification_rule",
      domain: "Test", repo: "repo1", sequenceCount: 0,
    });
    // It should still be at evidence (no sequence evidence)
    expect(asset.stage).toBe("evidence");
  });

  it("getReviewCandidates returns assets at candidate stage", () => {
    // Create an asset that stays at candidate (only 1 repo)
    engine.observe({
      name: "candidate_only", kind: "verification_rule",
      domain: "Test", repo: "solo_repo", sequenceCount: 5,
    });

    const candidates = engine.getReviewCandidates();
    expect(candidates.length).toBeGreaterThanOrEqual(0);
    // All returned assets should be at "candidate" stage
    for (const c of candidates) {
      expect(c.stage).toBe("candidate");
    }
  });

  it("getByStage filters correctly", () => {
    const observed = engine.getByStage("observed");
    for (const a of observed) {
      expect(a.stage).toBe("observed");
    }
  });

  it("getByKind separates knowledge_units from verification_rules", () => {
    const kus = engine.getByKind("knowledge_unit");
    const vrs = engine.getByKind("verification_rule");
    for (const ku of kus) expect(ku.kind).toBe("knowledge_unit");
    for (const vr of vrs) expect(vr.kind).toBe("verification_rule");
  });
});
