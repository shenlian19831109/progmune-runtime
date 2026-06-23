#!/usr/bin/env npx ts-node --transpile-only
/**
 * Progmune CI Entry Point — GitHub Action core script
 *
 * Orchestrates the full AI governance pipeline in CI:
 *   1. Find changed TypeScript files
 *   2. For each file with @progmune-generated marker:
 *      certify → accountability → policy check
 *   3. Aggregate results across all files
 *   4. Output verdict: ALLOW / WARN / BLOCK
 *
 * Usage:
 *   npx ts-node bin/progmune-ci.ts --project . --output result.json
 *   npx ts-node bin/progmune-ci.ts --project . --author alice@example.com --files "a.ts b.ts"
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// ── CLI Args ──

interface CIConfig {
  projectPath: string;
  strict: boolean;
  author?: string;
  reviewer?: string;
  files?: string[];
  output?: string;
}

function parseArgs(): CIConfig {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
  };

  const filesStr = get("--files");
  return {
    projectPath: get("--project") || ".",
    strict: args.includes("--strict") || get("--strict") === "true",
    author: get("--author"),
    reviewer: get("--reviewer"),
    files: filesStr ? filesStr.split(/\s+/) : undefined,
    output: get("--output"),
  };
}

// ── Types ──

interface FileResult {
  file: string;
  certified: boolean;
  verdict: "ALLOW" | "WARN" | "BLOCK" | "NONE";
  passedRules: number;
  totalRules: number;
  violations: Array<{
    severity: string;
    type: string;
    actual: string;
    expected: string;
    detail?: string;
  }>;
  confidence: string;
  error?: string;
}

interface CIIResult {
  timestamp: string;
  verdict: "ALLOW" | "WARN" | "BLOCK";
  summary: string;
  totalFiles: number;
  aiGeneratedFiles: number;
  passedFiles: number;
  warnedFiles: number;
  blockedFiles: number;
  passed_rules: number;
  failed_rules: number;
  rules: number;
  files: FileResult[];
  violations: FileResult["violations"];
}

// ── Main ──

async function main() {
  const config = parseArgs();

  // 1. Find files to check
  let files: string[];
  if (config.files && config.files.length > 0) {
    files = config.files.map(f => path.resolve(config.projectPath, f));
  } else {
    files = findChangedFiles(config.projectPath);
  }

  if (files.length === 0) {
    const result: CIIResult = {
      timestamp: new Date().toISOString(),
      verdict: "ALLOW",
      summary: "No TypeScript files to check.",
      totalFiles: 0, aiGeneratedFiles: 0, passedFiles: 0, warnedFiles: 0, blockedFiles: 0,
      passed_rules: 0, failed_rules: 0, rules: 0,
      files: [], violations: [],
    };
    outputResult(result, config);
    process.exit(0);
  }

  // 2. Check each file
  const fileResults: FileResult[] = [];
  for (const file of files) {
    const result = checkFile(file, config);
    fileResults.push(result);
  }

  // 3. Aggregate
  const aiFiles = fileResults.filter(f => f.certified);
  const blocked = fileResults.filter(f => f.verdict === "BLOCK").length;
  const warned = fileResults.filter(f => f.verdict === "WARN").length;
  const passed = fileResults.filter(f => f.verdict === "ALLOW").length;

  const allViolations = fileResults.flatMap(f => f.violations);
  const hasBlockViolations = allViolations.some(v => v.severity === "block");
  const hasWarnViolations = allViolations.some(v => v.severity === "warn");

  let verdict: CIIResult["verdict"];
  if (hasBlockViolations) {
    verdict = "BLOCK";
  } else if (hasWarnViolations && config.strict) {
    verdict = "BLOCK"; // strict mode: warn also blocks
  } else if (hasWarnViolations) {
    verdict = "WARN";
  } else {
    verdict = "ALLOW";
  }

  let summary: string;
  if (verdict === "ALLOW") {
    summary = `✅ All ${aiFiles.length} AI-generated file(s) passed governance policies.`;
  } else if (verdict === "WARN") {
    summary = `⚠️  ${warned} file(s) have warnings — review before merge. ${passed} passed.`;
  } else {
    summary = `❌ ${blocked} file(s) blocked — must resolve violations before merge. ${passed} passed, ${warned} warned.`;
  }

  const result: CIIResult = {
    timestamp: new Date().toISOString(),
    verdict,
    summary,
    totalFiles: files.length,
    aiGeneratedFiles: aiFiles.length,
    passedFiles: passed,
    warnedFiles: warned,
    blockedFiles: blocked,
    passed_rules: fileResults.reduce((s, f) => s + f.passedRules, 0),
    failed_rules: allViolations.length,
    rules: fileResults.reduce((s, f) => s + f.totalRules, 0),
    files: fileResults,
    violations: allViolations,
  };

  outputResult(result, config);

  // Print summary to stdout for GitHub Actions log
  const emoji = verdict === "ALLOW" ? "✅" : verdict === "WARN" ? "⚠️" : "❌";
  console.log(`\n${emoji} Progmune Policy Check: ${verdict}`);
  console.log(`   ${aiFiles.length} AI-generated files checked`);
  console.log(`   ${passed} passed, ${warned} warned, ${blocked} blocked`);
  console.log(`   ${summary}\n`);

  process.exit(verdict === "BLOCK" ? 1 : 0);
}

// ── File Check ──

function checkFile(filePath: string, config: CIConfig): FileResult {
  const base: FileResult = {
    file: filePath,
    certified: false,
    verdict: "NONE",
    passedRules: 0,
    totalRules: 0,
    violations: [],
    confidence: "low",
  };

  // Check if file exists
  if (!fs.existsSync(filePath)) {
    return { ...base, error: "File not found" };
  }

  // Check for @progmune-generated marker
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const head = content.split("\n").slice(0, 5).join("\n");
    if (!head.includes("@progmune-generated")) {
      return base; // Not AI-generated — skip
    }
  } catch (e: any) {
    return { ...base, error: `Read error: ${e.message}` };
  }

  // File is AI-generated — run certify + policy
  try {
    const { certify } = require("../src/certify");
    const { evaluatePolicy } = require("../src/policy/engine");

    const cert = certify(filePath);

    // Build minimal accountability
    let accountability;
    try {
      const { buildAccountabilityChain } = require("../src/ledger/accountability");
      const opts: any = {};
      if (config.author) opts.author = { id: config.author, name: config.author.split("@")[0], role: "developer" };
      if (config.reviewer) opts.reviewers = [{ id: config.reviewer, name: config.reviewer.split("@")[0], role: "reviewer" }];
      accountability = buildAccountabilityChain(cert.sessionId, opts);
    } catch { /* no accountability data */ }

    const policyCtx = {
      certificate: {
        validated: cert.validated,
        confidence: cert.confidence,
        provenanceIntact: cert.provenanceIntact,
        fingerprint: cert.fingerprint,
        violations: cert.violations,
        plsbCoverage: cert.plsbCoverage,
        plsbRecall: cert.plsbRecall,
        degraded: cert.degraded,
        sessionId: cert.sessionId,
        file: cert.file,
      },
      accountability: accountability ? {
        humanEvents: accountability.humanEvents,
        aiEvents: accountability.aiEvents,
        automatedEvents: accountability.automatedEvents,
        custodyGap: accountability.custodyGap,
      } : undefined,
    };

    const policyResult = evaluatePolicy(policyCtx);

    return {
      file: filePath,
      certified: true,
      verdict: policyResult.verdict,
      passedRules: policyResult.passed_rules,
      totalRules: policyResult.rules,
      violations: policyResult.violations.map(v => ({
        severity: v.rule.severity,
        type: v.rule.type,
        actual: v.actual,
        expected: v.expected,
        detail: v.detail,
      })),
      confidence: cert.confidence,
    };
  } catch (e: any) {
    return {
      ...base,
      certified: true, // File IS marked, just failed validation
      verdict: "BLOCK",
      error: `Policy check failed: ${e.message}`,
      violations: [{
        severity: "block",
        type: "policy_error",
        actual: "error",
        expected: "policy check passed",
        detail: e.message,
      }],
    };
  }
}

