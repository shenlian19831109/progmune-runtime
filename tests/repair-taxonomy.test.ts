/**
 * P4: Repair Failure Taxonomy Tests
 */

import { describe, it, expect } from "vitest";
import {
  classifyRepairFailure,
  generateRepairTaxonomyReport,
} from "../src/repair-taxonomy";

describe("Repair Failure Taxonomy", () => {

  // ── Classification Tests ──

  it("classifies empty fixPath as NO_PATH", () => {
    const result = classifyRepairFailure({
      violation: { fixPath: [], description: "something wrong" },
    });
    expect(result).toBe("NO_PATH");
  });

  it("classifies undefined fixPath as NO_PATH", () => {
    const result = classifyRepairFailure({
      violation: { description: "unknown" },
    });
    expect(result).toBe("NO_PATH");
  });

  it("classifies 'still leaking' as NOT_APPLIED", () => {
    const result = classifyRepairFailure({
      violation: { fixPath: ["close_file"], description: "Attempted fix but still leaking" },
      successRate: 0,
    });
    expect(result).toBe("NOT_APPLIED");
  });

  it("classifies 'fix didn't work' as NOT_APPLIED", () => {
    const result = classifyRepairFailure({
      violation: { fixPath: ["close_file"], description: "Fix didn't work" },
    });
    expect(result).toBe("NOT_APPLIED");
  });

  it("classifies rejected feedback as HUMAN_REJECTED", () => {
    const result = classifyRepairFailure({
      violation: { fixPath: ["close_file"], description: "Developer rejected this fix" },
      feedback: { rejected: true },
    });
    expect(result).toBe("HUMAN_REJECTED");
  });

  it("classifies wrong order as WRONG_STRATEGY", () => {
    const result = classifyRepairFailure({
      violation: { fixPath: ["close_file"], description: "wrong order of operations" },
    });
    expect(result).toBe("WRONG_STRATEGY");
  });

  it("classifies compile error as COMPILE_FAILED", () => {
    const result = classifyRepairFailure({
      violation: { fixPath: ["close_file"], description: "compile error: undefined function" },
    });
    expect(result).toBe("COMPILE_FAILED");
  });

  it("defaults to VERIFY_FAILED for unknown descriptions", () => {
    const result = classifyRepairFailure({
      violation: { fixPath: ["some_fix"], description: "unknown failure mode" },
    });
    expect(result).toBe("VERIFY_FAILED");
  });

  // ── Report Generation ──

  it("generates report without crashing", () => {
    const report = generateRepairTaxonomyReport();
    expect(report).toBeDefined();
    expect(report.totalRepairs).toBeGreaterThanOrEqual(0);
    expect(report.buckets.length).toBeGreaterThanOrEqual(0);
    expect(report.summary).toBeTruthy();
    expect(report.recommendations.length).toBeGreaterThan(0);
  });

  it("report buckets sum to failure count", () => {
    const report = generateRepairTaxonomyReport();
    const bucketSum = report.buckets.reduce((s, b) => s + b.count, 0);
    expect(bucketSum).toBe(report.failureCount);
  });

  it("success + failure = total", () => {
    const report = generateRepairTaxonomyReport();
    expect(report.successCount + report.failureCount).toBe(report.totalRepairs);
  });

  it("classifies NOT_APPLIED BEFORE HUMAN_REJECTED (description priority)", () => {
    // A rejected fix that ALSO wasn't applied should be NOT_APPLIED
    const result = classifyRepairFailure({
      violation: { fixPath: ["close_file"], description: "Attempted fix but still leaking" },
      feedback: { rejected: true },
    });
    // NOT_APPLIED is more specific — the fix was NEVER actually applied
    expect(result).toBe("NOT_APPLIED");
  });
});
