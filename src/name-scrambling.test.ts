/**
 * P7.1: Name Scrambling Tests
 */

import { describe, it, expect } from "vitest";
import { runNameScrambling, printScramblingReport } from "./name-scrambling";

describe("P7.1 Name Scrambling", () => {
  it("runs the decisive structure learning test", () => {
    const report = runNameScrambling();

    expect(report.baseline).toBeGreaterThan(0);
    expect(report.nameSurvivalRate).toBeGreaterThanOrEqual(0);
    expect(report.nameSurvivalRate).toBeLessThanOrEqual(1.5); // may exceed 1 if scrambled similarity > baseline

    printScramblingReport(report);
  });
});
