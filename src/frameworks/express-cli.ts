#!/usr/bin/env npx ts-node
/**
 * Express Framework Adapter CLI
 *
 * Usage:
 *   npm run express <path>              Analyze an Express project
 *   npm run express <path> -- --json    JSON output
 *   npm run express <path> -- --help    Show help
 *
 * Examples:
 *   npm run express src/server.ts
 *   npm run express .
 *   npm run express ~/my-express-app
 */

import * as fs from "fs";
import * as path from "path";
import {
  analyzeExpressFile,
  analyzeExpressProject,
  formatExpressReport,
} from "./express-detector";
import type { ExpressSecurityIssue } from "./express-detector";

const args = process.argv.slice(2);

// ── Help ──

if (args.includes("--help") || args.includes("-h") || args.length === 0) {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║        Progmune Express Framework Adapter               ║
║        Protocol Detection for Express.js                 ║
╚══════════════════════════════════════════════════════════╝

Usage:
  npm run express <path> [options]

Arguments:
  <path>           File or directory to analyze
                   (auto-detects Express .ts/.js files)

Options:
  --json           Output as JSON
  --summary        Show summary only (no per-file details)
  --help, -h       Show this help

Examples:
  npm run express src/server.ts
  npm run express .
  npm run express ~/my-express-app -- --json
  npm run express . -- --summary
`);
  process.exit(0);
}

// ── Parse options ──

const jsonOutput = args.includes("--json");
const summaryOnly = args.includes("--summary");
const targetPath = args.filter(a => !a.startsWith("--"))[0];

if (!targetPath) {
  console.error("Error: path required. Use --help for usage.");
  process.exit(1);
}

const resolvedPath = path.resolve(targetPath);

// ── Helpers ──

function findTsFiles(dir: string): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fp = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
      files.push(...findTsFiles(fp));
    } else if (/\.(ts|js|mjs)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
      files.push(fp);
    }
  }
  return files;
}

// ── Main ──

async function main() {
  if (!fs.existsSync(resolvedPath)) {
    console.error(`Error: path not found: ${resolvedPath}`);
    process.exit(1);
  }

  const stat = fs.statSync(resolvedPath);
  const isDirectory = stat.isDirectory();

  let result: {
    files: number;
    expressApps: number;
    totalRoutes: number;
    issues: ExpressSecurityIssue[];
    fileResults?: Array<{ file: string; analysis: ReturnType<typeof analyzeExpressFile> }>;
  };

  if (isDirectory) {
    const tsFiles = findTsFiles(resolvedPath);
    const fileResults: Array<{ file: string; analysis: ReturnType<typeof analyzeExpressFile> }> = [];

    for (const fp of tsFiles) {
      const analysis = analyzeExpressFile(fp);
      if (analysis && analysis.hasExpress) {
        fileResults.push({ file: fp, analysis });
      }
    }

    result = {
      files: tsFiles.length,
      expressApps: fileResults.length,
      totalRoutes: fileResults.reduce((sum, r) => sum + r.analysis!.routes.length, 0),
      issues: fileResults.flatMap(r =>
        r.analysis!.issues.map(i => ({ ...i, route: i.route ? `[${path.basename(r.file)}] ${i.route}` : `[${path.basename(r.file)}]` }))
      ),
      fileResults,
    };
  } else {
    const analysis = analyzeExpressFile(resolvedPath);
    if (!analysis || !analysis.hasExpress) {
      console.log(`\n${path.basename(resolvedPath)}: Not an Express app (no express import found).\n`);
      process.exit(0);
    }
    result = {
      files: 1,
      expressApps: 1,
      totalRoutes: analysis.routes.length,
      issues: analysis.issues,
      fileResults: [{ file: resolvedPath, analysis }],
    };
  }

  // ── JSON output ──

  if (jsonOutput) {
    const output = {
      target: resolvedPath,
      scannedFiles: result.files,
      expressApps: result.expressApps,
      totalRoutes: result.totalRoutes,
      totalIssues: result.issues.length,
      bySeverity: {
        critical: result.issues.filter(i => i.severity === "critical").length,
        high: result.issues.filter(i => i.severity === "high").length,
        medium: result.issues.filter(i => i.severity === "medium").length,
        low: result.issues.filter(i => i.severity === "low").length,
      },
      decision: result.issues.some(i => i.severity === "critical") ? "BLOCKED"
        : result.issues.some(i => i.severity === "high") ? "NEEDS_REVIEW"
        : "APPROVED",
      issues: result.issues.map(i => ({
        severity: i.severity,
        rule: i.rule,
        message: i.message,
        route: i.route ?? null,
        line: i.line,
        fix: i.fix,
      })),
    };
    console.log(JSON.stringify(output, null, 2));
    process.exit(result.issues.some(i => i.severity === "critical") ? 1 : 0);
  }

  // ── Terminal output ──

  console.log("\n╔══════════════════════════════════════════════════════════╗");
  console.log("║   Progmune Express Framework Adapter                   ║");
  console.log("╚══════════════════════════════════════════════════════════╝\n");

  console.log(`  Target:  ${resolvedPath}`);
  console.log(`  Files:   ${result.files} scanned`);
  console.log(`  Apps:    ${result.expressApps} Express app(s) found`);

  if (result.expressApps === 0) {
    console.log("\n  No Express apps found in this directory.\n");
    process.exit(0);
  }

  console.log(`  Routes:  ${result.totalRoutes}`);
  console.log(`  Issues:  ${result.issues.length}\n`);

  // Severity summary bar
  const crit = result.issues.filter(i => i.severity === "critical").length;
  const high = result.issues.filter(i => i.severity === "high").length;
  const med = result.issues.filter(i => i.severity === "medium").length;
  const low = result.issues.filter(i => i.severity === "low").length;

  const bar = [
    crit > 0 ? `🔴 ${crit} critical` : "",
    high > 0 ? `🟠 ${high} high` : "",
    med > 0 ? `🟡 ${med} medium` : "",
    low > 0 ? `🔵 ${low} low` : "",
  ].filter(Boolean).join("  ");

  if (bar) {
    console.log(`  ${bar}\n`);
  }

  // Decision
  const decision = crit > 0 ? "❌ BLOCKED" : high > 0 ? "⚠️  NEEDS_REVIEW" : "✅ APPROVED";
  console.log(`  Decision: ${decision}\n`);

  // Per-file details
  if (!summaryOnly && result.fileResults && result.fileResults.length > 0) {
    for (const { file, analysis } of result.fileResults) {
      if (!analysis) continue;
      console.log(`── ${path.basename(file)} ──`);
      console.log(formatExpressReport(analysis));
      console.log("");
    }
  }

  // Summary table
  console.log("── Issues ──");
  if (result.issues.length === 0) {
    console.log("  ✅ No Express security issues detected.\n");
  } else {
    for (const issue of result.issues) {
      const emoji = issue.severity === "critical" ? "🔴" : issue.severity === "high" ? "🟠" : issue.severity === "medium" ? "🟡" : "🔵";
      console.log(`  ${emoji} [${issue.rule}]`);
      console.log(`     ${issue.message}`);
      if (issue.route) console.log(`     Route: ${issue.route} (line ${issue.line})`);
      console.log(`     Fix: ${issue.fix}`);
      console.log("");
    }
  }

  // ── Exit code for CI ──
  process.exit(crit > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Fatal:", err.message);
  process.exit(2);
});
