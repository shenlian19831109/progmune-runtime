"use strict";
/**
 * P5.6: Repository Scale Evaluation
 *
 * Runs protocol extraction + benchmark evaluation against real repositories.
 * Bridges the gap from "49 synthetic benchmarks" to "real-world validation."
 *
 * Key metrics:
 *   - Defect Detection Rate: how many real protocol violations are caught?
 *   - False Positive Rate: how many false alarms?
 *   - Coverage Gain: new states/transitions beyond hand-written baseline
 *   - Extraction Precision/Recall vs ground truth
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
exports.scanRepository = scanRepository;
exports.compareRules = compareRules;
exports.detectDefects = detectDefects;
exports.evaluateRepository = evaluateRepository;
exports.printRepoEvalReport = printRepoEvalReport;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const protocol_extractor_1 = require("./protocol-extractor");
const benchmark_harness_1 = require("./benchmark-harness");
const protocol_coverage_1 = require("./protocol-coverage");
// ═══════════════════════════════════════════════════════════════
// Repository Scanner
// ═══════════════════════════════════════════════════════════════
const SUPPORTED_EXTENSIONS = [".c", ".cpp", ".js", ".ts", ".py", ".go", ".rs", ".java"];
/** Recursively find all source files in a directory. */
function scanRepository(repoPath, maxFiles = 500) {
    const files = [];
    function walk(dir) {
        if (files.length >= maxFiles)
            return;
        try {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
                    walk(path.join(dir, entry.name));
                }
                else if (entry.isFile()) {
                    const ext = path.extname(entry.name);
                    if (SUPPORTED_EXTENSIONS.includes(ext)) {
                        files.push(path.join(dir, entry.name));
                        if (files.length >= maxFiles)
                            return;
                    }
                }
            }
        }
        catch { /* permission denied etc. */ }
    }
    walk(repoPath);
    return files;
}
/**
 * Compare extracted rules against ground truth (hand-written protocol rules).
 */
function compareRules(extracted, groundTruth) {
    const extractedFns = new Set(extracted.map(r => r.function));
    const groundFns = new Set([...groundTruth.keys()]);
    const matched = [];
    const novel = [];
    const missed = [];
    for (const fn of extractedFns) {
        if (groundFns.has(fn)) {
            matched.push(fn);
        }
        else {
            novel.push(fn);
        }
    }
    for (const fn of groundFns) {
        if (!extractedFns.has(fn)) {
            missed.push(fn);
        }
    }
    const precision = extractedFns.size > 0 ? matched.length / extractedFns.size : 0;
    const recall = groundFns.size > 0 ? matched.length / groundFns.size : 0;
    const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;
    return {
        totalGroundTruth: groundFns.size,
        totalExtracted: extractedFns.size,
        matchedRules: matched,
        novelRules: novel,
        missedRules: missed,
        precision,
        recall,
        f1,
    };
}
/**
 * Scan a repository for protocol violations using extracted rules.
 *
 * For each file, extract call pairs. For each pair fnA→fnB where
 * fnB has pre_states that fnA's post_states don't satisfy,
 * flag as a potential violation.
 */
function detectDefects(repoPath, rules, maxFiles = 100) {
    const files = scanRepository(repoPath, maxFiles);
    const violations = [];
    let totalPairs = 0;
    for (const fp of files) {
        try {
            const code = fs.readFileSync(fp, "utf-8");
            const pairs = (0, protocol_extractor_1.extractCallPairs)(code, fp);
            totalPairs += pairs.length;
            // Check each consecutive pair for protocol violations
            for (let i = 0; i < pairs.length - 1; i++) {
                const a = pairs[i];
                const b = pairs[i + 1];
                const ruleA = rules.get(a.from);
                const ruleB = rules.get(b.to);
                if (!ruleA || !ruleB)
                    continue;
                // Check: do A's post_states satisfy B's pre_states?
                const postA = new Set(ruleA.post_states);
                const preB = ruleB.pre_states;
                const missing = preB.filter(s => !postA.has(s));
                if (missing.length > 0) {
                    violations.push({
                        file: fp,
                        line: a.line || b.line,
                        missing: missing.join(", "),
                        detail: `${a.from} → ${b.to}: needs [${preB.join(",")}] but only has [${ruleA.post_states.join(",") || "none"}]`,
                    });
                }
            }
        }
        catch { /* skip unreadable files */ }
    }
    return {
        filesScanned: files.length,
        callPairs: totalPairs,
        violationsFound: violations.length,
        violations,
    };
}
/**
 * Full repository-scale evaluation.
 *
 * 1. Scan repository → extract protocol rules
 * 2. Compare extracted vs ground truth
 * 3. Detect protocol violations using both rule sets
 * 4. Run benchmark suite against extracted rules
 */
