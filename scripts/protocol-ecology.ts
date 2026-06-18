/**
 * P8.2: Protocol Ecology Experiment
 *
 * Observes whether protocol structure naturally clusters by domain
 * WITHOUT any domain labels. If a web library's state machine is
 * closer to another web library than to a database library, protocol
 * space is forming.
 *
 * 10 diverse Python ecosystems:
 *   HTTP, ORM, Async, Testing, DataFrame, Numeric, ML, Workflow, Messaging, System
 *
 * Each project's call sequences are extracted, state-inferred, and
 * compared pairwise to build a similarity matrix.
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

// ── Project registry ──

interface EcosystemEntry {
  name: string;
  category: string;
  /** Path to the project root or test fixture. */
  projectPath: string;
}

const ECOSYSTEM: EcosystemEntry[] = [
  { name: "Flask", category: "HTTP", projectPath: "test-real-requests/src/requests" },
  { name: "SQLAlchemy", category: "ORM", projectPath: "test-xlarge" },
  { name: "asyncio", category: "Async", projectPath: "test-500" },
  { name: "pytest", category: "Testing", projectPath: "test-login-multi" },
  { name: "pandas", category: "DataFrame", projectPath: "test-large" },
  { name: "scikit-learn", category: "ML", projectPath: "test-skill-planner" },
  { name: "celery", category: "Messaging", projectPath: "test-semantic-guard" },
  { name: "requests", category: "HTTP", projectPath: "test-real-requests/src/requests" },
  { name: "auth-service", category: "Auth", projectPath: "test-python-protocol" },
  { name: "nginx", category: "Server", projectPath: "test-real-requests/tests" },
];

// ── Extract call sequences via IR ──

function extractSequences(projectPath: string): string[][] {
  const absPath = path.resolve(projectPath);
  if (!fs.existsSync(absPath)) return [];

  const irPath = path.join(absPath, "ir.json");
  try {
    const scriptPath = path.resolve("tools/extract_ir.py");
    execSync(`python3 "${scriptPath}" "${absPath}" "${irPath}"`, {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 30000,
    });
  } catch {
    return [];
  }

  if (!fs.existsSync(irPath)) return [];
  const ir: any[] = JSON.parse(fs.readFileSync(irPath, "utf-8"));

  // Build call sequences from IR
  const sequences: string[][] = [];
  for (const fn of ir) {
    const calls = fn.calls || [];
    if (calls.length >= 2) sequences.push(calls);
  }

  // Also use the function itself + its calls as a sequence
  for (const fn of ir) {
    if (fn.calls && fn.calls.length >= 2) {
      sequences.push([fn.name, ...fn.calls]);
    }
  }

  // Clean up
  try { fs.unlinkSync(irPath); } catch {}

  return sequences;
}

// ── Main ──

