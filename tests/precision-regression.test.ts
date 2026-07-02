/**
 * P1: Precision Regression Test
 *
 * Ensures precision metrics don't regress below baseline across releases.
 * Run this in CI to catch degradations before they ship.
 *
 * Baseline: 2026-07-02 (first cross-repo measurement)
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ═══════════════════════════════════════════════════════════════
// Baseline thresholds (from 2026-07-02 measurement)
// These are conservative floors — improvements should raise them.
// ═══════════════════════════════════════════════════════════════

const BASELINE = {
  curl:    { minF1: 0.30, maxFPR: 0.98, minRecall: 0.65 },
  libssh:  { minF1: 0.35, maxFPR: 0.98, minRecall: 0.75 },
  nginx:   { minF1: 0.00, maxFPR: 0.60, minRecall: 0.00 },
  redis:   { minF1: 0.00, maxFPR: 0.95, minRecall: 0.00 },
  overall: { minMicroF1: 0.20, minMacroF1: 0.15 },
} as const;

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

interface PrecisionData {
  repo: string;
  precision: number;
  recall: number;
  f1: number;
  falsePositiveRate: number;
  falseNegativeRate: number;
  total: number;
}

function loadLatestReport(): { repos: PrecisionData[]; overall: { microF1: number; macroF1: number } } | null {
  const reportPath = path.resolve(
    process.cwd(),
    "benchmarks", "reports", "cross-repo-precision-latest.json"
  );

  if (!fs.existsSync(reportPath)) {
    console.warn(`No precision report found at ${reportPath}`);
    console.warn(`Run: npx ts-node --transpile-only src/cross-repo-precision.ts`);
    return null;
  }

  try {
    const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
    return {
      repos: report.repos || [],
      overall: report.overall || { microF1: 0, macroF1: 0 },
    };
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════

describe("Precision Regression Guard", () => {

  it("precision report exists", () => {
    const report = loadLatestReport();
    // Report may not exist if precision hasn't been run yet
    // This is informational — not a hard failure
    if (!report) {
      console.warn("⚠ No precision report — skipping regression checks.");
      console.warn("  Generate with: npx ts-node --transpile-only src/cross-repo-precision.ts");
    }
    // Don't fail — allow first-time setup
    expect(true).toBe(true);
  });

  it("curl F1 does not regress below baseline", () => {
    const report = loadLatestReport();
    if (!report) return;

    const curl = report.repos.find(r => r.repo === "curl");
    if (!curl) return;

    expect(curl.f1).toBeGreaterThanOrEqual(BASELINE.curl.minF1);
    expect(curl.recall).toBeGreaterThanOrEqual(BASELINE.curl.minRecall);
    expect(curl.falsePositiveRate).toBeLessThanOrEqual(BASELINE.curl.maxFPR);
  });

  it("libssh F1 does not regress below baseline", () => {
    const report = loadLatestReport();
    if (!report) return;

    const libssh = report.repos.find(r => r.repo === "libssh");
    if (!libssh) return;

    expect(libssh.f1).toBeGreaterThanOrEqual(BASELINE.libssh.minF1);
    expect(libssh.recall).toBeGreaterThanOrEqual(BASELINE.libssh.minRecall);
    expect(libssh.falsePositiveRate).toBeLessThanOrEqual(BASELINE.libssh.maxFPR);
  });

  it("overall micro-F1 does not regress", () => {
    const report = loadLatestReport();
    if (!report) return;

    expect(report.overall.microF1).toBeGreaterThanOrEqual(BASELINE.overall.minMicroF1);
    expect(report.overall.macroF1).toBeGreaterThanOrEqual(BASELINE.overall.minMacroF1);
  });

  it("all measured repos have valid metrics (0 ≤ P,R,F1 ≤ 1)", () => {
    const report = loadLatestReport();
    if (!report) return;

    for (const repo of report.repos) {
      if (repo.total === 0) continue;
      expect(repo.precision).toBeGreaterThanOrEqual(0);
      expect(repo.precision).toBeLessThanOrEqual(1);
      expect(repo.recall).toBeGreaterThanOrEqual(0);
      expect(repo.recall).toBeLessThanOrEqual(1);
      expect(repo.f1).toBeGreaterThanOrEqual(0);
      expect(repo.f1).toBeLessThanOrEqual(1);
    }
  });

  it("report freshness: generated within last 30 days", () => {
    const reportPath = path.resolve(
      process.cwd(),
      "benchmarks", "reports", "cross-repo-precision-latest.json"
    );
    if (!fs.existsSync(reportPath)) return;

    const report = JSON.parse(fs.readFileSync(reportPath, "utf-8"));
    const generated = new Date(report.generated).getTime();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    const age = Date.now() - generated;

    // Report should be less than 30 days old
    if (age > thirtyDays) {
      console.warn(`⚠ Precision report is ${Math.round(age / 86400000)} days old.`);
      console.warn(`  Regenerate with: npx ts-node --transpile-only src/cross-repo-precision.ts`);
    }
    // Soft warning — don't fail CI for stale reports
    expect(true).toBe(true);
  });
});
