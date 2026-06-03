"use strict";
/**
 * Phase 4.5: Progmune Audit — 扫描代码库中的 @progmune-generated 标记，统计覆盖率
 *
 * Usage:
 *   npx ts-node src/audit.ts <directory>
 *   npx ts-node src/audit.ts src/
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
exports.auditDirectory = auditDirectory;
exports.formatAuditResult = formatAuditResult;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/** Scan a directory recursively for TypeScript files and check for @progmune-generated markers. */
const DEFAULT_THRESHOLD = 0.8;
/** Audit a directory for @progmune-generated markers and report coverage. */
/** @requires DIRECTORY @produces AUDIT_RESULT */
function auditDirectory(dir, threshold = DEFAULT_THRESHOLD) {
    const result = {
        directory: dir,
        totalFiles: 0,
        progmuneFiles: 0,
        coverage: 0,
        threshold,
        warning: null,
        nonProgmuneFiles: [],
        sessions: [],
    };
    if (!fs.existsSync(dir)) {
        return result;
    }
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) {
        return result;
    }
    scanDir(dir, dir, result);
    result.coverage = result.totalFiles > 0
        ? result.progmuneFiles / result.totalFiles
        : 0;
    if (result.coverage < result.threshold && result.totalFiles > 0) {
        const pct = (result.coverage * 100).toFixed(0);
        const target = (result.threshold * 100).toFixed(0);
        result.warning = `Coverage ${pct}% below ${target}% threshold. ${result.nonProgmuneFiles.length} file(s) are not @progmune-generated.`;
    }
    // Sort sessions by timestamp (most recent first)
    result.sessions.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
    if (result.sessions.length > 0) {
        result.lastGeneration = result.sessions[0].timestamp;
    }
    return result;
}
const MARKER_REGEX = /@progmune-generated\s+session=(\S+)(?:\s+timestamp=(\S+))?(?:\s+ruleHash=(\S+))?/;
const EXCLUDED_DIRS = new Set(["node_modules", ".git", "dist", ".progmune_corpus", ".progmune_memory"]);
function scanDir(rootDir, currentDir, result) {
    let entries;
    try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
    }
    catch {
        return;
    }
    for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
            if (!EXCLUDED_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
                scanDir(rootDir, fullPath, result);
            }
            continue;
        }
        // Only check TypeScript source files
        if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx") && !entry.name.endsWith(".mjs")) {
            continue;
        }
        result.totalFiles++;
        try {
            const content = fs.readFileSync(fullPath, "utf-8");
            // Only check first 5 lines for the marker (performance)
            const head = content.split("\n").slice(0, 5).join("\n");
            const match = head.match(MARKER_REGEX);
            if (match) {
                result.progmuneFiles++;
                result.sessions.push({
                    sessionId: match[1],
                    file: path.relative(rootDir, fullPath),
                    timestamp: match[2],
                    ruleHash: match[3],
                });
            }
            else {
                result.nonProgmuneFiles.push(path.relative(rootDir, fullPath));
            }
        }
        catch {
            // Skip unreadable files
        }
    }
}
/** Format audit result as human-readable text. */
/** Format audit result as human-readable text with coverage statistics. */
/** @requires AUDIT_RESULT @produces FORMATTED_REPORT */
function formatAuditResult(result) {
    const pct = (result.coverage * 100).toFixed(1);
    const lines = [];
    lines.push(`Progmune Audit: ${result.directory}`);
    lines.push("═".repeat(56));
    lines.push(`  Total source files:   ${result.totalFiles}`);
    lines.push(`  @progmune-generated:  ${result.progmuneFiles}  (${pct}%)`);
    lines.push(`  Threshold:            ${(result.threshold * 100).toFixed(0)}%`);
    if (result.warning) {
        lines.push(`  ⚠️  ${result.warning}`);
    }
    lines.push(`  Not covered:          ${result.nonProgmuneFiles.length}`);
    lines.push("");
    // Phase 7: Execution metrics
    try {
        const { getExecutionMetrics } = require("./execute");
        const m = getExecutionMetrics();
        if (m.generated > 0) {
            const repairRate = m.repaired > 0 ? ` | Repaired: ${m.repaired}` : "";
            lines.push(`  Executions: ${m.generated} total${repairRate}`);
            if (m.lastGeneration) {
                lines.push(`  Last: ${m.lastGeneration}`);
            }
            if (m.history.length >= 2) {
                const recent = m.history.slice(-5);
                lines.push(`  Recent: ${recent.map((r) => r.repaired ? '🔧' : '✅').join(' ')}`);
            }
            lines.push("");
        }
    }
    catch { /* audit step — best-effort */ }
    // Phase 7: Violation Analytics
    try {
        const repairDir = ".progmune_corpus/repairs";
        if (fs.existsSync(repairDir)) {
            const repairs = fs.readdirSync(repairDir).filter((f) => f.endsWith(".json"));
            if (repairs.length > 0) {
                const bySvl = {};
                const byConstraint = {};
                for (const f of repairs) {
                    try {
                        const r = JSON.parse(fs.readFileSync(`${repairDir}/${f}`, "utf-8"));
                        bySvl[r.violation] = (bySvl[r.violation] || 0) + 1;
                        byConstraint[r.constraint] = (byConstraint[r.constraint] || 0) + 1;
                    }
                    catch { /* audit step — best-effort */ }
                }
                lines.push(`  Repairs recorded: ${repairs.length}`);
                const svlSummary = Object.entries(bySvl).map(([k, v]) => `${k}: ${v}`).join(" | ");
                lines.push(`  By SVL: ${svlSummary}`);
                if (Object.keys(byConstraint).length > 1) {
                    const cSummary = Object.entries(byConstraint).map(([k, v]) => `${k}: ${v}`).join(" | ");
                    lines.push(`  By constraint: ${cSummary}`);
                }
                lines.push("");
            }
        }
    }
    catch { /* audit step — best-effort */ }
    if (result.sessions.length > 0) {
        lines.push(`  Last generation: ${result.lastGeneration || "unknown"}`);
        lines.push(`  Unique sessions:  ${new Set(result.sessions.map(s => s.sessionId)).size}`);
        lines.push("");
        lines.push("  Generated files:");
        for (const s of result.sessions.slice(0, 10)) {
            lines.push(`    ${s.file}`);
        }
        if (result.sessions.length > 10) {
            lines.push(`    ... and ${result.sessions.length - 10} more`);
        }
        lines.push("");
    }
    if (result.nonProgmuneFiles.length > 0) {
        lines.push(`  Files without Progmune marker (${result.nonProgmuneFiles.length}):`);
        for (const f of result.nonProgmuneFiles.slice(0, 20)) {
            lines.push(`    ${f}`);
        }
        if (result.nonProgmuneFiles.length > 20) {
            lines.push(`    ... and ${result.nonProgmuneFiles.length - 20} more`);
        }
    }
    return lines.join("\n");
}
// CLI entry
if (require.main === module) {
    const dir = process.argv[2] || "src";
    const result = auditDirectory(dir);
    console.log(formatAuditResult(result));
}
