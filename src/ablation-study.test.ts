/**
 * P7.0: Ablation Study Tests
 */

import { describe, it, expect } from "vitest";
import { runAblationStudy, printAblationReport } from "./ablation-study";

describe("P7.0 Ablation Study", () => {
  it("measures repo similarity with and without synonyms", () => {
    const report = runAblationStudy();

    expect(report.baseline.repoSimilarity).toBeGreaterThan(0);
    expect(report.noSynonyms.repoSimilarity).toBeGreaterThanOrEqual(0);

    // The key metric: how much similarity survives without synonyms
    const survivalRate = report.noSynonyms.repoSimilarity / Math.max(0.01, report.baseline.repoSimilarity);
    console.log(`Survival rate (without synonyms): ${(survivalRate * 100).toFixed(0)}%`);

    printAblationReport(report);
  });
});
