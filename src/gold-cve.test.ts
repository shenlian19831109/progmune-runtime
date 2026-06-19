/**
 * P9.2d: Gold CVE — diff-to-states conversion + detector validation
 *
 * Converts git-diff-based gold CVE data to gold dataset format,
 * then runs the invariant detector against verified sequences.
 * This isolates detector recall from ALL pipeline noise.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { loadGoldDataset, runGoldBenchmark, printGoldReport } from "./gold-cve";

const SEED_PATH = path.resolve(__dirname, "..", "benchmarks", "gold-seed.json");

function loadSeedGold(): any[] {
  if (!fs.existsSync(SEED_PATH)) return [];
  return JSON.parse(fs.readFileSync(SEED_PATH, "utf-8"));
}

function convertSeedToGold(seed: any[]): import("./gold-cve").GoldDataset {
  const cases = seed.map((c: any, i: number) => ({
    id: `GOLD-${String(i + 1).padStart(3, "0")}`,
    cve: c.cve,
    title: c.notes?.slice(0, 80) || c.cve,
    category: c.category,
    severity: c.severity || "high",
    broken: c.before,
    expected: c.after,
    project: c.project,
    verifiedBy: "git_diff" as const,
    notes: c.notes,
  }));

  const byCategory: Record<string, number> = {};
  for (const c of cases) byCategory[c.category] = (byCategory[c.category] || 0) + 1;

  return { cases, metadata: { total: cases.length, byCategory, verifiedBy: { git_diff: cases.length } } };
}

describe("P9.2d Diff-to-States Gold CVE", () => {
  it("converts seed diff data to gold dataset", () => {
    const seed = loadSeedGold();
    expect(seed.length).toBeGreaterThanOrEqual(3);

    const gold = convertSeedToGold(seed);
    expect(gold.cases.length).toBe(seed.length);

    // Every case should have verified broken/expected arrays
    for (const c of gold.cases) {
      expect(c.broken.length).toBeGreaterThan(0);
      expect(c.expected.length).toBeGreaterThan(0);
      expect(c.verifiedBy).toBe("git_diff");
    }
  });

  it("DETECTOR RUNS ON DIFF DATA: measures recall without parser noise", () => {
    const seed = loadSeedGold();
    if (seed.length === 0) return;

    const gold = convertSeedToGold(seed);
    const result = runGoldBenchmark(gold);
    printGoldReport(result);

    // With verified diff-based sequences, detector recall should be high
    expect(result.recall).toBeGreaterThan(0.6);
  });

  it("compares curated vs diff-based gold recall", () => {
    const curated = runGoldBenchmark(loadGoldDataset());
    const seed = loadSeedGold();
    if (seed.length === 0) return;
    const diffBased = runGoldBenchmark(convertSeedToGold(seed));

    console.log(`\n  Curated gold (20):   ${(curated.recall*100).toFixed(0)}% recall`);
    console.log(`  Diff-based gold (${seed.length}):  ${(diffBased.recall*100).toFixed(0)}% recall`);
    console.log(`  Both measured WITHOUT parser noise — pure detector performance.`);
  });
});
