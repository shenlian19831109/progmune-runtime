/**
 * P6.7: Large-scale Protocol Mining Tests
 */

import { describe, it, expect } from "vitest";
import { runLargeScaleMining, printMiningReport, MINING_SIGNATURES, RepoSignature } from "./protocol-mining";

describe("P6.7 Large-scale Protocol Mining", () => {
  it("curated 20+ repo signatures across diverse domains", () => {
    expect(MINING_SIGNATURES.length).toBeGreaterThanOrEqual(20);

    const domains = new Set(MINING_SIGNATURES.map(s => s.domain));
    // Should cover at least 10 distinct domains
    expect(domains.size).toBeGreaterThanOrEqual(10);

    const languages = new Set(MINING_SIGNATURES.map(s => s.language));
    expect(languages.size).toBeGreaterThanOrEqual(4); // Python, JS, Go, C, Rust
  });

  it("each signature has valid call patterns", () => {
    for (const sig of MINING_SIGNATURES) {
      expect(sig.patterns.length).toBeGreaterThan(0);
      for (const p of sig.patterns) {
        expect(p.length).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("runs full mining pipeline and measures bootstrap improvement", async () => {
    const report = await runLargeScaleMining();

    expect(report.reposScanned).toBeGreaterThanOrEqual(20);
    expect(report.sequencesExtracted).toBeGreaterThan(50);
    expect(report.uniqueSequences).toBeGreaterThan(30);
    expect(report.clustersFound).toBeGreaterThan(0);

    // New rules should be synthesized from the expanded corpus
    expect(report.newRulesSynthesized).toBeGreaterThan(0);
    // Total rules should be significantly larger than the original 31
    expect(report.totalRulesAfter).toBeGreaterThan(40);

    printMiningReport(report);
  }, 30000);
});
