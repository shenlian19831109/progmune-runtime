/**
 * Auto-benchmark Generator
 *
 * Generates benchmark cases from synthesized protocols + real-world defects.
 * Expands the benchmark suite from 3 to 20+ cases, enabling meaningful
 * behavioral equivalence measurement.
 *
 * Sources:
 *   1. Synthesized protocols → typical lifecycle paths
 *   2. Real-world defects → broken → expected pairs
 *   3. Cross-repo sequences → protocol-specific test cases
 */

import { synthesizeAllKnownProtocols, SynthesizedProtocol } from "./auto-protocol-synthesizer";
import { REAL_WORLD_DEFECTS } from "./realworld-benchmark";
import { collectTrajectoriesAtScale } from "./scale-trajectory-collector";
import { normalizeFunctionName } from "./function-synonyms";

export interface AutoBenchmarkCase {
  goal: string;
  protocol: string;
  broken: string[];
  expected: string[];
  violationType: string;
  source: string;
}

/**
 * Generate benchmarks from synthesized protocols.
 * For each protocol, create a "missing the last step" test case.
 */
function generateFromProtocols(protocols: SynthesizedProtocol[]): AutoBenchmarkCase[] {
  const cases: AutoBenchmarkCase[] = [];

  for (const sp of protocols) {
    if (sp.prototype.length < 2) continue;

    // Normalize the prototype
    const norm = sp.prototype.map(normalizeFunctionName);

    // Case: broken = remove the last action (resource leak)
    cases.push({
      goal: `cover protocol: ${sp.prototype.join(" → ")}`,
      protocol: "_global",
      broken: norm.slice(0, -1),
      expected: norm,
      violationType: "resource_leak",
      source: `synthesized:${sp.clusterId}`,
    });

    // Case: broken = remove the first action (missing prerequisite)
    if (norm.length >= 3) {
      cases.push({
        goal: `cover prerrequisite: ${sp.prototype.join(" → ")}`,
        protocol: "_global",
        broken: norm.slice(1),
        expected: norm,
        violationType: "missing_prerequisite",
        source: `synthesized:${sp.clusterId}`,
      });
    }
  }

  return cases;
}

/**
 * Convert real-world defects to benchmark cases.
 */
function convertDefects(): AutoBenchmarkCase[] {
  return REAL_WORLD_DEFECTS.map(d => ({
    goal: d.title,
    protocol: d.protocol,
    broken: d.broken.map(normalizeFunctionName),
    expected: d.expected.map(normalizeFunctionName),
    violationType: d.violationType,
    source: `realworld:${d.id}`,
  }));
}

/**
 * Generate benchmarks from the expanded corpus.
 * Take representative sequences and create test cases.
 */
function generateFromCorpus(sequences: string[][]): AutoBenchmarkCase[] {
  const cases: AutoBenchmarkCase[] = [];
  const seen = new Set<string>();

  for (const seq of sequences) {
    if (seq.length < 3) continue;
    const norm = seq.map(normalizeFunctionName);
    const key = norm.join("→");
    if (seen.has(key)) continue;
    seen.add(key);

    // Take every 5th unique sequence as a benchmark case
    if (seen.size % 5 === 0) {
      cases.push({
        goal: `corpus pattern: ${key}`,
        protocol: "_global",
        broken: norm.slice(0, -1),
        expected: norm,
        violationType: "resource_leak",
        source: "corpus",
      });
    }
  }

  return cases;
}

// ═══════════════════════════════════════════════════════════════
// Full Generator
// ═══════════════════════════════════════════════════════════════

export interface ExpandedBenchmarkSuite {
  cases: AutoBenchmarkCase[];
  bySource: Record<string, number>;
  totalCases: number;
}

/**
 * Generate an expanded benchmark suite from all available sources.
 * Target: 20+ cases covering synthesized protocols, real defects, and corpus patterns.
 */
export function generateExpandedBenchmarks(): ExpandedBenchmarkSuite {
  const protocols = synthesizeAllKnownProtocols();
  const { sequences } = collectTrajectoriesAtScale();

  const protocolCases = generateFromProtocols(protocols);
  const defectCases = convertDefects();
  const corpusCases = generateFromCorpus(sequences);

  const allCases = [...protocolCases, ...defectCases, ...corpusCases];

  // Deduplicate by expected sequence
  const seen = new Set<string>();
  const unique: AutoBenchmarkCase[] = [];
  for (const c of allCases) {
    const key = c.expected.join("→");
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(c);
    }
  }

  const bySource: Record<string, number> = {};
  for (const c of unique) {
    const src = c.source.split(":")[0];
    bySource[src] = (bySource[src] || 0) + 1;
  }

  return {
    cases: unique,
    bySource,
    totalCases: unique.length,
  };
}

export function printExpandedBenchmarkReport(suite: ExpandedBenchmarkSuite): void {
  console.log("\n─── Expanded Benchmark Suite ───");
  console.log(`  Total Cases: ${suite.totalCases}`);
  console.log("  By Source:");
  for (const [src, count] of Object.entries(suite.bySource)) {
    console.log(`    ${src.padEnd(14)} ${count}`);
  }
  console.log();
}
