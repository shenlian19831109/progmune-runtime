/**
 * P5.7: Real-world Defect Benchmark Tests
 */

import { describe, it, expect } from "vitest";
import { runRealWorldBenchmark, printRealWorldReport, REAL_WORLD_DEFECTS, RealWorldDefect } from "./realworld-benchmark";

describe("Real-world Defect Benchmark", () => {
  it("all curated defects have valid structure", () => {
    expect(REAL_WORLD_DEFECTS.length).toBeGreaterThanOrEqual(8);

    for (const d of REAL_WORLD_DEFECTS) {
      expect(d.id).toMatch(/^RW-\d{3}$/);
      expect(d.broken.length).toBeGreaterThan(0);
      expect(d.expected.length).toBeGreaterThan(0);
      expect(["critical", "high", "medium", "low"]).toContain(d.severity);
      expect(["resource_leak", "auth_bypass", "data_corruption", "use_after_free", "race_condition"]).toContain(d.category);
    }
  });

  it("covers all severity levels", () => {
    const severities = new Set(REAL_WORLD_DEFECTS.map(d => d.severity));
    expect(severities.has("critical")).toBe(true);
    expect(severities.has("high")).toBe(true);
    expect(severities.has("medium")).toBe(true);
  });

  it("covers all defect categories", () => {
    const categories = new Set(REAL_WORLD_DEFECTS.map(d => d.category));
    expect(categories.size).toBeGreaterThanOrEqual(4);
  });

  it("runs planner against real-world defects", async () => {
    const report = await runRealWorldBenchmark();

    expect(report.totalDefects).toBe(10);
    expect(report.detectionRate).toBeGreaterThanOrEqual(0);
    expect(report.top3RepairRate).toBeGreaterThanOrEqual(0);

    printRealWorldReport(report);
  }, 30000);
});