async function evaluateRepository(repoPath, repoName = path.basename(repoPath), maxFiles = 100) {
    // 1. Extract rules
    const files = scanRepository(repoPath, maxFiles);
    const extraction = (0, protocol_extractor_1.extractProtocolFromFiles)(files.slice(0, maxFiles), repoName, 2 // min frequency
    );
    // 2. Compare against ground truth
    const defs = (0, protocol_coverage_1.loadDefaultProtocolDefinitions)();
    const groundTruth = new Map();
    for (const p of defs)
        for (const [fn, rule] of p.rules)
            groundTruth.set(fn, rule);
    const comparison = compareRules(extraction.rules, groundTruth);
    // 3. Detect defects
    const extractedMap = (0, protocol_extractor_1.rulesToAnnotationMap)(extraction.rules.slice(0, 30));
    const defects = detectDefects(repoPath, extractedMap, maxFiles);
    // 4. Run benchmark
    let benchmark;
    try {
        benchmark = await (0, benchmark_harness_1.runBenchmark)();
    }
    catch { /* no benchmarks */ }
    return {
        repo: repoName,
        filesScanned: files.length,
        extraction,
        comparison,
        defects,
        benchmark,
    };
}
function printRepoEvalReport(report) {
    console.log("\n╔════════════════════════════════════════════════════╗");
    console.log("║   P5.6 Repository Scale Evaluation                 ║");
    console.log("╚════════════════════════════════════════════════════╝\n");
    console.log(`Repository:     ${report.repo}`);
    console.log(`Files Scanned:  ${report.filesScanned}`);
    console.log(`Call Pairs:     ${report.extraction.totalPairs}`);
    console.log(`Rules Extracted: ${report.extraction.rules.length}`);
    console.log(`Avg Confidence: ${(report.extraction.confidence * 100).toFixed(0)}%`);
    console.log();
    console.log("─── Rule Comparison (Extracted vs Ground Truth) ───");
    console.log(`  Ground Truth:   ${report.comparison.totalGroundTruth}`);
    console.log(`  Extracted:      ${report.comparison.totalExtracted}`);
    console.log(`  Matched:        ${report.comparison.matchedRules.length}`);
    console.log(`  Novel (FP):     ${report.comparison.novelRules.length}`);
    console.log(`  Missed (FN):    ${report.comparison.missedRules.length}`);
    console.log(`  Precision:      ${(report.comparison.precision * 100).toFixed(0)}%`);
    console.log(`  Recall:         ${(report.comparison.recall * 100).toFixed(0)}%`);
    console.log(`  F1:             ${(report.comparison.f1 * 100).toFixed(0)}%`);
    console.log();
    if (report.comparison.novelRules.length > 0) {
        console.log(`  Novel rules (potential new protocol knowledge):`);
        for (const fn of report.comparison.novelRules.slice(0, 10)) {
            console.log(`    + ${fn}`);
        }
        console.log();
    }
    console.log("─── Defect Detection ───");
    console.log(`  Violations Found: ${report.defects.violationsFound}`);
    if (report.defects.violations.length > 0) {
        console.log(`  Top violations:`);
        for (const v of report.defects.violations.slice(0, 5)) {
            console.log(`    ${v.file}: ${v.detail}`);
        }
    }
    console.log();
    if (report.benchmark) {
        console.log("─── Benchmark Baseline ───");
        console.log(`  Top-1: ${(report.benchmark.top1Rate * 100).toFixed(0)}%  Top-3: ${(report.benchmark.top3Rate * 100).toFixed(0)}%`);
        console.log();
    }
}
