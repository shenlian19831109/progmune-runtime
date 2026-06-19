#!/usr/bin/env npx tsx
/**
 * P9.2b: Fetch 100 CVEs from NVD and build the independent benchmark.
 *
 * Usage:
 *   npx tsx scripts/fetch-cves.ts
 *   npx tsx scripts/fetch-cves.ts --output benchmarks/cve-100.json --limit 100
 *
 * Output: benchmarks/cve-100.json
 * Then run: npx vitest run src/cve-benchmark.test.ts
 */

import * as path from "path";
import * as fs from "fs";
import { fetchNVDCVEs, loadCuratedBenchmark, buildDataset, saveDataset } from "../src/cve-collector";

async function main() {
  const args = process.argv.slice(2);
  const outputPath = args.includes("--output")
    ? args[args.indexOf("--output") + 1]
    : path.resolve(__dirname, "..", "benchmarks", "cve-100.json");
  const limit = args.includes("--limit")
    ? parseInt(args[args.indexOf("--limit") + 1])
    : 100;

  console.log("╔════════════════════════════════════════════════════╗");
  console.log("║   P9.2b: Fetch 100 CVEs — Independent Benchmark    ║");
  console.log("╚════════════════════════════════════════════════════╝\n");

  // Start with the 20 curated cases as baseline
  const curated = loadCuratedBenchmark();
  console.log(`  Curated baseline: ${curated.length} cases`);

  // Fetch from NVD (network required)
  console.log(`\n  Fetching from NVD (limit: ${limit})...`);
  let nvdCases = [];
  try {
    nvdCases = await fetchNVDCVEs({ limit, minSeverity: "HIGH" });
    console.log(`  NVD fetched: ${nvdCases.length} cases`);
  } catch (err: any) {
    console.error(`  NVD fetch failed: ${err.message}`);
    console.log(`  Falling back to curated-only dataset.`);
  }

  // Combine: curated + NVD, ensuring unique IDs
  const seen = new Set(curated.map(c => c.id));
  const uniqueNvd = nvdCases.filter(c => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });

  // Take up to `limit` total cases, prioritizing lifecycle-relevant categories
  const lifecycle = [...curated, ...uniqueNvd].filter(
    c => ["resource_leak", "auth_bypass", "use_after_free", "race_condition", "data_corruption"].includes(c.category)
  );
  const nonLifecycle = [...curated, ...uniqueNvd].filter(
    c => !lifecycle.includes(c)
  );

  // Build final dataset: 70 lifecycle + 30 non-lifecycle (approx)
  const total = Math.min(limit, curated.length + uniqueNvd.length);
  const lifecycleTarget = Math.min(70, lifecycle.length);
  const nonLifecycleTarget = Math.min(30, nonLifecycle.length, total - lifecycleTarget);

  const finalCases = [
    ...lifecycle.slice(0, lifecycleTarget),
    ...nonLifecycle.slice(0, nonLifecycleTarget),
  ];

  const dataset = buildDataset(finalCases);
  saveDataset(dataset, outputPath);

  console.log(`\n  Next: npx vitest run src/cve-benchmark.test.ts`);
}

main().catch(console.error);
