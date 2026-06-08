/**
 * Phase 0: Extractor Compatibility Diagnostic
 *
 * Clones and extracts IR from 5 OSS TypeScript projects, recording:
 *   - tsconfig features (module, moduleResolution, references, extends, paths)
 *   - Extraction success/failure with function count and type map size
 *   - Per-project issues
 *
 * Usage:
 *   npx ts-node --transpile-only test_extractor_compat.ts
 *
 * Output: .test_report/extractor_compat_<timestamp>.json
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

// ============================================================================
// Configuration
// ============================================================================

interface ProjectConfig {
  name: string;
  repo: string;
  /** Subdirectory containing tsconfig.json (for monorepos) */
  tsconfigSubdir?: string;
}

const PROJECTS: ProjectConfig[] = [
  { name: "npm-check-updates", repo: "https://github.com/raineorshine/npm-check-updates.git" },
  { name: "zx", repo: "https://github.com/google/zx.git" },
  { name: "commander.js", repo: "https://github.com/tj/commander.js.git" },
  { name: "ts-pattern", repo: "https://github.com/gvergnaud/ts-pattern.git" },
  { name: "zod", repo: "https://github.com/colinhacks/zod.git" },
  { name: "changesets", repo: "https://github.com/changesets/changesets.git" },
];

const CACHE_DIR = path.resolve(__dirname, ".test_report", "oss_repos");
const REPORT_DIR = path.resolve(__dirname, ".test_report");

// ============================================================================
// Types
// ============================================================================

interface TsconfigInfo {
  exists: boolean;
  path: string;
  module?: string;
  moduleResolution?: string;
  target?: string;
  hasReferences: boolean;
  hasExtends: boolean;
  hasPaths: boolean;
  hasComposite: boolean;
  includeCount: number;
  excludeCount: number;
  /** Raw JSON for manual inspection */
  raw: unknown;
}

interface ExtractionResult {
  success: boolean;
  functionCount: number;
  typeMapCount: number;
  exportedCount: number;
  externalCount: number;
  /** Functions with non-any explicit types */
  typedCount: number;
  error?: string;
  durationMs: number;
}

interface DiagnosticResult {
  project: string;
  cloneSuccess: boolean;
  cloneError?: string;
  tsconfig: TsconfigInfo | null;
  extraction: ExtractionResult | null;
  sourceFileCount: number;
  issues: string[];
}

// ============================================================================
// Helpers
// ============================================================================

function log(msg: string): void {
  console.error(`  ${msg}`);
}

function title(msg: string): void {
  console.error(`\n━━━ ${msg} ━━━`);
}

function cloneOrPull(cfg: ProjectConfig): { dir: string; ok: boolean; error?: string } {
  const dir = path.join(CACHE_DIR, cfg.name);
  try {
    if (fs.existsSync(path.join(dir, ".git"))) {
      log(`git pull in ${cfg.name}...`);
      execSync("git fetch --depth=1 && git reset --hard origin/HEAD", { cwd: dir, stdio: "pipe", timeout: 30_000 });
    } else {
      fs.mkdirSync(dir, { recursive: true });
      log(`git clone ${cfg.name} (shallow)...`);
      execSync(`git clone --depth=1 ${cfg.repo} "${dir}"`, { stdio: "pipe", timeout: 120_000 });
    }
    return { dir, ok: true };
  } catch (e: any) {
    const errMsg = e.stderr?.toString() || e.message || String(e);
    return { dir, ok: false, error: errMsg.slice(0, 500) };
  }
}

function inspectTsconfig(projectDir: string, subdir?: string): TsconfigInfo | null {
  const searchDir = subdir ? path.join(projectDir, subdir) : projectDir;
  const tsconfigPath = path.join(searchDir, "tsconfig.json");

  if (!fs.existsSync(tsconfigPath)) {
    // Check parent dirs
    const parentPath = path.join(projectDir, "tsconfig.json");
    if (fs.existsSync(parentPath)) {
      return inspectTsconfigFile(parentPath);
    }
    return {
      exists: false,
      path: tsconfigPath,
      hasReferences: false,
      hasExtends: false,
      hasPaths: false,
      hasComposite: false,
      includeCount: 0,
      excludeCount: 0,
      raw: null,
    };
  }
  return inspectTsconfigFile(tsconfigPath);
}

