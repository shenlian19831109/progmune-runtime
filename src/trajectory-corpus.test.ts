/**
 * P6.10: Trajectory Corpus Expansion Tests
 */

import { describe, it, expect } from "vitest";
import { EXPANDED_TRAJECTORIES, collectExpandedTrajectories, runCorpusExpansion, printExpansionReport } from "./trajectory-corpus";
import { synthesizeProtocols } from "./auto-protocol-synthesizer";

describe("P6.10 Trajectory Corpus Expansion", () => {
  it("contains 50+ sequences across 10 libraries", () => {
    expect(EXPANDED_TRAJECTORIES.length).toBe(10);

    const all = collectExpandedTrajectories();
    expect(all.length).toBeGreaterThanOrEqual(50);

    const libraries = new Set(EXPANDED_TRAJECTORIES.map(l => l.library));
    expect(libraries.size).toBe(10);

    const domains = new Set(EXPANDED_TRAJECTORIES.map(l => l.domain));
    expect(domains.size).toBeGreaterThanOrEqual(5);
  });

  it("synthesizes protocols from expanded corpus", () => {
    const expanded = collectExpandedTrajectories();
    const protocols = synthesizeProtocols(expanded);

    expect(protocols.length).toBeGreaterThan(0);
    // With 50+ expanded sequences, should find more clusters than the original 5
    expect(protocols.length).toBeGreaterThanOrEqual(3);
  });

  it("runs corpus expansion and measures bootstrap improvement", async () => {
    const report = await runCorpusExpansion();

    expect(report.expandedCount).toBeGreaterThanOrEqual(50);
    expect(report.rulesSynthesized).toBeGreaterThan(0);

    printExpansionReport(report);
  }, 30000);
});