// ── File Discovery ──

function findChangedFiles(projectPath: string): string[] {
  const abs = path.resolve(projectPath);

  // In CI, files come from git diff. Locally, use a default.
  try {
    const { execSync } = require("child_process");
    const diff = execSync(
      "git diff --name-only HEAD~1 HEAD 2>/dev/null || git diff --name-only --cached 2>/dev/null || echo ''",
      { cwd: abs, encoding: "utf-8", timeout: 5000 }
    ).trim();
    if (diff) {
      return diff.split("\n")
        .filter((f: string) => f.match(/\.(ts|tsx)$/))
        .map((f: string) => path.resolve(abs, f))
        .filter((f: string) => fs.existsSync(f));
    }
  } catch { /* not a git repo or no history */ }

  // Fallback: check recently modified .ts files
  const results: string[] = [];
  try {
    const walkDir = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walkDir(full); }
        else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
          results.push(full);
        }
      }
    };
    walkDir(abs);
  } catch { /* skip */ }

  return results;
}

// ── Output ──

function outputResult(result: CIIResult, config: CIConfig): void {
  const json = JSON.stringify(result, null, 2);
  if (config.output) {
    const outPath = path.resolve(config.output);
    const dir = path.dirname(outPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(outPath, json, "utf-8");
  }
}

main();