function inspectTsconfigFile(filePath: string): TsconfigInfo {
  let raw: any = {};
  try {
    raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    raw = { _parseError: true };
  }

  const co = raw.compilerOptions || {};
  return {
    exists: true,
    path: filePath,
    module: co.module,
    moduleResolution: co.moduleResolution,
    target: co.target,
    hasReferences: Array.isArray(raw.references) && raw.references.length > 0,
    hasExtends: typeof raw.extends === "string",
    hasPaths: co.paths && Object.keys(co.paths).length > 0,
    hasComposite: co.composite === true,
    includeCount: Array.isArray(raw.include) ? raw.include.length : 0,
    excludeCount: Array.isArray(raw.exclude) ? raw.exclude.length : 0,
    raw: {
      compilerOptions: {
        module: co.module,
        moduleResolution: co.moduleResolution,
        target: co.target,
        composite: co.composite,
        hasPaths: !!co.paths,
        esModuleInterop: co.esModuleInterop,
      },
      extends: raw.extends,
      references: raw.references?.length ? `${raw.references.length} ref(s)` : undefined,
      include: raw.include,
    },
  };
}

async function runExtraction(projectDir: string, tsconfigInfo: TsconfigInfo): Promise<ExtractionResult> {
  const start = Date.now();

  // Determine root: use tsconfig dir if it exists and isn't the project root
  let root = projectDir;
  if (tsconfigInfo.exists) {
    root = path.dirname(tsconfigInfo.path);
  }

  try {
    // Import from source via ts-node (avoids ESM/CJS dist mismatch)
    const { extractIRWithTypes } = await import("./src/extract-ir");

    const result = extractIRWithTypes(root);
    const durationMs = Date.now() - start;

    const funcs = result.functions || [];
    const typedCount = funcs.filter(
      (f: any) => f.returnType && f.returnType !== "any"
    ).length;
    const externalCount = funcs.filter((f: any) => f.external).length;
    const internalFuncs = funcs.filter((f: any) => !f.external);
    const exportedCount = internalFuncs.filter((f: any) => f.exported).length;

    return {
      success: true,
      functionCount: internalFuncs.length,
      typeMapCount: Object.keys(result.typeMap || {}).length,
      exportedCount,
      externalCount,
      typedCount,
      durationMs,
    };
  } catch (e: any) {
    const durationMs = Date.now() - start;
    return {
      success: false,
      functionCount: 0,
      typeMapCount: 0,
      exportedCount: 0,
      externalCount: 0,
      typedCount: 0,
      error: String(e?.message || e).slice(0, 1000),
      durationMs,
    };
  }
}

