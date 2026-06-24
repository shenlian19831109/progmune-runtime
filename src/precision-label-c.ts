/**
 * Precision Labeling Tool for C/C++ projects
 *
 * Reads pre-extracted sequences JSON and saves labels.
 * For TypeScript projects, use precision-label.ts instead.
 *
 * Usage:
 *   npx ts-node src/precision-label-c.ts benchmarks/curl
 */

import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m",
};

async function main() {
  const args = process.argv.slice(2);
  const repoPath = path.resolve(args.find(a => !a.startsWith("--")) || ".");
  const maxSeq = parseInt(args.includes("--max") ? args[args.indexOf("--max") + 1] : "50", 10);
  const resume = args.includes("--resume");

  const seqFile = path.join(path.dirname(repoPath), `${path.basename(repoPath)}-sequences.json`);
  const labelFile = path.join(path.dirname(repoPath), `${path.basename(repoPath)}-labels.json`);

  if (!fs.existsSync(seqFile)) {
    console.error(`❌ Sequences file not found: ${seqFile}`);
    console.error(`   Run C extraction first to generate this file.`);
    process.exit(1);
  }

  // Load sequences
  const allSeqs = JSON.parse(fs.readFileSync(seqFile, "utf-8"));
  const sequences = allSeqs.slice(0, maxSeq);

  // Load existing labels (resume)
  let data: any = { repo: repoPath, labeledAt: "", total: 0, labels: {}, sequences: {} };
  if (fs.existsSync(labelFile) && resume) {
    data = JSON.parse(fs.readFileSync(labelFile, "utf-8"));
  } else if (fs.existsSync(labelFile)) {
    data = JSON.parse(fs.readFileSync(labelFile, "utf-8"));
  }

  const alreadyLabeled = Object.keys(data.labels).length;

  console.error(`\n${C.bold}${C.cyan}Precision Labeling — C/C++ Projects${C.reset}`);
  console.error(`  Sequences: ${sequences.length} (${alreadyLabeled} already labeled)`);
  console.error(`  Commands: ${C.green}c${C.reset}=clean  ${C.red}v${C.reset}=violation  ${C.yellow}s${C.reset}=skip  q=quit\n`);
  console.error(`  ${C.dim}clean    = protocol looks complete (init→use→cleanup present)${C.reset}`);
  console.error(`  ${C.dim}violation = protocol incomplete (missing init/cleanup, wrong order)${C.reset}`);
  console.error(``);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise(resolve => rl.question(q, resolve));

  let labeled = 0;
  let skipped = 0;

  for (let i = 0; i < sequences.length; i++) {
    if (data.labels[i] !== undefined) continue;

    const seq = sequences[i];
    const calls = seq.calls.slice(0, 8);
    const more = seq.calls.length > 8 ? ` … (+${seq.calls.length - 8} more)` : "";

    console.error(`${C.bold}[${i + 1}/${sequences.length}]${C.reset} ${C.dim}${seq.file || ""}${C.reset}`);
    console.error(`  ${C.cyan}${seq.function}${C.reset}`);
    console.error(`  → ${calls.join(" → ")}${more}`);

    const answer = await ask(`  ${C.green}[c]lean${C.reset} ${C.red}[v]iolation${C.reset} ${C.yellow}[s]kip${C.reset} [q]uit: `);

    switch (answer) {
      case "q":
        console.error(`\n  Quit. Saving ${labeled} new labels...`);
        rl.close();
        saveLabels(labelFile, data, labeled + alreadyLabeled);
        return;
      case "s":
        skipped++;
        console.error(`  ${C.yellow}↻ skipped${C.reset}\n`);
        continue;
      case "c":
        data.labels[i] = "clean";
        data.sequences[i] = seq.calls;
        labeled++;
        console.error(`  ${C.green}✓ clean${C.reset}\n`);
        break;
      case "v":
        data.labels[i] = "violation";
        data.sequences[i] = seq.calls;
        labeled++;
        console.error(`  ${C.red}✗ violation${C.reset}\n`);
        break;
      default:
        console.error(`  ${C.yellow}? unknown — use c/v/s/q${C.reset}\n`);
        break;
    }
  }

  rl.close();
  saveLabels(labelFile, data, labeled + alreadyLabeled);
  console.error(`\n  Clean: ${Object.values(data.labels).filter((l: any) => l === "clean").length}`);
  console.error(`  Violation: ${Object.values(data.labels).filter((l: any) => l === "violation").length}`);
  console.error(`\n  Next: npx ts-node src/precision-report-c.ts ${repoPath}\n`);
}

function saveLabels(filePath: string, data: any, total: number) {
  data.labeledAt = new Date().toISOString();
  data.total = total;
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

main().catch(e => { console.error(e); process.exit(1); });
