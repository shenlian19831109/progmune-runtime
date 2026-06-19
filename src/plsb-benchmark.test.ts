/**
 * PLSB-100: Protocol Lifecycle Security Benchmark Tests
 */
import { describe, it, expect } from "vitest";
import { buildPLSB, exportPLSB, printPLSBReport, PROTOCOL_WEAKNESS_TAXONOMY, PLSWeakness } from "./plsb-benchmark";
import { runGoldBenchmark } from "./gold-cve";
import * as fs from "fs";
import * as path from "path";

describe("PLSB-100 Benchmark", () => {
  it("taxonomy has 13 weakness types with valid structure", () => {
    expect(PROTOCOL_WEAKNESS_TAXONOMY.length).toBe(13);

    const ids = new Set<string>();
    for (const w of PROTOCOL_WEAKNESS_TAXONOMY) {
      expect(w.id).toMatch(/^PLS-\d{3}$/);
      expect(w.name).toBeTruthy();
      expect(w.category).toBeTruthy();
      expect(w.description.length).toBeGreaterThan(20);
      expect(w.example_broken.length).toBeGreaterThan(0);
      expect(w.example_expected.length).toBeGreaterThan(0);
      expect(ids.has(w.id)).toBe(false); // no duplicates
      ids.add(w.id);
    }
  });

  it("builds benchmark with at least 25 verified entries", () => {
    const b = buildPLSB();
    expect(b.entries.length).toBeGreaterThanOrEqual(25);
    expect(b.metadata.verified).toBeGreaterThanOrEqual(25);
    expect(b.taxonomy).toBe(PROTOCOL_WEAKNESS_TAXONOMY);
  });

  it("exports and re-imports PLSB benchmark faithfully", () => {
    const b = buildPLSB();
    const tmpPath = path.resolve(__dirname, "..", "benchmarks", "plsb-test-tmp.json");
    exportPLSB(b, tmpPath);

    const reloaded = JSON.parse(fs.readFileSync(tmpPath, "utf-8"));
    expect(reloaded.entries.length).toBe(b.entries.length);
    expect(reloaded.taxonomy.length).toBe(b.taxonomy.length);
    expect(reloaded.metadata.verified).toBe(b.metadata.verified);

    fs.unlinkSync(tmpPath);
  });

  it("every verified entry has valid broken/expected arrays", () => {
    const b = buildPLSB();
    const verified = b.entries.filter(e => e.verified);
    expect(verified.length).toBeGreaterThan(0);

    for (const e of verified) {
      expect(e.broken.length).toBeGreaterThan(0);
      expect(e.expected.length).toBeGreaterThan(0);
      expect(e.category).toBeTruthy();
      expect(e.source).toBeTruthy();
    }
  });

  it("verified recall exceeds 85%", () => {
    const b = buildPLSB();
    const verified = b.entries.filter(e => e.verified);

    if (verified.length === 0) return;
    const goldDataset: any = {
      cases: verified.map(e => ({
        id: e.id, category: e.category, severity: e.severity,
        broken: e.broken, expected: e.expected,
        verifiedBy: e.source, notes: e.notes,
      })),
      metadata: { total: verified.length, byCategory: {}, verifiedBy: {} },
    };
    const result = runGoldBenchmark(goldDataset);
    expect(result.recall).toBeGreaterThan(0.85);
  });

  it("at least 5 PLS categories are covered", () => {
    const b = buildPLSB();
    expect(b.metadata.coverage.covered).toBeGreaterThanOrEqual(5);
  });

  it("all entries map to valid PLS IDs or none", () => {
    const b = buildPLSB();
    const validPLS = new Set(PROTOCOL_WEAKNESS_TAXONOMY.map(t => t.id));

    for (const e of b.entries) {
      if (e.pls_id) {
        expect(validPLS.has(e.pls_id)).toBe(true);
      }
    }
  });

  it("prints report without throwing", () => {
    const b = buildPLSB();
    expect(() => printPLSBReport(b)).not.toThrow();
  });
});