function countSourceFiles(projectDir: string): number {
  try {
    const out = execSync(
      `find "${projectDir}" -name "*.ts" -not -path "*/node_modules/*" -not -path "*/.git/*" -not -name "*.d.ts" | wc -l`,
      { encoding: "utf-8", timeout: 10_000 }
    );
    return parseInt(out.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

function diagnoseTsconfigIssues(tc: TsconfigInfo): string[] {
  const issues: string[] = [];
  if (!tc.exists) {
    issues.push("NO_TSCONFIG: project has no tsconfig.json — extraction uses glob fallback");
  } else {
    const mod = (tc.module || "").toLowerCase();
    if (
      mod === "nodenext" ||
      mod === "node16" ||
      mod === "node18"
    ) {
      issues.push(
        `MODULE_NODENEXT: module=${tc.module} — extractor overrides to CommonJS; import resolution may be incomplete`
      );
    }
    if ((tc.moduleResolution || "").toLowerCase() === "nodenext" || (tc.moduleResolution || "").toLowerCase() === "node16") {
      issues.push(
        `RESOLUTION_NODENEXT: moduleResolution=${tc.moduleResolution} — overridden to Classic; .js extension imports won't resolve`
      );
    }
    if (tc.moduleResolution === "bundler") {
      issues.push(
        `RESOLUTION_BUNDLER: moduleResolution=bundler — overridden; path aliases and extensionless imports won't resolve`
      );
    }
    if (tc.hasReferences) {
      issues.push(
        "PROJECT_REFERENCES: tsconfig has `references` — monorepo/project-refs not supported; only root tsconfig analyzed"
      );
    }
    if (tc.hasExtends) {
      issues.push(
        "TSCONFIG_EXTENDS: tsconfig extends another config — inheritance chain not resolved; options may be incomplete"
      );
    }
    if (tc.hasPaths) {
      issues.push(
        "PATH_ALIASES: tsconfig has `paths` — path aliases overridden; import resolution will fail for aliased modules"
      );
    }
    if (tc.hasComposite) {
      issues.push(
        "COMPOSITE: tsconfig has composite=true — often paired with project references; partial extraction likely"
      );
    }
  }
  return issues;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.error("╔══════════════════════════════════════════════════╗");
  console.error("║  Phase 0: Extractor Compatibility Diagnostic    ║");
  console.error("║  5 OSS projects · tsconfig diversity check      ║");
  console.error("╚══════════════════════════════════════════════════╝");

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const results: DiagnosticResult[] = [];

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.mkdirSync(REPORT_DIR, { recursive: true });

  for (let i = 0; i < PROJECTS.length; i++) {
    const proj = PROJECTS[i];
    title(`[${i + 1}/${PROJECTS.length}] ${proj.name}`);

    const result: DiagnosticResult = {
      project: proj.name,
      cloneSuccess: false,
      tsconfig: null,
      extraction: null,
      sourceFileCount: 0,
      issues: [],
    };

    // ── Clone ──
    log("Cloning...");
    const clone = cloneOrPull(proj);
    result.cloneSuccess = clone.ok;
    if (!clone.ok) {
      result.cloneError = clone.error;
      result.issues.push(`CLONE_FAILED: ${clone.error}`);
      results.push(result);
      console.error(`  ❌ Clone failed: ${clone.error?.slice(0, 200)}`);
      continue;
    }

    // ── Count source files ──
    result.sourceFileCount = countSourceFiles(clone.dir);
    log(`${result.sourceFileCount} .ts source files found`);

    // ── Inspect tsconfig ──
    const tsconfigInfo = inspectTsconfig(clone.dir, proj.tsconfigSubdir);
    result.tsconfig = tsconfigInfo;
    if (tsconfigInfo.exists) {
      log(
        `tsconfig: module=${tsconfigInfo.module || "default"}, ` +
        `moduleResolution=${tsconfigInfo.moduleResolution || "default"}, ` +
        `target=${tsconfigInfo.target || "default"}`
      );
      if (tsconfigInfo.hasReferences) log("  ⚠️  has `references` (monorepo)");
      if (tsconfigInfo.hasExtends) log("  ⚠️  extends another config");
      if (tsconfigInfo.hasPaths) log("  ⚠️  has path aliases");
      if (tsconfigInfo.hasComposite) log("  ⚠️  composite=true");
    } else {
      log("⚠️  No tsconfig.json found");
    }

    // ── Check tsconfig issues ──
    result.issues.push(...diagnoseTsconfigIssues(tsconfigInfo));

    // ── Extract IR ──
    log("Extracting IR...");
    result.extraction = await runExtraction(clone.dir, tsconfigInfo);

    if (result.extraction.success) {
      const ext = result.extraction;
      const coverage = result.sourceFileCount > 0
        ? `(${((ext.functionCount / result.sourceFileCount)).toFixed(1)} fn/file)`
        : "";
      log(
        `✅ ${ext.functionCount} internal functions ` +
        `(${ext.exportedCount} exported), ` +
        `${ext.typeMapCount} types, ` +
        `${ext.typedCount} typed returns, ` +
        `${ext.externalCount} external, ` +
        `${ext.durationMs}ms ${coverage}`
      );
      if (ext.functionCount === 0) {
        result.issues.push("ZERO_FUNCTIONS: extraction reported 0 internal functions");
        console.error("  ⚠️  0 functions extracted — check output");
      }
    } else {
      result.issues.push(`EXTRACTION_FAILED: ${result.extraction.error}`);
      console.error(`  ❌ Extraction failed: ${result.extraction.error}`);
    }

    results.push(result);
  }

  // ── Summary ──
  title("SUMMARY");
  const passCount = results.filter(
    (r) => r.extraction?.success && r.extraction.functionCount > 0
  ).length;
  const failCount = results.length - results.filter((r) => r.cloneSuccess).length;
  const extractFailCount = results.filter(
    (r) => r.cloneSuccess && !r.extraction?.success
  ).length;
  const zeroFuncCount = results.filter(
    (r) => r.extraction?.success && r.extraction.functionCount === 0
  ).length;

  const table = results.map((r) => {
    const status = !r.cloneSuccess
      ? "❌ CLONE"
      : !r.extraction?.success
        ? "❌ EXTRACT"
        : r.extraction.functionCount === 0
          ? "⚠️  0 fn"
          : `✅ ${r.extraction.functionCount} fn`;
    const tsconfig = r.tsconfig?.exists
      ? `${r.tsconfig.module || "?"}/${r.tsconfig.moduleResolution || "?"}`
      : "NO TSCONFIG";
    return {
      Project: r.project.padEnd(22),
      Status: status,
      "tsconfig": tsconfig,
      ".ts files": String(r.sourceFileCount),
      Issues: r.issues.length > 0 ? r.issues[0].slice(0, 60) : "",
    };
  });

  console.error("\n┌──────────────────────────┬──────────────┬──────────────────┬───────────┬──────────────────────────────────────────────┐");
  console.error("│ Project                  │ Status       │ tsconfig         │ .ts files │ Top Issue                                    │");
  console.error("├──────────────────────────┼──────────────┼──────────────────┼───────────┼──────────────────────────────────────────────┤");
  for (const row of table) {
    console.error(
      `│ ${row.Project.padEnd(24)} │ ${row.Status.padEnd(12)} │ ${row.tsconfig.padEnd(16)} │ ${row[".ts files"].padEnd(9)} │ ${row.Issues.padEnd(44)} │`
    );
  }
  console.error("└──────────────────────────┴──────────────┴──────────────────┴───────────┴──────────────────────────────────────────────┘");

  // ── Issue histogram ──
  const issueCounts: Record<string, number> = {};
  for (const r of results) {
    for (const issue of r.issues) {
      const key = issue.split(":")[0];
      issueCounts[key] = (issueCounts[key] || 0) + 1;
    }
  }
  if (Object.keys(issueCounts).length > 0) {
    console.error("\n📊 Issue distribution:");
    for (const [key, count] of Object.entries(issueCounts).sort((a, b) => b[1] - a[1])) {
      console.error(`  ${key}: ${count}/${PROJECTS.length} projects`);
    }
  }

  console.error(`\n🏁 Pass: ${passCount}/${PROJECTS.length} | Clone fail: ${failCount} | Extract fail: ${extractFailCount} | Zero fn: ${zeroFuncCount}`);

  // ── Write report ──
  const report = {
    timestamp,
    summary: { total: PROJECTS.length, pass: passCount, cloneFail: failCount, extractFail: extractFailCount, zeroFunc: zeroFuncCount },
    issueDistribution: issueCounts,
    results,
  };
  const reportPath = path.join(REPORT_DIR, `extractor_compat_${timestamp}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.error(`\n📄 Full report: ${reportPath}`);

  // Also write latest symlink
  const latestPath = path.join(REPORT_DIR, "extractor_compat_latest.json");
  fs.writeFileSync(latestPath, JSON.stringify(report, null, 2));
  console.error(`📄 Latest:      ${latestPath}`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
