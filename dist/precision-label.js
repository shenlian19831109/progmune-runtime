"use strict";
/**
 * Precision Labeling Tool
 *
 * Interactive CLI for hand-labeling call sequences as "clean" or "violation".
 * This is the human-in-the-loop step that makes precision measurement possible.
 *
 * Usage:
 *   npx ts-node src/precision-label.ts <repoPath>
 *   npx ts-node src/precision-label.ts . --max 50
 *
 * Output: .progmune_labels.json in the repo root
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const readline = __importStar(require("readline"));
const extract_ir_1 = require("./extract-ir");
function loadLabels(repoPath) {
    const labelPath = path.join(repoPath, ".progmune_labels.json");
    if (fs.existsSync(labelPath)) {
        return JSON.parse(fs.readFileSync(labelPath, "utf-8"));
    }
    return { repo: repoPath, labeledAt: "", total: 0, labels: {}, sequences: {} };
}
function saveLabels(repoPath, data) {
    data.labeledAt = new Date().toISOString();
    data.total = Object.keys(data.labels).length;
    const labelPath = path.join(repoPath, ".progmune_labels.json");
    fs.writeFileSync(labelPath, JSON.stringify(data, null, 2), "utf-8");
}
function extractSequences(repoPath) {
    const ir = (0, extract_ir_1.extractIR)(repoPath);
    const seqs = [];
    // Strategy 1: Functions with protocol annotations
    for (const fn of ir) {
        if (fn.protocol) {
            const calls = [];
            if (fn.protocol.pre_states)
                calls.push(...fn.protocol.pre_states);
            calls.push(fn.name);
            if (fn.protocol.post_states)
                calls.push(...fn.protocol.post_states);
            if (calls.length >= 2) {
                seqs.push({ index: seqs.length, calls, source: `protocol:${fn.name}` });
            }
        }
    }
    // Strategy 2: Group functions by file, extract call pairs
    if (seqs.length < 20) {
        const byFile = {};
        for (const fn of ir) {
            const file = fn.file || "unknown";
            if (!byFile[file])
                byFile[file] = [];
            byFile[file].push(fn.name);
        }
        for (const [file, fns] of Object.entries(byFile)) {
            if (fns.length >= 2) {
                seqs.push({ index: seqs.length, calls: fns.slice(0, 8), source: `file:${path.basename(file)}` });
            }
        }
    }
    // Strategy 3: Extract call adjacency pairs from function bodies
    if (seqs.length < 20) {
        for (const fn of ir) {
            if (fn.calls && fn.calls.length >= 2) {
                const relevantCalls = fn.calls.filter((c) => ir.some((f) => f.name === c));
                if (relevantCalls.length >= 2) {
                    seqs.push({
                        index: seqs.length,
                        calls: relevantCalls.slice(0, 8),
                        source: `calls:${fn.name}`,
                    });
                }
            }
        }
    }
    return seqs;
}
// ═══════════════════════════════════════════════════════════════
// Interactive CLI
// ═══════════════════════════════════════════════════════════════
const C = {
    reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
    green: "\x1b[32m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m",
};
async function main() {
    const args = process.argv.slice(2);
    const repoPath = path.resolve(args.find(a => !a.startsWith("--")) || ".");
    const maxSeq = parseInt(args.includes("--max") ? args[args.indexOf("--max") + 1] : "50", 10);
    if (!fs.existsSync(repoPath)) {
        console.error(`❌ Path not found: ${repoPath}`);
        process.exit(1);
    }
    console.error(`\n${C.bold}${C.cyan}Precision Labeling Tool${C.reset}`);
    console.error(`  Repo: ${repoPath}`);
    console.error(`  Extracting sequences...`);
    // 1. Extract sequences
    const sequences = extractSequences(repoPath).slice(0, maxSeq);
    if (sequences.length === 0) {
        console.error(`  ❌ No call sequences found. Add protocol annotations (@protocol) or function calls with 2+ steps.`);
        process.exit(1);
    }
    console.error(`  Found: ${sequences.length} sequences to label`);
    console.error(`  Commands: ${C.green}c${C.reset}=clean  ${C.red}v${C.reset}=violation  ${C.yellow}s${C.reset}=skip  q=quit\n`);
    // 2. Load existing labels
    const data = loadLabels(repoPath);
    const alreadyLabeled = Object.keys(data.labels).length;
    if (alreadyLabeled > 0) {
        console.error(`  ${C.yellow}Resuming: ${alreadyLabeled} already labeled${C.reset}\n`);
    }
    // 3. Interactive labeling loop
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q) => new Promise(resolve => rl.question(q, resolve));
    let labeled = 0;
    let skipped = 0;
    for (const seq of sequences) {
        // Skip already labeled
        if (data.labels[seq.index] !== undefined)
            continue;
        // Show sequence
        console.error(`${C.bold}[${seq.index + 1}/${sequences.length}]${C.reset} ${C.dim}${seq.source}${C.reset}`);
        console.error(`  ${seq.calls.map((c, i) => `${i > 0 ? "→ " : ""}${C.cyan}${c}${C.reset}`).join(" ")}`);
        const answer = await ask(`  ${C.green}[c]lean${C.reset} ${C.red}[v]iolation${C.reset} ${C.yellow}[s]kip${C.reset} [q]uit: `);
        if (answer === "q") {
            console.error(`\n  Quit. Saving ${labeled} new labels...`);
            break;
        }
        if (answer === "s") {
            skipped++;
            console.error(`  ${C.yellow}↻ skipped${C.reset}\n`);
            continue;
        }
        if (answer === "c") {
            data.labels[seq.index] = "clean";
            data.sequences[seq.index] = seq.calls;
            labeled++;
            console.error(`  ${C.green}✓ clean${C.reset}\n`);
        }
        else if (answer === "v") {
            data.labels[seq.index] = "violation";
            data.sequences[seq.index] = seq.calls;
            labeled++;
            console.error(`  ${C.red}✗ violation${C.reset}\n`);
        }
        else {
            console.error(`  ${C.yellow}? unknown — use c/v/s/q${C.reset}\n`);
        }
    }
    rl.close();
    // 4. Save
    saveLabels(repoPath, data);
    console.error(`\n${C.bold}Saved:${C.reset} ${labeled} new + ${alreadyLabeled} existing labels → ${path.join(repoPath, ".progmune_labels.json")}`);
    console.error(`  Clean:     ${Object.values(data.labels).filter(l => l === "clean").length}`);
    console.error(`  Violation: ${Object.values(data.labels).filter(l => l === "violation").length}`);
    console.error(`  Skipped:   ${skipped}`);
    console.error(`\n  Next: npx ts-node src/precision-report.ts ${repoPath}\n`);
}
main().catch(e => { console.error(e); process.exit(1); });
