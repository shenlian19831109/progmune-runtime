/**
 * C Protocol Coverage Dashboard v2
 * Supports: Regex Saturated status, Capability Map, Mechanism classification.
 * Usage: npm run coverage
 */

import * as fs from "fs";
import * as path from "path";

const TAXONOMY_PATH = path.join(__dirname, "c-categories.json");
const C = { r: "\x1b[0m", b: "\x1b[1m", d: "\x1b[2m", g: "\x1b[32m", r2: "\x1b[31m", y: "\x1b[33m", c: "\x1b[36m", m: "\x1b[35m" };

const taxonomy = JSON.parse(fs.readFileSync(TAXONOMY_PATH, "utf-8"));
const agg = taxonomy.aggregate;

console.log(`${C.b}${C.c}╔══════════════════════════════════════════════════════════════════════════╗${C.r}`);
console.log(`${C.b}${C.c}║${C.r}   ${C.b}C Protocol Coverage Dashboard v2${C.r}                                   ${C.b}${C.c}║${C.r}`);
console.log(`${C.b}${C.c}║${C.r}   ${C.d}Benchmark: Gold v1 (curl + libssh) — ${taxonomy.totalFN} total FN${C.r}                    ${C.b}${C.c}║${C.r}`);
console.log(`${C.b}${C.c}╚══════════════════════════════════════════════════════════════════════════╝${C.r}\n`);

// Aggregate bar
const s = agg.regex_saturated || 0;
const bar = (n: number) => "█".repeat(Math.round(n / taxonomy.totalFN * 40));
console.log(`${C.b}  Overall${C.r}`);
console.log(`  ${C.g}${bar(agg.recovered)}${C.m}${bar(s)}${C.y}${bar(agg.gold_mismatch)}${C.d}${bar((agg.deferred_ir||0)+(agg.context_limited||0))}${C.r2}${"░".repeat(Math.round(agg.remaining_actionable / taxonomy.totalFN * 40))}${C.r}`);
console.log(`  ${C.g}Recovered ${agg.recovered}${C.r}  ${C.m}Saturated ${s}${C.r}  ${C.y}Mismatch ${agg.gold_mismatch}${C.r}  ${C.d}Other ${(agg.deferred_ir||0)+(agg.context_limited||0)}${C.r}  ${C.r2}Remaining ${agg.remaining_actionable}${C.r}`);
console.log(`  Regex-Friendly: ${agg.regex_friendly_coverage_pct || 0}% | Effective: ${agg.effective_coverage_pct}%\n`);

// Capability Map
const cm = taxonomy.capability_map;
if (cm) {
  console.log(`${C.b}── Capability Map ──${C.r}\n`);
  console.log(`  ${C.g}≡ Regex-Friendly${C.r}  (${cm.regex_friendly.covered_fn} FN, ${cm.regex_friendly.recovered_fn} recovered)`);
  console.log(`     ${cm.regex_friendly.definition}`);
  console.log(`     ${cm.regex_friendly.categories.join(", ")}`);
  console.log("");
  console.log(`  ${C.r2}≢ Regex-Hostile${C.r}  (${cm.regex_hostile.covered_fn} FN, ${cm.regex_hostile.recovered_fn} recovered)`);
  console.log(`     ${cm.regex_hostile.definition}`);
  console.log(`     ${cm.regex_hostile.categories.join(", ")}`);
  if (cm.regex_hostile.note) console.log(`     ${C.d}${cm.regex_hostile.note}${C.r}`);
  console.log("");
}

// Category breakdown
console.log(`${C.b}── Categories ──${C.r}\n`);

const ICONS: Record<string, string> = {
  recovered: `${C.g}✓${C.r}`, gold_mismatch: `${C.y}~${C.r}`, context_limited: `${C.m}△${C.r}`,
  regex_saturated: `${C.m}⬡${C.r}`, deferred: `${C.d}→${C.r}`, pending: `${C.r2}✗${C.r}`,
};
const STATUS_ICON: Record<string, string> = {
  graduated: `${C.g}●${C.r}`, partial: `${C.y}◐${C.r}`, regex_saturated: `${C.m}◆${C.r}`, deferred: `${C.d}○${C.r}`, pending: `${C.r2}○${C.r}`,
};

