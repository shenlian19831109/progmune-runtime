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

import * as fs from "fs";
import * as path from "path";

// ── Types ──

export interface FrameworkInfo {
  name: string;
  version: string;
  majorVersion: number;
}

export interface ConventionCheck {
  framework: string;
  versionRange: string;
  appliesTo: boolean;
  rule: string;
  description: string;
  /** What old training data would suggest (probably wrong) */
  trainingDataDefault: string;
  /** What the actual framework version requires (probably right) */
  actualConvention: string;
  /** Files/patterns affected */
  affectedFiles: string[];
}

// ── Framework Detection ──

export function detectFrameworks(projectPath: string): FrameworkInfo[] {
  const pkgPath = path.join(projectPath, "package.json");
  if (!fs.existsSync(pkgPath)) return [];

  const frameworks: FrameworkInfo[] = [];
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    for (const [name, version] of Object.entries(deps)) {
      if (typeof version !== "string") continue;
      const cleanVersion = version.replace(/^[\^~]/, "");
      const majorVersion = parseInt(cleanVersion.split(".")[0], 10);
      if (isNaN(majorVersion)) continue;

      frameworks.push({ name, version: cleanVersion, majorVersion });
    }
  } catch {
    // Can't parse package.json — skip
  }

  return frameworks;
}

// ── Known Breaking Changes (training data vs. reality) ──

interface BreakingChange {
  framework: string;
  sinceVersion: number;
  oldConvention: string;
  newConvention: string;
  description: string;
  /** Files that should NOT be renamed back to old convention */
  doNotRename: string[];
  lesson: string;
}

/**
 * Known breaking changes that AI-generated code follows correctly
 * but human reviewers (with outdated training data) may "fix" incorrectly.
 */
const BREAKING_CHANGES: BreakingChange[] = [
  {
    framework: "next",
    sinceVersion: 16,
    oldConvention: "middleware.ts",
    newConvention: "proxy.ts",
    description:
      "Next.js 16 deprecated `middleware.ts` in favor of `proxy.ts`. " +
      "AI code generators using Next.js 16 will produce `proxy.ts`. " +
      "Human reviewers with Next.js 12-15 training data will expect `middleware.ts`. " +
      "The AI is correct — do NOT rename `proxy.ts` to `middleware.ts`.",
    doNotRename: ["proxy.ts", "src/proxy.ts"],
    lesson:
      "Framework version conventions override training data. " +
      "When AGENTS.md warns 'This is NOT the Next.js you know', believe it. " +
      "Check node_modules/next/dist/docs/ before 'fixing' file names.",
  },
  // Placeholder for future discoveries
  // Add more entries as we encounter framework breaking changes
];

// ── Version-Aware Checks ──

export function checkFrameworkConventions(projectPath: string): ConventionCheck[] {
  const frameworks = detectFrameworks(projectPath);
  const checks: ConventionCheck[] = [];

  for (const change of BREAKING_CHANGES) {
    const fw = frameworks.find(f => f.name === change.framework);
    if (!fw) continue;

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
export function checkFileRename(
  projectPath: string,
  fromFile: string,
  toFile: string
): { warning: string; shouldRevert: boolean; lesson: string } | null {
  const checks = checkFrameworkConventions(projectPath);

  for (const change of BREAKING_CHANGES) {
    const fw = detectFrameworks(projectPath).find(f => f.name === change.framework);
    if (!fw || fw.majorVersion < change.sinceVersion) continue;

    // Check if we're renaming FROM the new convention TO the old one
    const fromBase = path.basename(fromFile);
    const toBase = path.basename(toFile);

    if (change.doNotRename.includes(fromBase) && toBase === change.oldConvention) {
      return {
        warning:
          `⚠️  POTENTIAL GOVERNANCE ERROR: Renaming ${fromBase} → ${toBase}\n\n` +
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
export function generateVersionAwarenessReport(projectPath: string): string {
  const frameworks = detectFrameworks(projectPath);
  const checks = checkFrameworkConventions(projectPath);
  const activeChanges = checks.filter(c => c.appliesTo);

  const lines: string[] = [
    "═ Framework Version-Aware Governance ═",
    "",
    `Detected ${frameworks.length} framework(s):`,
    ...frameworks.map(f => `  - ${f.name} v${f.version}`),
    "",
  ];

  if (activeChanges.length === 0) {
    lines.push("No version-convention conflicts detected.");
  } else {
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