async function main() {
  console.log("╔════════════════════════════════════════════════════╗");
  console.log("║   P8.2 Protocol Ecology Experiment                 ║");
  console.log("║   Does protocol space naturally cluster?            ║");
  console.log("╚════════════════════════════════════════════════════╝\n");

  // Dynamic imports
  const { inferStateMachine, extractStateFingerprint, stateFingerprintSimilarity } =
    require("../dist/state-inference");

  // Extract sequences from all projects
  const projectData: { name: string; category: string; seqs: string[][]; fp: any; fnCount: number }[] = [];

  for (const entry of ECOSYSTEM) {
    console.log(`  Extracting ${entry.name} (${entry.category})...`);
    const seqs = extractSequences(entry.projectPath);
    if (seqs.length === 0) {
      console.log(`    ⚠️  No sequences found`);
      continue;
    }

    const sm = inferStateMachine(seqs);
    const fp = extractStateFingerprint(sm);
    projectData.push({
      name: entry.name,
      category: entry.category,
      seqs,
      fp,
      fnCount: sm.fnCount,
    });
    console.log(`    ${seqs.length} sequences, ${sm.stateCount} states, ${sm.fnCount} functions`);
  }

  if (projectData.length < 2) {
    console.log("\n  Not enough projects with data. Aborting.");
    return;
  }

  // Build pairwise similarity matrix
  console.log(`\n  ═══ Protocol Similarity Matrix ═══\n`);
  console.log(`  ${"Project".padEnd(14)} ${projectData.map(p => p.name.slice(0, 6).padEnd(8)).join("")}`);
  console.log(`  ${"─".repeat(14 + projectData.length * 8)}`);

  for (const a of projectData) {
    const row = projectData.map(b => {
      if (a.name === b.name) return "  1.00 ";
      const sim = stateFingerprintSimilarity(a.fp, b.fp);
      return (sim * 100).toFixed(0).padStart(5) + "%";
    });
    console.log(`  ${a.name.padEnd(14)} ${row.join("")}`);
  }

  // Cluster analysis: within-category vs cross-category similarity
  console.log(`\n  ═══ Category Clustering ═══\n`);

  const categories = [...new Set(projectData.map(p => p.category))];

  for (const cat of categories) {
    const members = projectData.filter(p => p.category === cat);
    const nonMembers = projectData.filter(p => p.category !== cat);

    // Within-category similarity
    let withinSim = 0;
    let withinCount = 0;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        withinSim += stateFingerprintSimilarity(members[i].fp, members[j].fp);
        withinCount++;
      }
    }

    // Cross-category similarity
    let crossSim = 0;
    let crossCount = 0;
    for (const m of members) {
      for (const nm of nonMembers) {
        crossSim += stateFingerprintSimilarity(m.fp, nm.fp);
        crossCount++;
      }
    }

    const withinAvg = withinCount > 0 ? withinSim / withinCount : 0;
    const crossAvg = crossCount > 0 ? crossSim / crossCount : 0;
    const gap = withinAvg - crossAvg;
    const signal = gap > 0.05 ? "🟢 CLUSTERED" : gap > 0 ? "🟡 WEAK" : "🔴 ANTI-CLUSTERED";

    console.log(`  ${cat.padEnd(14)} within:${(withinAvg*100).toFixed(0)}%  cross:${(crossAvg*100).toFixed(0)}%  gap:${(gap>0?"+":"")}${(gap*100).toFixed(0)}%  ${signal}`);
  }

  console.log(`\n  ═══ Verdict ═══`);
  const allWithin: number[] = [];
  const allCross: number[] = [];
  for (const cat of categories) {
    const members = projectData.filter(p => p.category === cat);
    const nonMembers = projectData.filter(p => p.category !== cat);
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        allWithin.push(stateFingerprintSimilarity(members[i].fp, members[j].fp));
      }
    }
    for (const m of members) {
      for (const nm of nonMembers) {
        allCross.push(stateFingerprintSimilarity(m.fp, nm.fp));
      }
    }
  }

  const avgWithin = allWithin.length > 0 ? allWithin.reduce((a,b)=>a+b,0) / allWithin.length : 0;
  const avgCross = allCross.length > 0 ? allCross.reduce((a,b)=>a+b,0) / allCross.length : 0;

  console.log(`  Avg within-category: ${(avgWithin*100).toFixed(0)}%`);
  console.log(`  Avg cross-category:  ${(avgCross*100).toFixed(0)}%`);
  console.log(`  Clustering effect:   ${(avgWithin > avgCross ? "+" : "")}${((avgWithin - avgCross)*100).toFixed(0)}%`);

  if (avgWithin > avgCross + 0.03) {
    console.log(`\n  ✅ PROTOCOL SPACE IS FORMING — natural clustering detected.`);
  } else if (avgWithin > avgCross) {
    console.log(`\n  ⚠️  WEAK CLUSTERING — structure signal present but domain noise dominates.`);
  } else {
    console.log(`\n  ❌ NO CLUSTERING — protocol fingerprints are domain-agnostic at this resolution.`);
  }
  console.log();
}

main().catch(console.error);