for (const cat of taxonomy.categories) {
  const mech = cat.mechanism || "";
  const mechIcon = mech === "regex_friendly" ? `${C.g}≡${C.r}` : mech === "regex_hostile" ? `${C.r2}≢${C.r}` : "";
  const si = STATUS_ICON[cat.status] || `${C.r2}○${C.r}`;
  const barW = 20;
  const cov = cat.coverage.effective_coverage_pct / 100;
  const covered = Math.round(cov * barW);

  console.log(`  ${si} ${mechIcon} ${C.b}${cat.name}${C.r}  ${C.d}${cat.status}${C.r}${cat.experiment ? ` (Exp-${cat.experiment})` : ""}`);
  console.log(`     ${cat.description}`);
  if (cat.diagnosis) console.log(`     ${C.m}→ ${cat.diagnosis}${C.r}`);
  console.log(`     ${C.g}${"█".repeat(covered)}${C.r2}${"░".repeat(barW - covered)}${C.r} ${cat.coverage.effective_coverage_pct}% (${cat.coverage.recovered}/${cat.coverage.total})`);

  for (const fn of cat.fns) {
    const fi = ICONS[fn.status] || `${C.r2}✗${C.r}`;
    const note = fn.note ? ` ${C.d}— ${fn.note}${C.r}` : "";
    console.log(`       ${fi} [${fn.idx}] ${fn.function} (${fn.repo})${note}`);
  }
  console.log("");
}

// Priority Queue (regex-friendly only)
console.log(`${C.b}── Priority Queue (Regex-Friendly) ──${C.r}\n`);

const queue = taxonomy.categories
  .filter((c: any) => c.status !== "deferred" && c.status !== "regex_saturated" && c.status !== "graduated")
  .map((c: any) => ({ name: c.name, mechanism: c.mechanism || "", remaining: c.coverage.remaining, total: c.coverage.total, status: c.status }))
  .sort((a: any, b: any) => b.remaining - a.remaining);

console.log(`  ${C.b}Category                          Remaining  Mechanism${C.r}`);
console.log(`  ${C.d}─────────────────────────────────────────────────────${C.r}`);
for (const q of queue) {
  const b = "█".repeat(Math.min(q.remaining, 15));
  const ml = q.mechanism === "regex_friendly" ? `${C.g}≡ friendly${C.r}` : `${C.r2}≢ hostile${C.r}`;
  console.log(`  ${q.name.padEnd(33)} ${C.r2}${b.padEnd(15)}${C.r} ${q.remaining}/${q.total}  ${ml}`);
}

// Next experiment
const nextExp = taxonomy.categories.filter((c: any) =>
  (c.status === "pending" || c.status === "partial") && c.mechanism === "regex_friendly" && c.coverage.remaining > 0
);
if (nextExp.length > 0) {
  console.log(`\n${C.b}── Next Experiment ──${C.r}\n`);
  const n = nextExp[0];
  console.log(`  ${C.b}Exp-020: ${n.name}${C.r}  ${C.g}(regex-friendly)${C.r}`);
  console.log(`     Target: ${n.coverage.remaining} FN | ≥30% recovery, 0 FP`);
  console.log(`     FNs: ${n.fns.filter((f: any) => f.status === "pending").map((f: any) => f.function).join(", ")}`);
}

// Markdown export
const md = ["# C Protocol Coverage Dashboard v2", "",
  `**Benchmark:** Gold v1 (curl + libssh) — ${taxonomy.totalFN} total FN`, "",
  "## Overall", "",
  `| Status | Count |`, `|--------|-------|`,
  `| ✅ Recovered | ${agg.recovered} |`, `| ⬡ Regex Saturated | ${s} |`,
  `| ~ Gold Mismatch | ${agg.gold_mismatch} |`, `| ❌ Remaining | ${agg.remaining_actionable} |`,
  `| **Regex-Friendly Coverage** | **${agg.regex_friendly_coverage_pct || 0}%** |`, "",
  "## Capability Map", "",
  "| Mechanism | Categories | FN | Recovered |",
  "|-----------|------------|----|-----------|",
  `| ≡ Regex-Friendly | ${cm.regex_friendly.categories.join(", ")} | ${cm.regex_friendly.covered_fn} | ${cm.regex_friendly.recovered_fn} |`,
  `| ≢ Regex-Hostile | ${cm.regex_hostile.categories.join(", ")} | ${cm.regex_hostile.covered_fn} | ${cm.regex_hostile.recovered_fn} |`,
  "", "## Categories", "",
  "| Mechanism | Status | Category | Coverage |",
  "|-----------|--------|----------|----------|",
  ...taxonomy.categories.map((c: any) =>
    `| ${c.mechanism === "regex_friendly" ? "≡" : "≢"} | ${c.status} | ${c.name} | ${c.coverage.effective_coverage_pct}% (${c.coverage.recovered}/${c.coverage.total}) |`
  ),
];
const mdPath = path.join(__dirname, "..", "reports", "coverage-dashboard.md");
fs.mkdirSync(path.dirname(mdPath), { recursive: true });
fs.writeFileSync(mdPath, md.join("\n"));
console.log(`\n  ${C.d}Markdown: ${mdPath}${C.r}\n`);
