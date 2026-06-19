/**
 * P9.2e: Three-Tier Gold Data System with Annotation Benefit Scoring
 *
 * Tier 1 (Verified Gold):   Git Diff + human verified + before/after SM
 * Tier 2 (Silver Gold):     Git Diff + auto-extracted + human spot-check
 * Tier 3 (Raw CVE Pool):    NVD / GitHub Advisory / OSS-Fuzz, auto-scored
 *
 * Data flywheel: Raw → assessGoldQuality() → Silver → human verify → Gold
 *
 * Annotation Benefit Score:
 *   benefit = quality × novelty × coverage_gain
 *
 * This prevents over-annotating already-well-covered categories
 * (e.g., 30th auth_bypass) and prioritizes rare but valuable cases
 * (e.g., first session_fixation, double_free).
 */

import { assessGoldQuality } from "./gold-quality";

// ═══════════════════════════════════════════════════════════════
// Tier Types
// ═══════════════════════════════════════════════════════════════

export type GoldTier = "gold" | "silver" | "raw";

export interface TieredCase {
  id: string;
  tier: GoldTier;
  category: string;
  broken: string[];
  expected: string[];
  /** Quality score from assessGoldQuality (0-1). */
  quality: number;
  /** Is this case human-verified? */
  verified: boolean;
  /** Source: git_diff, nvd, curated, synthetic */
  source: string;
  /** Annotation benefit score (0-1). Prioritizes rare, high-quality cases. */
  benefit: number;
  notes?: string;
}

export interface TieredDataset {
  cases: TieredCase[];
  metadata: {
    total: number;
    byTier: Record<GoldTier, number>;
    byCategory: Record<string, number>;
    /** Coverage vector: which categories have at least 1 gold case? */
    coveredCategories: string[];
    uncoveredCategories: string[];
  };
}

// ═══════════════════════════════════════════════════════════════
// Category registry — all known lifecycle vulnerability types
// ═══════════════════════════════════════════════════════════════

const ALL_CATEGORIES = [
  "resource_leak",
  "auth_bypass",
  "use_after_free",
  "double_free",
  "race_condition",
  "data_corruption",
  "transaction_violation",
  "session_fixation",
  "privilege_escalation",
  "missing_validation",
];

// ═══════════════════════════════════════════════════════════════
// Annotation Benefit Scoring
// ═══════════════════════════════════════════════════════════════

/**
 * Compute the annotation benefit score for a candidate case.
 *
 * benefit = quality × novelty × coverage_gain
 *
 * quality:       how detectable is this case? (0-1, from assessGoldQuality)
 * novelty:       how rare is this category in the existing gold set? (0-1)
 * coverage_gain: would adding this case cover a new category? (1.0 if new, 0.5 if existing)
 *
 * High benefit = rare category + good structural signal.
 * Low benefit = already-well-covered category or weak signal.
 */
export function computeBenefit(
  quality: number,
  category: string,
  existingGoldByCategory: Record<string, number>
): number {
  // Quality: direct from assessor
  const q = Math.max(0, Math.min(1, quality));

  // Novelty: inverse of how many gold cases we already have in this category
  const existingCount = existingGoldByCategory[category] || 0;
  const novelty = 1.0 / (1.0 + existingCount * 0.3);
  // With 0 existing: novelty = 1.0
  // With 10 existing: novelty = 0.25
  // With 30 existing: novelty = 0.1

  // Coverage gain: bonus for entirely new categories
  const isNew = existingCount === 0;
  const coverage = isNew ? 1.0 : 0.5;

  const benefit = q * novelty * coverage;
  return Math.round(benefit * 1000) / 1000;
}

// ═══════════════════════════════════════════════════════════════
// Build the tiered dataset
// ═══════════════════════════════════════════════════════════════

