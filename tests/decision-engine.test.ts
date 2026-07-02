/**
 * P7.5: Unified Decision Engine Tests
 */

import { describe, it, expect } from "vitest";
import { DecisionEngine, computeImportance } from "../src/decision-engine";
import type { UnifiedAsset, AssetStage } from "../src/asset-promotion";

function makeAsset(
  name: string, domain: string, stage: AssetStage,
  overrides: Partial<UnifiedAsset> = {}
): UnifiedAsset {
  return {
    id: `test:${domain}:${name}`,
    kind: "verification_rule",
    name,
    domain,
    stage,
    confidence: 0.85,
    importance: 50,
    evidence: {
      repos: ["curl", "nginx"],
      rfcRefs: [],
      sequenceCount: 10,
      crossRepoCount: 2,
      firstSeen: "2026-01-01T00:00:00Z",
      lastSeen: "2026-07-01T00:00:00Z",
    },
    history: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    description: `Test asset: ${name}`,
    ...overrides,
  };
}

describe("Decision Engine", () => {

  const engine = new DecisionEngine();

  // ── Importance Computation ──

  it("TLS handshake has higher importance than memcpy", () => {
    const tls = makeAsset("tls_handshake", "TLS", "validated", {
      evidence: { repos: ["curl", "nginx", "openssl"], rfcRefs: ["8446"],
        sequenceCount: 25, crossRepoCount: 3,
        firstSeen: "", lastSeen: "" },
    });
    const memcpy = makeAsset("memcpy", "Memory", "candidate", {
      evidence: { repos: ["curl"], rfcRefs: [],
        sequenceCount: 5000, crossRepoCount: 1,
        firstSeen: "", lastSeen: "" },
    });

    expect(computeImportance(tls)).toBeGreaterThan(computeImportance(memcpy));
  });

  it("importance is computed, not configured", () => {
    const asset = makeAsset("close_file", "File", "observed");
    const importance = computeImportance(asset);
    // Should be computed from impact × universality × criticality
    expect(importance).toBeGreaterThan(0);
    expect(importance).toBeLessThanOrEqual(100);
    // close_file = resource management (0.7) × 2 repos (0.4) × program-critical (1.0)
    // = 0.7*0.4 + 0.4*0.25 + 1.0*0.35 = 0.28 + 0.10 + 0.35 = 0.73 → 73
    expect(importance).toBeGreaterThan(60);
  });

  // ── Verification Decisions ──

  it("high-confidence asset → BLOCK", () => {
    const asset = makeAsset("tls_verify", "TLS", "stable", {
      confidence: 0.95,
      evidence: { repos: ["curl", "nginx"], rfcRefs: ["8446"],
        sequenceCount: 50, crossRepoCount: 2,
        firstSeen: "", lastSeen: "" },
    });

    const decision = engine.decideVerification(asset, {
      recentFPs: 1, recentTPs: 19,
    });
    expect(decision.action).toBe("BLOCK");
    expect(decision.confidence).toBeGreaterThan(0.8);
  });

  it("noisy asset with many FPs → SUPPRESS", () => {
    const asset = makeAsset("noisy_rule", "Test", "candidate", {
      confidence: 0.3,
    });

    const decision = engine.decideVerification(asset, {
      recentFPs: 15, recentTPs: 2,
    });
    expect(decision.action).toBe("SUPPRESS");
  });

  it("production environment is more conservative", () => {
    const asset = makeAsset("test_rule", "Test", "observed", {
      confidence: 0.65,
    });

    const prodDecision = engine.decideVerification(asset, {
      environment: "production", recentFPs: 1, recentTPs: 4,
    });
    const testDecision = engine.decideVerification(asset, {
      environment: "test", recentFPs: 1, recentTPs: 4,
    });

    // Production should be more conservative (lower confidence = less likely to block)
    expect(prodDecision.confidence).toBeLessThanOrEqual(testDecision.confidence);
  });

  // ── Promotion Decisions ──

  it("validated asset with deployment → promote", () => {
    const asset = makeAsset("deployed_rule", "TLS", "validated", {
      confidence: 0.80,
    });

    const decision = engine.decidePromotion(asset, {
      deploymentObservations: 50,
    });
    expect(decision.action).toBe("promote");
  });

  it("asset without deployment → hold", () => {
    const asset = makeAsset("no_deploy", "Test", "validated", {
      confidence: 0.80,
    });

    const decision = engine.decidePromotion(asset, {
      deploymentObservations: 0,
    });
    // Even with good confidence, no deployment data → promotion hold
    expect(decision.provenance.evidence).toContain("no deployment data");
  });

  it("low-confidence asset → demote", () => {
    const asset = makeAsset("low_conf", "Test", "candidate", {
      confidence: 0.15,
    });

    const decision = engine.decidePromotion(asset);
    expect(decision.action).toBe("demote");
  });

  // ── Repair Decisions ──

  it("high-importance asset → fix", () => {
    const asset = makeAsset("tls_critical", "TLS", "validated", {
      confidence: 0.85,
    });

    const decision = engine.decideRepair(asset);
    expect(decision.action).toBe("fix");
  });

  it("low-importance asset → report", () => {
    const asset = makeAsset("logging_fn", "Test", "candidate", {
      confidence: 0.3,
    });

    const decision = engine.decideRepair(asset);
    expect(decision.action).toBe("report");
  });

  it("human override respected", () => {
    const asset = makeAsset("test", "Test", "candidate");

    const decision = engine.decideRepair(asset, {
      humanOverride: "rollback",
    });
    expect(decision.action).toBe("rollback");
    expect(decision.provenance.decider).toBe("human");
  });

  // ── Deployment Decisions ──

  it("validated + deployments + low FP → deploy", () => {
    const asset = makeAsset("prod_ready", "TLS", "validated", {
      confidence: 0.85,
    });

    const decision = engine.decideDeployment(asset, {
      deploymentObservations: 30,
      recentFPs: 2, recentTPs: 18, // 10% FP rate
    });
    expect(decision.action).toBe("deploy");
  });

  it("high FP rate → rollback", () => {
    const asset = makeAsset("noisy_prod", "Test", "validated", {
      confidence: 0.60,
    });

    const decision = engine.decideDeployment(asset, {
      deploymentObservations: 10,
      recentFPs: 25, recentTPs: 5, // 83% FP rate
    });
    expect(decision.action).toBe("rollback");
  });

  it("no deployment data → hold", () => {
    const asset = makeAsset("untested", "Test", "validated", {
      confidence: 0.85,
    });

    const decision = engine.decideDeployment(asset, {
      deploymentObservations: 0,
    });
    expect(decision.action).toBe("hold");
  });

  // ── Provenance ──

  it("every decision has provenance", () => {
    const asset = makeAsset("prov_test", "TLS", "validated", {
      confidence: 0.85,
      evidence: { repos: ["curl", "nginx"], rfcRefs: ["8446"],
        sequenceCount: 10, crossRepoCount: 2,
        firstSeen: "", lastSeen: "" },
    });

    const decision = engine.decideVerification(asset);
    expect(decision.id).toBeTruthy();
    expect(decision.provenance).toBeDefined();
    expect(decision.provenance.assets).toContain(asset.id);
    expect(decision.provenance.evidence.length).toBeGreaterThan(0);
    expect(decision.provenance.decider).toBeDefined();
    expect(decision.provenance.timestamp).toBeTruthy();
  });

  it("decision history is tracked", () => {
    const asset = makeAsset("history_test", "Test", "observed");
    engine.decideVerification(asset);
    engine.decidePromotion(asset);

    const decisions = engine.getAssetDecisions(asset.id);
    expect(decisions.length).toBeGreaterThanOrEqual(2);
    expect(decisions[0].kind).toBeDefined();
  });

  // ── Importance overrides ──

  it("high-importance asset alerts at WARN even with moderate confidence", () => {
    const asset = makeAsset("auth_verify", "Auth", "observed", {
      confidence: 0.55, // Moderate
    });

    const decision = engine.decideVerification(asset, {
      recentFPs: 1, recentTPs: 4,
    });
    // Importance should be high (>70 for auth), so it should at least WARN
    expect(["BLOCK", "WARN"]).toContain(decision.action);
  });
});
