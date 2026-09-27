"use strict";
/**
 * Framework Version-Aware Governance Rules
 *
 * Encodes the proxy.ts lesson (2026-08-03):
 *   AI follows the framework version the project actually depends on.
 *   Human reviewers follow the framework version in their training data.
 *   When these differ, the human reviewer is usually wrong.
 *
 * This module reads package.json to detect framework versions,
 * then applies version-specific conventions instead of training-data defaults.
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
exports.detectFrameworks = detectFrameworks;
exports.checkFrameworkConventions = checkFrameworkConventions;
exports.checkFileRename = checkFileRename;
exports.generateVersionAwarenessReport = generateVersionAwarenessReport;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// ── Framework Detection ──
function detectFrameworks(projectPath) {
    const pkgPath = path.join(projectPath, "package.json");
    if (!fs.existsSync(pkgPath))
        return [];
    const frameworks = [];
    try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        for (const [name, version] of Object.entries(deps)) {
            if (typeof version !== "string")
                continue;
            const cleanVersion = version.replace(/^[\^~]/, "");
            const majorVersion = parseInt(cleanVersion.split(".")[0], 10);
            if (isNaN(majorVersion))
                continue;
            frameworks.push({ name, version: cleanVersion, majorVersion });
        }
    }
    catch {
        // Can't parse package.json — skip
    }
    return frameworks;
}
/**
 * Known breaking changes that AI-generated code follows correctly
 * but human reviewers (with outdated training data) may "fix" incorrectly.
 */
const BREAKING_CHANGES = [
    {
        framework: "next",
        sinceVersion: 16,
        oldConvention: "middleware.ts",
        newConvention: "proxy.ts",
        description: "Next.js 16 deprecated `middleware.ts` in favor of `proxy.ts`. " +
            "AI code generators using Next.js 16 will produce `proxy.ts`. " +
            "Human reviewers with Next.js 12-15 training data will expect `middleware.ts`. " +
            "The AI is correct — do NOT rename `proxy.ts` to `middleware.ts`.",
        doNotRename: ["proxy.ts", "src/proxy.ts"],
        lesson: "Framework version conventions override training data. " +
            "When AGENTS.md warns 'This is NOT the Next.js you know', believe it. " +
            "Check node_modules/next/dist/docs/ before 'fixing' file names.",
    },
    // Placeholder for future discoveries
    // Add more entries as we encounter framework breaking changes
];
// ── Version-Aware Checks ──
function checkFrameworkConventions(projectPath) {
    const frameworks = detectFrameworks(projectPath);
    const checks = [];
    for (const change of BREAKING_CHANGES) {
        const fw = frameworks.find(f => f.name === change.framework);
        if (!fw)
            continue;
        const applies = fw.majorVersion >= change.sinceVersion;
        checks.push({
            framework: change.framework,
            versionRange: `>=${change.sinceVersion}.0.0`,
            appliesTo: applies,
            rule: `FW_${change.framework.toUpperCase()}_${change.oldConvention.replace(/\./g, "_").toUpperCase()}_DEPRECATED`,
            description: change.description,
            trainingDataDefault: change.oldConvention,
            actualConvention: change.newConvention,
            affectedFiles: change.doNotRename,
        });
    }
    return checks;
}
/**
 * Check if a specific file rename is going against framework conventions.
 * Returns the warning if the rename should be reverted.
 */
function checkFileRename(projectPath, fromFile, toFile) {
    const checks = checkFrameworkConventions(projectPath);
    for (const change of BREAKING_CHANGES) {
        const fw = detectFrameworks(projectPath).find(f => f.name === change.framework);
        if (!fw || fw.majorVersion < change.sinceVersion)
            continue;
        // Check if we're renaming FROM the new convention TO the old one
        const fromBase = path.basename(fromFile);
        const toBase = path.basename(toFile);
        if (change.doNotRename.includes(fromBase) && toBase === change.oldConvention) {
            return {
                warning: `⚠️  POTENTIAL GOVERNANCE ERROR: Renaming ${fromBase} → ${toBase}\n\n` +
                    `  Project uses ${change.framework} v${fw.version}\n` +
                    `  ${change.description}\n\n` +
                    `  Before renaming framework-generated files, verify the current\n` +
                    `  version's conventions in node_modules/${change.framework}/dist/docs/`,
                shouldRevert: true,
                lesson: change.lesson,
            };
        }
    }
    return null;
}
/**
 * Generate a report for CLI / governance output.
 */
function generateVersionAwarenessReport(projectPath) {
    const frameworks = detectFrameworks(projectPath);
    const checks = checkFrameworkConventions(projectPath);
    const activeChanges = checks.filter(c => c.appliesTo);
    const lines = [
        "═ Framework Version-Aware Governance ═",
        "",
        `Detected ${frameworks.length} framework(s):`,
        ...frameworks.map(f => `  - ${f.name} v${f.version}`),
        "",
    ];
    if (activeChanges.length === 0) {
        lines.push("No version-convention conflicts detected.");
    }
    else {
        lines.push(`⚠️  ${activeChanges.length} breaking change(s) apply to this project:`);
        lines.push("");
        for (const change of activeChanges) {
            lines.push(`  Rule: ${change.rule}`);
            lines.push(`  Training data (outdated): ${change.trainingDataDefault}`);
            lines.push(`  Actual convention:       ${change.actualConvention}`);
            lines.push(`  Affected files: ${change.affectedFiles.join(", ")}`);
            lines.push("");
        }
        lines.push("  LESSON: Do not rename framework-convention files based on");
        lines.push("  training data. Verify against the installed framework version.");
    }
    return lines.join("\n");
}