export function buildTieredDataset(): TieredDataset {
  const cases: TieredCase[] = [];

  // ── Tier 1: Verified Gold (curated + diff-based) ──
  const { REAL_WORLD_DEFECTS } = require("./realworld-benchmark");

  for (const d of REAL_WORLD_DEFECTS) {
    const q = assessGoldQuality(d.broken, d.expected);
    cases.push({
      id: d.id,
      tier: "gold",
      category: d.category,
      broken: d.broken,
      expected: d.expected,
      quality: q.score,
      verified: true,
      source: "curated",
      benefit: 0, // computed after category counts are known
      notes: d.description,
    });
  }

  // Diff-based gold from gold-seed.json
  try {
    const fs = require("fs");
    const path = require("path");
    const seedPath = path.resolve(__dirname, "..", "benchmarks", "gold-seed.json");
    if (fs.existsSync(seedPath)) {
      const seed = JSON.parse(fs.readFileSync(seedPath, "utf-8"));
      for (const c of seed) {
        const q = assessGoldQuality(c.before, c.after);
        cases.push({
          id: `GOLD-${c.cve}`,
          tier: "gold",
          category: c.category,
          broken: c.before,
          expected: c.after,
          quality: q.score,
          verified: true,
          source: "git_diff",
          benefit: 0,
          notes: c.notes,
        });
      }
    }
  } catch {}

  // ── Tier 3: Raw CVE Pool (synthetic, awaiting assessment) ──
  try {
    const { createProtocolForTopology, ALL_TOPOLOGIES } = require("./topology-factory");
    const categories = [
      "resource_leak", "auth_bypass", "data_corruption",
      "use_after_free", "race_condition",
    ];
    let sid = 500;

    for (const topo of ALL_TOPOLOGIES) {
      const rules = createProtocolForTopology(topo);
      const entries = [...rules.entries()];
      if (entries.length < 2) continue;

      for (let v = 0; v < 3; v++) {
        const path: string[] = [];
        const ss = new Set<string>(["INIT", "IDLE"]);
        const s = entries[Math.floor(Math.random() * entries.length)];
        path.push(s[0]); const r = s[1];
        if (r.invalidate) r.invalidate.forEach((x: string) => ss.delete(x));
        for (const x of r.post_states) ss.add(x);
        for (let t = 0; t < 4; t++) {
          const cands = entries.filter(([, rr]: [string, any]) =>
            rr.pre_states.every((x: string) => ss.has(x)));
          if (!cands.length) break;
          const [fn, nr] = cands[Math.floor(Math.random() * cands.length)];
          path.push(fn);
          if (nr.invalidate) nr.invalidate.forEach((x: string) => ss.delete(x));
          for (const x of nr.post_states) ss.add(x);
        }
        if (path.length < 3) continue;

        const cat = categories[sid % categories.length];
        const broken = path.slice(0, -1);
        const expected = path;
        const q = assessGoldQuality(broken, expected);

        cases.push({
          id: `RAW-${sid++}`,
          tier: q.detectable ? "silver" : "raw",
          category: cat,
          broken,
          expected,
          quality: q.score,
          verified: false,
          source: "synthetic",
          benefit: 0,
        });
      }
    }
  } catch {}

  // ── Compute benefit scores using final category counts ──
  const goldByCategory: Record<string, number> = {};
  for (const c of cases) {
    if (c.tier === "gold") {
      goldByCategory[c.category] = (goldByCategory[c.category] || 0) + 1;
    }
  }

  for (const c of cases) {
    c.benefit = computeBenefit(c.quality, c.category, goldByCategory);
  }

  // ── Build metadata ──
  const byTier: Record<GoldTier, number> = { gold: 0, silver: 0, raw: 0 };
  const byCategory: Record<string, number> = {};
  for (const c of cases) {
    byTier[c.tier] = (byTier[c.tier] || 0) + 1;
    byCategory[c.category] = (byCategory[c.category] || 0) + 1;
  }

  const coveredCategories = ALL_CATEGORIES.filter(cat =>
    cases.some(c => c.tier === "gold" && c.category === cat)
  );
  const uncoveredCategories = ALL_CATEGORIES.filter(cat =>
    !coveredCategories.includes(cat)
  );

  return {
    cases,
    metadata: {
      total: cases.length,
      byTier,
      byCategory,
      coveredCategories,
      uncoveredCategories,
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// Prioritization: what should a human annotator work on next?
// ═══════════════════════════════════════════════════════════════

export interface AnnotationPriority {
  /** Category to annotate. */
  category: string;
  /** How many gold cases exist in this category. */
  goldCount: number;
  /** How many raw/silver cases are waiting. */
  pendingCount: number;
  /** Average benefit of annotating one more case in this category. */
  avgBenefit: number;
  /** Priority rank (1 = highest). */
  rank: number;
}

export function getAnnotationPriorities(dataset: TieredDataset): AnnotationPriority[] {
  const priorities: AnnotationPriority[] = [];

  for (const cat of ALL_CATEGORIES) {
    const goldCount = dataset.cases.filter(c => c.tier === "gold" && c.category === cat).length;
    const pending = dataset.cases.filter(c => c.tier !== "gold" && c.category === cat);
    const pendingCount = pending.length;
    const avgBenefit = pending.length > 0
      ? pending.reduce((s, c) => s + c.benefit, 0) / pending.length
      : (goldCount === 0 ? 0.8 : 0); // uncovered categories get high priority

    priorities.push({ category: cat, goldCount, pendingCount, avgBenefit, rank: 0 });
  }

  // Rank by avgBenefit descending
  priorities.sort((a, b) => b.avgBenefit - a.avgBenefit);
  priorities.forEach((p, i) => { p.rank = i + 1; });

  return priorities;
}

// ═══════════════════════════════════════════════════════════════
// Reporting
// ═══════════════════════════════════════════════════════════════

export function printTieredReport(dataset: TieredDataset): void {
  console.log("\n╔════════════════════════════════════════════════════╗");
  console.log("║   P9.2e Three-Tier Gold Data System                ║");
  console.log("╚════════════════════════════════════════════════════╝\n");

  console.log(`  Total cases: ${dataset.metadata.total}`);
  console.log(`  Tier 1 (Gold):   ${dataset.metadata.byTier.gold} (verified)`);
  console.log(`  Tier 2 (Silver): ${dataset.metadata.byTier.silver} (auto, detectable)`);
  console.log(`  Tier 3 (Raw):    ${dataset.metadata.byTier.raw} (auto, pending)`);
  console.log();

  console.log(`  Covered categories:   ${dataset.metadata.coveredCategories.join(", ") || "none"}`);
  console.log(`  Uncovered categories: ${dataset.metadata.uncoveredCategories.join(", ") || "none"}`);
  console.log();

  const priorities = getAnnotationPriorities(dataset);
  console.log(`  ── Annotation Priority ──`);
  console.log(`  ${'Rank'.padEnd(6)} ${'Category'.padEnd(22)} ${'Gold'.padEnd(6)} ${'Pending'.padEnd(8)} ${'Avg Benefit'}`);
  console.log(`  ${'─'.repeat(62)}`);
  for (const p of priorities) {
    const icon = p.goldCount === 0 ? "🆕" : p.goldCount < 3 ? "⚠️" : "✅";
    console.log(`  ${String(p.rank).padEnd(6)} ${icon} ${p.category.padEnd(20)} ${String(p.goldCount).padEnd(6)} ${String(p.pendingCount).padEnd(8)} ${p.avgBenefit.toFixed(3)}`);
  }
  console.log();
}
