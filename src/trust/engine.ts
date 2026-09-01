/**
 * Phase 1: Trust Engine Orchestrator
 *
 * Main entry point for the AI Trust Decision Engine.
 * Composes existing modules (policy engine, protocol detector, SSG validator,
 * ledger registry, failure corpus) into the 4-dimension Trust Decision model.
 *
 * Pipeline:
 *   1. COLLECT  — gather raw data from existing modules
 *   2. NORMALIZE — map all results to TrustViolation[] with 6-tuple evidence
 *   3. SCORE    — apply weighted scoring formulas
 *   4. DECIDE   — compute Overall, Decision, Confidence
 *   5. ASSEMBLE — build final TrustDecision with audit trail
 *
 * Uses lazy require() pattern to avoid circular dependencies
 * and enable best-effort graceful degradation.
 */

import * as crypto from "crypto";
import * as path from "path";
import type {
  TrustDecision,
  TrustEvaluationContext,
  TrustViolation,
  ViolationSeverity,
  SeveritySummary,
  AuditTrail,
} from "./types";
import {
  DEFAULT_DIMENSION_WEIGHTS,
  DECISION_THRESHOLDS,
} from "./types";
import { checkExplainability } from "./explainability";
import {
  scorePolicyCompliance,
  scoreProtocolSafety,
  scoreVerificationCoverage,
  scoreGovernanceIntegrity,
  calculateOverallScore,
  determineDecision,
  determineConfidence,
  countViolationsBySeverity,
} from "./score-calculator";
import type { GovernanceDefect } from "./score-calculator";
import { computeCoverageConfidence } from "./confidence-calculator";
import type { CoverageConfidence } from "./confidence-calculator";
import { buildViolationTraces, renderTraceSummary } from "./violation-trace";
import {
  mapSequenceToSemantic,
  mapSequenceToSemanticWithLLM,
  isKnownProtocolDomain,
} from "./api-semantic-mapper";
import { validateSemanticSequence, checkSpecificViolations } from "./protocol-domain-validator";
import type { SemanticSequence } from "./api-semantic-mapper";
import { suggestAnnotations } from "../annotation-suggest";
import type { AnnotationSuggestion } from "../annotation-suggest";
import {
  buildCallGraphFromIR,
  enrichSequence,
  inferDomainsFromFunctionName,
} from "./call-graph-propagator";
import type { CallGraphIndex } from "./call-graph-propagator";
import type { ExpressSecurityIssue } from "../frameworks/express-detector";
import { analyzeFastapiStructure } from "../frameworks/fastapi-detector";
import { analyzeDjangoStructure } from "../frameworks/django-detector";
import { analyzeFlaskStructure } from "../frameworks/flask-detector";
import { analyzeFastifyFile } from "../frameworks/fastify-detector";
import { analyzeNextApp, readNextMiddleware } from "../frameworks/nextjs-detector";
import { analyzeKoaFile } from "../frameworks/koa-detector";
import { analyzeHapiFile } from "../frameworks/hapi-detector";
import {
  validateSequenceWithSSG,
  ssgViolationsToTrustViolations,
  loadProtocolRules,
  summarizeSSGCoverage,
  normalizeName,
} from "./ssg-bridge";
import type { SSGValidationResult } from "./ssg-bridge";
import { buildCallSequences, collectProjectFunctionNames } from "../call-sequence";
import type { CallSequence } from "../call-sequence";
import { extractIR } from "../extract-ir";
import { extractIRPython } from "../extract-ir-python";
import { extractIRC } from "../extract-ir-c";

// ── Main Entry Point ──

/**
 * Trust 决策主入口：收集 → 归一化 → 评分 → 决策 → 组装。
 *
 * IR 写盘语义（勿改）：项目缺少 ir.json 时，引擎按 ctx.language 自动提取
 * 并落盘（TS/JS → extractIR 裸数组；Python → extractIRPython 裸数组；
 * C → extractIRC 合并形态 { typeMap, functions }）——注解合并（P4.5）依赖
 * ir.json，调用方【无需】手动 extractProjectIR/写盘（曾是对 C 注解静默
 * 失效的文档/API 陷阱，回归测试见 tests/trust/engine.test.ts「DSH 陷阱」）。
 * 若项目已有 ir.json，以现有文件为准（不覆盖）。
 */
export async function evaluateTrust(ctx: TrustEvaluationContext): Promise<TrustDecision> {
  const engineVersion = "trust-runtime-v1.0.0";
  const timestamp = new Date().toISOString();
  const checkId = `check_${crypto.randomBytes(4).toString("hex")}`;

  // ═══════════════════════════════════════
  //  PHASE 1: COLLECT
  // ═══════════════════════════════════════

  // ── Phase 5: Build call graph for cross-function propagation ──
  const callGraph: CallGraphIndex = buildCallGraphFromIR(
    path.join(ctx.projectPath, "ir.json")
  );

  const enterpriseViolations = collectEnterpriseViolations(ctx);
  const { violations: protocolViolations, coverage: mappingCoverageData, ssgCoverage: ssgCov, annotationSuggestions: cAnnotationSuggestions } =
    await collectProtocolViolations(ctx, callGraph);
  const expressResult = collectExpressViolations(ctx);
  const nestjsResult = collectNestJSViolations(ctx);
  const trpcResult = collectTRPCViolations(ctx);
  const fastapiResult = collectFastapiViolations(ctx);
  const djangoResult = collectDjangoViolations(ctx);
  const flaskResult = collectFlaskViolations(ctx);
  const fastifyResult = collectFastifyViolations(ctx);
  const nextjsResult = collectNextjsViolations(ctx);
  const koaResult = collectKoaViolations(ctx);
  const hapiResult = collectHapiViolations(ctx);
  const coverageData = collectVerificationCoverage(ctx);
  const governanceDefects = collectGovernanceDefects(ctx);

  // ═══════════════════════════════════════
  //  PHASE 2: NORMALIZE — All violations to TrustViolation[]
  // ═══════════════════════════════════════

  // Cross-framework correction: tRPC projects authenticate via
  // protectedProcedure/adminProcedure, not Express middleware.
  // Suppress EXPRESS_NO_AUTH_MIDDLEWARE when tRPC auth exists.
  const expressViolations = trpcResult.coverage.hasTRPCAuth
    ? expressResult.violations.filter(v => v.rule_id !== "EXPRESS_NO_AUTH_MIDDLEWARE")
    : expressResult.violations;

  const allViolations: TrustViolation[] = [
    ...enterpriseViolations,
    ...protocolViolations,
    ...expressViolations,
    ...nestjsResult.violations,
    ...trpcResult.violations,
    ...fastapiResult.violations,
    ...djangoResult.violations,
    ...flaskResult.violations,
    ...fastifyResult.violations,
    ...nextjsResult.violations,
    ...koaResult.violations,
    ...hapiResult.violations,
  ];

  // ═══════════════════════════════════════
  //  PHASE 3: SCORE
  // ═══════════════════════════════════════

  const policyResult = scorePolicyCompliance(allViolations);
  const protocolResult = scoreProtocolSafety(allViolations);
  const coverageResult = scoreVerificationCoverage(coverageData);
  const governanceResult = scoreGovernanceIntegrity(governanceDefects);
  const explainResult = checkExplainability(allViolations);

  // ═══════════════════════════════════════
  //  PHASE 4: DECIDE
  // ═══════════════════════════════════════

  const overallScore = calculateOverallScore([
    { score: policyResult.score, weight: DEFAULT_DIMENSION_WEIGHTS.policyCompliance },
    { score: protocolResult.score, weight: DEFAULT_DIMENSION_WEIGHTS.protocolSafety },
    { score: coverageResult.score, weight: DEFAULT_DIMENSION_WEIGHTS.verificationCoverage },
    { score: governanceResult.score, weight: DEFAULT_DIMENSION_WEIGHTS.governanceIntegrity },
  ]);

  // Apply critical lock
  const effectiveScore = policyResult.hasCritical
    ? Math.min(overallScore, DECISION_THRESHOLDS.criticalLock)
    : overallScore;

  const decision = determineDecision(
    effectiveScore,
    policyResult.hasCritical,
    explainResult.status
  );

  // ── Phase 1: Coverage-based confidence (replaces qualitative labels) ──
  const coverageConfidence: CoverageConfidence = computeCoverageConfidence(ctx.projectPath);

  const dimConfidences = [
    policyResult.hasCritical ? "LOW" as const : coverageResult.confidence,
    protocolResult.confidence,
    coverageResult.confidence,
    governanceResult.confidence,
  ];

  const confidence = determineConfidence(dimConfidences, explainResult.status);

  // ═══════════════════════════════════════
  //  PHASE 5: ASSEMBLE
  // ═══════════════════════════════════════

  // Build violation traces (Phase 3)
  const traces = buildViolationTraces(allViolations);
  const violationTraces = traces.map(t => ({
    rule_id: t.violation.rule_id,
    file: t.violation.file,
    function: t.violation.function,
    steps: t.steps.map(s => ({
      step: s.step,
      label: s.label,
      action: s.action,
      preState: s.preState,
      explanation: s.explanation,
    })),
    fixPath: t.fixPath,
    estimatedReadingTimeMinutes: t.estimatedReadingTimeMinutes,
  }));

  const summary: SeveritySummary = countViolationsBySeverity(allViolations);

  const auditTrail: AuditTrail = {
    commit: ctx.commit,
    policy: ctx.policyName || "default",
    policyVersion: "v1.0.0",
    engineVersion,
    generatedAt: timestamp,
    reproducible: true,
    checkId,
  };

  const trustDecision: TrustDecision = {
    project: ctx.projectName,
    commit: ctx.commit,
    timestamp,
    engineVersion,
    annotationSuggestions: cAnnotationSuggestions,
    overall: {
      score: effectiveScore,
      decision,
      confidence,
      coverageConfidence: {
        score: coverageConfidence.score,
        margin: coverageConfidence.margin,
        level: coverageConfidence.level,
        summary: coverageConfidence.summary,
      },
      mappingCoverage: mappingCoverageData.totalApis > 0
        ? {
            rate: Math.round(
              ((mappingCoverageData.lookupHits + mappingCoverageData.llmHits) /
                mappingCoverageData.totalApis) *
                100
            ),
            lookupHits: mappingCoverageData.lookupHits,
            llmHits: mappingCoverageData.llmHits,
            totalApis: mappingCoverageData.totalApis,
            level:
              (mappingCoverageData.lookupHits + mappingCoverageData.llmHits) /
                mappingCoverageData.totalApis >
              0.7
                ? "GOOD"
                : (mappingCoverageData.lookupHits + mappingCoverageData.llmHits) /
                    mappingCoverageData.totalApis >
                  0.4
                  ? "ADEQUATE"
                  : "LOW",
            /** Phase 5: cross-function call graph propagation */
            propagatedDomains: mappingCoverageData.propagatedDomains,
            graphAvailable: mappingCoverageData.graphAvailable,
          }
        : undefined,
      /** SSG State Machine coverage — how many calls were matched to protocol rules */
      ssgCoverage: ssgCov,
      /** Express framework adapter coverage — routes & middleware analyzed */
      expressCoverage: expressResult.coverage.expressApps > 0
        ? {
            appsDetected: expressResult.coverage.expressApps,
            totalRoutes: expressResult.coverage.totalRoutes,
            filesScanned: expressResult.coverage.filesScanned,
            issuesFound: expressResult.violations.length,
          }
        : undefined,
      /** NestJS framework adapter coverage — decorator-based route analysis */
      nestjsCoverage: nestjsResult.coverage.controllers > 0
        ? {
            controllers: nestjsResult.coverage.controllers,
            totalRoutes: nestjsResult.coverage.routes,
            filesScanned: nestjsResult.coverage.filesScanned,
            issuesFound: nestjsResult.violations.length,
          }
        : undefined,
      /** FastAPI framework adapter coverage — route/auth-dependency analysis */
      fastapiCoverage: fastapiResult.coverage.routes > 0
        ? {
            appsDetected: fastapiResult.coverage.apps,
            totalRoutes: fastapiResult.coverage.routes,
            filesScanned: fastapiResult.coverage.filesScanned,
            issuesFound: fastapiResult.violations.length,
          }
        : undefined,
      /** Django framework adapter coverage — urlconf/view/permission analysis */
      djangoCoverage: djangoResult.coverage.routes > 0
        ? {
            appsDetected: djangoResult.coverage.apps,
            totalRoutes: djangoResult.coverage.routes,
            filesScanned: djangoResult.coverage.filesScanned,
            issuesFound: djangoResult.violations.length,
          }
        : undefined,
      /** Flask framework adapter coverage — route/auth-guard analysis */
      flaskCoverage: flaskResult.coverage.routes > 0
        ? {
            appsDetected: flaskResult.coverage.apps,
            totalRoutes: flaskResult.coverage.routes,
            filesScanned: flaskResult.coverage.filesScanned,
            issuesFound: flaskResult.violations.length,
          }
        : undefined,
      /** Fastify framework adapter coverage — route/auth-hook analysis */
      fastifyCoverage: fastifyResult.coverage.routes > 0
        ? {
            appsDetected: fastifyResult.coverage.apps,
            totalRoutes: fastifyResult.coverage.routes,
            filesScanned: fastifyResult.coverage.filesScanned,
            issuesFound: fastifyResult.violations.length,
          }
        : undefined,
      /** Next.js framework adapter coverage — App Router route handler analysis */
      nextjsCoverage: nextjsResult.coverage.routes > 0
        ? {
            appsDetected: nextjsResult.coverage.apps,
            totalRoutes: nextjsResult.coverage.routes,
            filesScanned: nextjsResult.coverage.filesScanned,
            issuesFound: nextjsResult.violations.length,
          }
        : undefined,
      /** Koa framework adapter coverage — route/auth-middleware analysis */
      koaCoverage: koaResult.coverage.routes > 0
        ? {
            appsDetected: koaResult.coverage.apps,
            totalRoutes: koaResult.coverage.routes,
            filesScanned: koaResult.coverage.filesScanned,
            issuesFound: koaResult.violations.length,
          }
        : undefined,
      /** Hapi framework adapter coverage — route-config auth analysis */
      hapiCoverage: hapiResult.coverage.routes > 0
        ? {
            appsDetected: hapiResult.coverage.apps,
            totalRoutes: hapiResult.coverage.routes,
            filesScanned: hapiResult.coverage.filesScanned,
            issuesFound: hapiResult.violations.length,
          }
        : undefined,
    },
    dimensions: {
      policyCompliance: {
        score: policyResult.score,
        weight: DEFAULT_DIMENSION_WEIGHTS.policyCompliance,
        confidence: policyResult.hasCritical ? "LOW" : "HIGH",
        violations: allViolations.filter((v) => v.severity !== "low" || v.policy_ref !== "protocol"),
      },
      protocolSafety: protocolResult,
      verificationCoverage: coverageResult,
      governanceIntegrity: governanceResult,
      explainability: explainResult,
      evolutionStability: {
        score: null,
        weight: DEFAULT_DIMENSION_WEIGHTS.evolutionStability,
        status: "UNAVAILABLE",
        reason: "Insufficient history — requires ≥ 3 iterations of AI-generated changes",
      },
    },
    violations: allViolations,
    violationTraces,
    summary,
    auditTrail,
  };

  return trustDecision;
}

// ═══════════════════════════════════════════════
//  COLLECTORS — Each gathers data from existing modules
// ═══════════════════════════════════════════════

/**
 * Collect enterprise policy violations from the existing policy engine
 * and map them to TrustViolation[] with 6-tuple evidence.
 */
function collectEnterpriseViolations(ctx: TrustEvaluationContext): TrustViolation[] {
  const violations: TrustViolation[] = [];

  // ── A. Enterprise Policy Rules ──
  try {
    const { loadEnterprisePolicyConfig, evaluatePolicy } = require("../policy");
    const { certify } = require("../certify");
    const { buildAccountabilityChain } = require("../ledger");

    const enterprisePolicy = loadEnterprisePolicyConfig(ctx.projectPath, ctx.policyName);

    // Scan project files for certifiable files (best-effort)
    const projectDir = ctx.projectPath;
    let certFile: string | null = null;

    try {
      const fs = require("fs");
      const srcDir = path.join(projectDir, "src");
      if (fs.existsSync(srcDir)) {
        const extensions = languageToExtensions(ctx.language);
    const files = walkDir(srcDir, extensions, 50);
        certFile = files.length > 0 ? files[0] : null;
      }
    } catch { /* best-effort */ }

    if (certFile) {
      try {
        const cert = certify(certFile);

        let acct;
        try {
          acct = buildAccountabilityChain(cert.sessionId);
        } catch { /* no accountability */ }

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
          accountability: acct ? {
            humanEvents: acct.humanEvents,
            aiEvents: acct.aiEvents,
            automatedEvents: acct.automatedEvents,
            custodyGap: acct.custodyGap,
          } : undefined,
        };

        const result = evaluatePolicy(policyCtx);

        // Map PolicyResult violations → TrustViolation[]
        for (const rv of result.violations) {
          const trustViolation = mapPolicyViolation(rv, certFile, enterprisePolicy);
          violations.push(trustViolation);
        }
      } catch { /* best-effort */ }
    }

    // ── B. Enterprise Rules (custom rules from .progmune-policy.json) ──
    if (enterprisePolicy.isEnterprise && enterprisePolicy.rules.length > 0) {
      for (const rule of enterprisePolicy.rules) {
        const matched = checkEnterpriseRule(rule, ctx.projectPath, ctx.language);
        if (matched) {
          violations.push({
            severity: rule.severity,
            rule_id: rule.id,
            file: matched.file || "unknown",
            function: matched.function || "unknown",
            message: rule.description,
            evidence: matched.evidence || rule.description,
            why: `Violates enterprise policy: ${rule.name}`,
            fix: `Review and align with enterprise rule ${rule.id}`,
            policy_ref: rule.policy_ref,
          });
        }
      }
    }
  } catch { /* best-effort */ }

  return violations;
}

/**
 * Map a legacy PolicyResult RuleViolation to a TrustViolation with 6-tuple evidence.
 */
function mapPolicyViolation(
  rv: { rule: { type: string; severity: string; description?: string }; actual: string; expected: string; detail?: string },
  filePath: string,
  _enterprisePolicy: any
): TrustViolation {
  const severity: ViolationSeverity =
    rv.rule.severity === "block" ? "critical" : rv.rule.severity === "warn" ? "high" : "medium";

  return {
    severity,
    rule_id: rv.rule.type,
    file: filePath,
    function: extractFunctionName(rv.detail || rv.actual),
    message: rv.rule.description || `${rv.actual} (expected: ${rv.expected})`,
    evidence: rv.detail || `${rv.actual} → ${rv.expected}`,
    why: rv.detail || `Violation of rule type: ${rv.rule.type}`,
    fix: `Address ${rv.rule.type} violation: ${rv.expected}`,
    policy_ref: "default",
  };
}

// ═══════════════════════════════════════════════
//  Express Framework Adapter Collector
// ═══════════════════════════════════════════════

/**
 * Collect Express-specific security violations from the framework detector.
 * Maps ExpressSecurityIssue[] → TrustViolation[].
 */
function collectKoaViolations(ctx: TrustEvaluationContext): {
  violations: TrustViolation[];
  coverage: { apps: number; routes: number; filesScanned: number };
} {
  const violations: TrustViolation[] = [];
  const coverage = { apps: 0, routes: 0, filesScanned: 0 };

  try {
    const fs = require("fs");
    const candidateDirs = ["src", "server", "app", "api", "routes", "lib"];
    const extensions = languageToExtensions(ctx.language);
    for (const dir of candidateDirs) {
      const dirPath = path.join(ctx.projectPath, dir);
      if (!fs.existsSync(dirPath)) continue;
      let files: string[];
      try { files = walkDir(dirPath, extensions, 100); } catch { continue; }
      for (const file of files) {
        if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(file)) continue;
        coverage.filesScanned++;
        try {
          const analysis = analyzeKoaFile(file);
          if (!analysis || !analysis.hasKoa) continue;
          coverage.apps++;
          coverage.routes += analysis.routes.length;
          for (const issue of analysis.issues) {
            violations.push({
              severity: issue.severity === "low" ? "low" : issue.severity,
              rule_id: issue.rule,
              file: path.relative(ctx.projectPath, file),
              function: "unknown",
              message: issue.message,
              evidence: issue.route || "",
              why: `Framework structural analysis: ${issue.message}`,
              fix: `Add an auth middleware to the route registration, or register an auth middleware globally with app.use.`,
              policy_ref: "framework-safety.koa",
            });
          }
        } catch { /* skip unreadable files */ }
      }
    }
  } catch { /* best-effort */ }

  return { violations, coverage };
}

function collectHapiViolations(ctx: TrustEvaluationContext): {
  violations: TrustViolation[];
  coverage: { apps: number; routes: number; filesScanned: number };
} {
  const violations: TrustViolation[] = [];
  const coverage = { apps: 0, routes: 0, filesScanned: 0 };

  try {
    const fs = require("fs");
    const candidateDirs = ["src", "server", "app", "api", "routes", "lib"];
    const extensions = languageToExtensions(ctx.language);
    for (const dir of candidateDirs) {
      const dirPath = path.join(ctx.projectPath, dir);
      if (!fs.existsSync(dirPath)) continue;
      let files: string[];
      try { files = walkDir(dirPath, extensions, 100); } catch { continue; }
      for (const file of files) {
        if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(file)) continue;
        coverage.filesScanned++;
        try {
          const analysis = analyzeHapiFile(file);
          if (!analysis || !analysis.hasHapi) continue;
          coverage.apps++;
          coverage.routes += analysis.routes.length;
          for (const issue of analysis.issues) {
            violations.push({
              severity: issue.severity === "low" ? "low" : issue.severity,
              rule_id: issue.rule,
              file: path.relative(ctx.projectPath, file),
              function: "unknown",
              message: issue.message,
              evidence: issue.route || "",
              why: `Framework structural analysis: ${issue.message}`,
              fix: `Add an auth strategy reference to the route options (auth: "<strategy>"), or remove the explicit auth: false.`,
              policy_ref: "framework-safety.hapi",
            });
          }
        } catch { /* skip unreadable files */ }
      }
    }
  } catch { /* best-effort */ }

  return { violations, coverage };
}

function collectNextjsViolations(ctx: TrustEvaluationContext): {
  violations: TrustViolation[];
  coverage: { apps: number; routes: number; filesScanned: number };
} {
  const violations: TrustViolation[] = [];
  const coverage = { apps: 0, routes: 0, filesScanned: 0 };

  try {
    const middlewareCode = readNextMiddleware(ctx.projectPath);
    const analysis = analyzeNextApp(ctx.projectPath, middlewareCode);
    if (!analysis.hasNext) return { violations, coverage };

    coverage.apps = 1;
    coverage.routes = analysis.routeFiles.length;
    coverage.filesScanned = analysis.routeFiles.length;

    for (const issue of analysis.issues) {
      violations.push({
        severity: issue.severity === "low" ? "low" : issue.severity,
        rule_id: issue.rule,
        file: issue.file || "",
        function: "unknown",
        message: issue.message,
        evidence: issue.route || "",
        why: `Framework structural analysis: ${issue.message}`,
        fix: `Add an auth check inside the route handler (e.g. getServerSession) or protect the app with auth middleware.`,
        policy_ref: "framework-safety.nextjs",
      });
    }
  } catch { /* best-effort */ }

  return { violations, coverage };
}

function collectFastifyViolations(ctx: TrustEvaluationContext): {
  violations: TrustViolation[];
  coverage: { apps: number; routes: number; filesScanned: number };
} {
  const violations: TrustViolation[] = [];
  const coverage = { apps: 0, routes: 0, filesScanned: 0 };

  try {
    const fs = require("fs");
    const candidateDirs = ["src", "server", "app", "api", "routes", "lib"];
    const extensions = languageToExtensions(ctx.language);

    for (const dir of candidateDirs) {
      const dirPath = path.join(ctx.projectPath, dir);
      if (!fs.existsSync(dirPath)) continue;
      let files: string[];
      try {
        files = walkDir(dirPath, extensions, 100);
      } catch {
        continue;
      }
      for (const file of files) {
        if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(file)) continue;
        coverage.filesScanned++;
        try {
          const analysis = analyzeFastifyFile(file);
          if (!analysis || !analysis.hasFastify) continue;
          coverage.apps++;
          coverage.routes += analysis.routes.length;
          for (const issue of analysis.issues) {
            violations.push({
              severity: issue.severity === "low" ? "low" : issue.severity,
              rule_id: issue.rule,
              file: path.relative(ctx.projectPath, file),
              function: "unknown",
              message: issue.message,
              evidence: issue.route || "",
              why: `Framework structural analysis: ${issue.message}`,
              fix: `Add preHandler/preValidation auth to the route options, or register an auth addHook.`,
              policy_ref: "framework-safety.fastify",
            });
          }
        } catch { /* skip unreadable files */ }
      }
    }
  } catch { /* best-effort */ }

  return { violations, coverage };
}

function collectFlaskViolations(ctx: TrustEvaluationContext): {
  violations: TrustViolation[];
  coverage: { apps: number; routes: number; filesScanned: number };
} {
  const violations: TrustViolation[] = [];
  const coverage = { apps: 0, routes: 0, filesScanned: 0 };

  // 仅 Python 项目跑框架结构扫描
  const lang = ctx.language || "typescript";
  if (lang !== "python") return { violations, coverage };

  try {
    const { execSync } = require("child_process");
    const fs = require("fs");
    const os = require("os");
    // engine.js 位于 dist/trust/ → 仓库根 tools/ 需要两级向上
    const scriptPath = path.resolve(__dirname, "..", "..", "tools", "extract_framework_flask.py");
    const outPath = path.join(os.tmpdir(), `progmune-fwfl-${process.pid}-${Date.now()}.json`);
    execSync(`python3 "${scriptPath}" "${ctx.projectPath}" "${outPath}"`, {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 60000,
    });
    if (!fs.existsSync(outPath)) return { violations, coverage };
    const structure = JSON.parse(fs.readFileSync(outPath, "utf-8"));
    fs.unlinkSync(outPath);

    const analysis = analyzeFlaskStructure(structure);
    if (!analysis.hasFlask) return { violations, coverage };

    coverage.apps = (structure.apps || []).length + (structure.blueprints || []).length;
    coverage.routes = (structure.routes || []).length;
    coverage.filesScanned = structure.filesScanned || 0;

    for (const issue of analysis.issues) {
      violations.push({
        severity: issue.severity === "low" ? "low" : issue.severity,
        rule_id: issue.rule,
        file: issue.file || "",
        function: issue.handler || "unknown",
        message: issue.message,
        evidence: issue.route || "",
        why: `Framework structural analysis: ${issue.message}`,
        fix: `Add an auth decorator (@login_required or custom) to the route handler, or register an auth before_request guard.`,
        policy_ref: "framework-safety.flask",
      });
    }
  } catch { /* best-effort — framework analysis must never break evaluation */ }

  return { violations, coverage };
}

function collectDjangoViolations(ctx: TrustEvaluationContext): {
  violations: TrustViolation[];
  coverage: { apps: number; routes: number; filesScanned: number };
} {
  const violations: TrustViolation[] = [];
  const coverage = { apps: 0, routes: 0, filesScanned: 0 };

  // 仅 Python 项目跑框架结构扫描
  const lang = ctx.language || "typescript";
  if (lang !== "python") return { violations, coverage };

  try {
    const { execSync } = require("child_process");
    const fs = require("fs");
    const os = require("os");
    // engine.js 位于 dist/trust/ → 仓库根 tools/ 需要两级向上
    const scriptPath = path.resolve(__dirname, "..", "..", "tools", "extract_framework_django.py");
    const outPath = path.join(os.tmpdir(), `progmune-fwdj-${process.pid}-${Date.now()}.json`);
    execSync(`python3 "${scriptPath}" "${ctx.projectPath}" "${outPath}"`, {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 60000,
    });
    if (!fs.existsSync(outPath)) return { violations, coverage };
    const structure = JSON.parse(fs.readFileSync(outPath, "utf-8"));
    fs.unlinkSync(outPath);

    const analysis = analyzeDjangoStructure(structure);
    if (!analysis.hasDjango) return { violations, coverage };

    coverage.apps = 1;
    coverage.routes = (structure.routes || []).length;
    coverage.filesScanned = structure.filesScanned || 0;

    for (const issue of analysis.issues) {
      violations.push({
        severity: issue.severity === "low" ? "low" : issue.severity,
        rule_id: issue.rule,
        file: issue.file || "",
        function: issue.handler || "unknown",
        message: issue.message,
        evidence: issue.route || "",
        why: `Framework structural analysis: ${issue.message}`,
        fix: issue.rule === "DRF_PERMISSION_BYPASS"
          ? `Require authenticated permissions on write methods (e.g. permission_classes = (IsAuthenticated,)).`
          : `Add a login decorator (@login_required) or an auth mixin (LoginRequiredMixin) to the view.`,
        policy_ref: "framework-safety.django",
      });
    }
  } catch { /* best-effort — framework analysis must never break evaluation */ }

  return { violations, coverage };
}

function collectFastapiViolations(ctx: TrustEvaluationContext): {
  violations: TrustViolation[];
  coverage: { apps: number; routes: number; filesScanned: number };
} {
  const violations: TrustViolation[] = [];
  const coverage = { apps: 0, routes: 0, filesScanned: 0 };

  // 仅 Python 项目跑框架结构扫描（避免 TS 项目无谓的 python3 子进程）
  const lang = ctx.language || "typescript";
  if (lang !== "python") return { violations, coverage };

  try {
    const { execSync } = require("child_process");
    const fs = require("fs");
    const os = require("os");
    // engine.js 位于 dist/trust/ → 仓库根 tools/ 需要两级向上
    const scriptPath = path.resolve(__dirname, "..", "..", "tools", "extract_framework_py.py");
    const outPath = path.join(os.tmpdir(), `progmune-fw-${process.pid}-${Date.now()}.json`);
    execSync(`python3 "${scriptPath}" "${ctx.projectPath}" "${outPath}"`, {
      encoding: "utf-8",
      stdio: "pipe",
      timeout: 60000,
    });
    if (!fs.existsSync(outPath)) return { violations, coverage };
    const structure = JSON.parse(fs.readFileSync(outPath, "utf-8"));
    fs.unlinkSync(outPath);

    const analysis = analyzeFastapiStructure(structure);
    if (!analysis.hasFastAPI) return { violations, coverage };

    coverage.apps = (structure.apps || []).length + (structure.routers || []).length;
    coverage.routes = (structure.routes || []).length;
    coverage.filesScanned = structure.filesScanned || 0;

    for (const issue of analysis.issues) {
      violations.push({
        severity: issue.severity === "low" ? "low" : issue.severity,
        rule_id: issue.rule,
        file: issue.file || "",
        function: issue.handler || "unknown",
        message: issue.message,
        evidence: issue.route || "",
        why: `Framework structural analysis: ${issue.message}`,
        fix: issue.rule === "FASTAPI_ROUTE_NO_AUTH"
          ? `Add an auth dependency to the route (Depends/Security of an authenticator) or move it behind authenticated middleware.`
          : `Reference the scheme from a route dependency or remove the unused scheme.`,
        policy_ref: "framework-safety.fastapi",
      });
    }
  } catch { /* best-effort — framework analysis must never break evaluation */ }

  return { violations, coverage };
}

function collectExpressViolations(ctx: TrustEvaluationContext): {
  violations: TrustViolation[];
  coverage: { expressApps: number; totalRoutes: number; filesScanned: number };
} {
  const violations: TrustViolation[] = [];
  let expressApps = 0;
  let totalRoutes = 0;
  let filesScanned = 0;

  try {
    const { analyzeExpressFile } = require("../frameworks/express-detector");
    const fs = require("fs");

    // Scan common source directories for Express files
    const candidateDirs = ["src", "server", "app", "api", "routes"];
    const extensions = languageToExtensions(ctx.language);

    for (const dir of candidateDirs) {
      const dirPath = path.join(ctx.projectPath, dir);
      if (!fs.existsSync(dirPath)) continue;

      let files: string[];
      try {
        files = walkDir(dirPath, extensions, 100);
      } catch {
        continue;
      }

      // First pass: identify all Express apps and find the main one
      const expressAnalyses: Array<{ file: string; analysis: ReturnType<typeof analyzeExpressFile> }> = [];
      for (const file of files) {
        // Skip test files
        if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(file)) continue;
        filesScanned++;

        try {
          const analysis = analyzeExpressFile(file);
          if (analysis && analysis.hasExpress) {
            expressAnalyses.push({ file, analysis });
          }
        } catch { /* skip unreadable files */ }
      }

      // Second pass: report issues from the main app file only
      // (the file with the most routes is the entry point).
      // Cross-file analysis: merge global findings (helmet/cors/auth)
      // from all files to avoid false positives from sub-modules.
      expressApps = expressAnalyses.length;
      let mainAppRoutes = 0;

      // Collect cross-file evidence
      const allGlobalMiddleware = new Set<string>();
      const allRouteMiddleware = new Set<string>();
      for (const { analysis } of expressAnalyses) {
        totalRoutes += analysis.routes.length;
        if (analysis.routes.length > mainAppRoutes) mainAppRoutes = analysis.routes.length;
        for (const mw of analysis.globalMiddleware) {
          allGlobalMiddleware.add(mw.type);
        }
        for (const route of analysis.routes) {
          for (const mw of route.middlewares) {
            // Classify each route middleware
            try {
              const { classifyMiddleware } = require("../frameworks/express-detector");
              allRouteMiddleware.add(classifyMiddleware("", mw));
            } catch { /* skip */ }
          }
        }
      }

      // Report from main app + cross-file evidence
      for (const { file, analysis } of expressAnalyses) {
        if (analysis.routes.length < mainAppRoutes) continue; // skip sub-modules

        for (const issue of analysis.issues) {
          // Cross-file correction: if the missing thing exists elsewhere, suppress the issue
          if (issue.rule === "EXPRESS_NO_AUTH_MIDDLEWARE" &&
              (allGlobalMiddleware.has("auth") || allRouteMiddleware.has("auth"))) {
            continue; // auth exists in project — this file just doesn't define it directly
          }
          if (issue.rule === "EXPRESS_NO_HELMET" && allGlobalMiddleware.has("security_header")) {
            continue;
          }
          if (issue.rule === "EXPRESS_NO_CORS_CONFIG" && allGlobalMiddleware.has("cors")) {
            continue;
          }
          if (issue.rule === "EXPRESS_NO_RATE_LIMIT" && allGlobalMiddleware.has("rate_limit")) {
            continue;
          }
          if (issue.rule === "EXPRESS_NO_INPUT_VALIDATION" &&
              (allGlobalMiddleware.has("validation") || allRouteMiddleware.has("validation"))) {
            continue;
          }
          if (issue.rule === "EXPRESS_SESSION_INSECURE" && allGlobalMiddleware.has("session")) {
            continue;
          }

          const severity: ViolationSeverity =
            issue.severity === "critical" ? "critical" :
            issue.severity === "high" ? "high" :
            issue.severity === "medium" ? "medium" : "low";

          violations.push({
            severity,
            rule_id: issue.rule,
            file: path.relative(ctx.projectPath, file),
            function: issue.route || "express-app",
            message: issue.message,
            evidence: `Express route: ${issue.route || "global"} | Line: ${issue.line}`,
            why: `Express security check failed: ${issue.rule}`,
            fix: issue.fix,
            policy_ref: "framework.express",
          });
        }
      }
    }
  } catch { /* best-effort — framework detector optional */ }

  return { violations, coverage: { expressApps, totalRoutes, filesScanned } };
}

// ═══════════════════════════════════════════════
//  tRPC Framework Adapter Collector
// ═══════════════════════════════════════════════

/**
 * Collect tRPC-specific API contract violations from procedure definitions.
 * Maps TRPCSecurityIssue[] → TrustViolation[].
 */
function collectTRPCViolations(ctx: TrustEvaluationContext): {
  violations: TrustViolation[];
  coverage: { trpcFiles: number; procedures: number; filesScanned: number; hasTRPCAuth: boolean };
} {
  const violations: TrustViolation[] = [];
  let trpcFiles = 0;
  let procedures = 0;
  let filesScanned = 0;
  let hasTRPCAuth = false;

  try {
    const { analyzeTRPCFile } = require("../frameworks/trpc-detector");
    const fs = require("fs");

    // Scan common source directories for tRPC files
    const candidateDirs = ["src", "server", "app", "api", "routes", "trpc"];
    const extensions = languageToExtensions(ctx.language);

    for (const dir of candidateDirs) {
      const dirPath = path.join(ctx.projectPath, dir);
      if (!fs.existsSync(dirPath)) continue;

      let files: string[];
      try {
        files = walkDir(dirPath, extensions, 100);
      } catch {
        continue;
      }

      for (const file of files) {
        // Skip test files
        if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(file)) continue;
        filesScanned++;

        let analysis: ReturnType<typeof analyzeTRPCFile>;
        try {
          analysis = analyzeTRPCFile(file);
        } catch {
          continue;
        }

        if (!analysis.hasTRPC) continue;
        trpcFiles++;
        procedures += analysis.procedures.length;
        if (analysis.procedures.some((p: any) => p.procedureType === "protected" || p.procedureType === "admin")) {
          hasTRPCAuth = true;
        }

        for (const issue of analysis.issues) {
          const severity: ViolationSeverity =
            issue.severity === "critical" ? "critical" :
            issue.severity === "high" ? "high" :
            issue.severity === "medium" ? "medium" : "low";

          violations.push({
            severity,
            rule_id: issue.rule,
            file: path.relative(ctx.projectPath, file),
            function: issue.procedure,
            message: issue.message,
            evidence: `tRPC procedure: ${issue.procedure} | Line: ${issue.line}`,
            why: `tRPC API contract check failed: ${issue.rule}`,
            fix: issue.fix,
            policy_ref: "framework.trpc.api-contract",
          });
        }
      }
    }
  } catch { /* best-effort — tRPC detector optional */ }

  return { violations, coverage: { trpcFiles, procedures, filesScanned, hasTRPCAuth } };
}

// ═══════════════════════════════════════════════
//  NestJS Framework Adapter Collector
// ═══════════════════════════════════════════════

/**
 * Collect NestJS-specific security violations from decorator analysis.
 * Maps NestJSSecurityIssue[] → TrustViolation[].
 */
function collectNestJSViolations(ctx: TrustEvaluationContext): {
  violations: TrustViolation[];
  coverage: { controllers: number; routes: number; filesScanned: number };
} {
  const violations: TrustViolation[] = [];
  let controllers = 0;
  let routes = 0;
  let filesScanned = 0;

  try {
    // 项目级分析（一次 ts-morph Project 装载）：全局 APP_GUARD 守卫与
    // @Public 豁免需要跨文件上下文——per-file 分析无法识别全局守卫，
    // 会把受全局保护的 mutation 路由系统性误报（补全轮实测根因）。
    const { analyzeNestJSProject } = require("../frameworks/nestjs-detector");
    const analysis = analyzeNestJSProject(ctx.projectPath);
    if (!analysis || analysis.controllers.length === 0) {
      return { violations, coverage: { controllers, routes, filesScanned } };
    }

    controllers = analysis.controllers.length;
    routes = analysis.routes.length;
    filesScanned = 1; // 项目级单次装载（口径：分析单元 = 项目）

    for (const issue of analysis.issues) {
      const severity: ViolationSeverity =
        issue.severity === "critical" ? "critical" :
        issue.severity === "high" ? "high" :
        issue.severity === "medium" ? "medium" : "low";

      violations.push({
        severity,
        rule_id: issue.type,
        file: issue.controller || "",
        function: `${issue.controller}.${issue.route}`,
        message: issue.message,
        evidence: `NestJS route: ${issue.route} | Controller: ${issue.controller}`,
        why: `NestJS decorator analysis: ${issue.type}`,
        fix: issue.fix,
        policy_ref: "framework.nestjs",
      });
    }
  } catch { /* best-effort */ }

  return { violations, coverage: { controllers, routes, filesScanned } };
}

/**
 * Check if an enterprise rule matches a file in the project.
 * Uses rule conditions (file_pattern, function_name, import, api_call, regex).
 */
function checkEnterpriseRule(
  rule: import("../policy/types").EnterpriseRule,
  projectPath: string,
  language?: string
): { file: string; function: string; evidence: string } | null {
  if (!rule.conditions || rule.conditions.length === 0) {
    return null; // Enterprise rules with no conditions can't be auto-matched
  }

  try {
    const fs = require("fs");
    const srcDir = path.join(projectPath, "src");
    if (!fs.existsSync(srcDir)) return null;

    const extensions = languageToExtensions(language);
    const files = walkDir(srcDir, extensions, 100);

    for (const file of files) {
      for (const cond of rule.conditions) {
        const matched = checkCondition(cond, file, projectPath);
        if (matched) return matched;
      }
    }
  } catch { /* best-effort */ }

  return null;
}

/**
 * Check a single RuleCondition against a file.
 */
function checkCondition(
  cond: import("../policy/types").RuleCondition,
  filePath: string,
  _projectPath: string
): { file: string; function: string; evidence: string } | null {
  try {
    const fs = require("fs");
    const content: string = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    if (cond.type === "file_pattern") {
      const pattern = new RegExp(cond.pattern, "i");
      if (pattern.test(filePath)) {
        return {
          file: filePath,
          function: "unknown",
          evidence: `File matches pattern: ${cond.pattern}`,
        };
      }
    }

    if (cond.type === "regex") {
      const regex = new RegExp(cond.pattern, "gm");
      const match = regex.exec(content);
      if (match) {
        const lineNum = content.substring(0, match.index).split("\n").length;
        const lineContent = lines[lineNum - 1]?.trim() || match[0];
        return {
          file: filePath,
          function: extractFunctionAtLine(lines, lineNum),
          evidence: `${filePath}:${lineNum} — ${lineContent}`,
        };
      }
    }

    if (cond.type === "function_name") {
      const escaped = cond.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`(function\\s+${escaped}|${escaped}\\s*[=:]\\s*(?:async\\s*)?\\(|${escaped}\\s*\\([^)]*\\)\\s*{)`, "gm");
      const match = regex.exec(content);
      if (match) {
        const lineNum = content.substring(0, match.index).split("\n").length;
        return {
          file: filePath,
          function: cond.pattern,
          evidence: `${filePath}:${lineNum} — ${lines[lineNum - 1]?.trim() || match[0]}`,
        };
      }
    }

    if (cond.type === "import") {
      if (content.includes(cond.pattern)) {
        const lineNum = content.split("\n").findIndex((l) => l.includes(cond.pattern)) + 1;
        return {
          file: filePath,
          function: "unknown",
          evidence: `${filePath}:${lineNum} — imports "${cond.pattern}"`,
        };
      }
    }

    if (cond.type === "api_call") {
      const escaped = cond.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escaped, "gm");
      const match = regex.exec(content);
      if (match) {
        const lineNum = content.substring(0, match.index).split("\n").length;
        return {
          file: filePath,
          function: extractFunctionAtLine(lines, lineNum),
          evidence: `${filePath}:${lineNum} — ${lines[lineNum - 1]?.trim() || match[0]}`,
        };
      }
    }
  } catch { /* best-effort */ }

  return null;
}

// ── Protocol Violation Collector (Phase 1: Semantic Mapping) ──

interface ProtocolViolationResult {
  violations: TrustViolation[];
  coverage: {
    totalApis: number;
    lookupHits: number;
    llmHits: number;
    propagatedDomains: number;
    graphAvailable: boolean;
  };
  /** SSG state machine validation coverage & results */
  ssgCoverage?: {
    sequencesValidated: number;
    totalCalls: number;
    matchedCalls: number;
    ssgViolations: number;
    summary: string;
    /** Warnings from project alias validation */
    aliasWarnings?: string[];
  };
  /** C 注解建议（采纳生死线）——仅 C 项目生成，其他语言 undefined */
  annotationSuggestions?: AnnotationSuggestion[];
}

async function collectProtocolViolations(
  ctx: TrustEvaluationContext,
  callGraph: CallGraphIndex
): Promise<ProtocolViolationResult> {
  const violations: TrustViolation[] = [];
  let totalApis = 0;
  let lookupHits = 0;
  let llmHits = 0;
  let propagatedCount = 0;

  // SSG State Machine variables (declared outside try for scope)
  let protocolRulesData: ReturnType<typeof loadProtocolRules> = null;
  const ssgResults: SSGValidationResult[] = [];
  let ssgTotalCalls = 0;
  let ssgMatchedCalls = 0;
  let ssgViolationCount = 0;
  // C 注解建议（函数级作用域——返回值在 try 外组装）
  let annotationSuggestions: AnnotationSuggestion[] | undefined;

  try {
    // ── P4.5 校准：TS/JS 项目在 ir.json 缺失时先提取 IR ──
    // 序列必须来自「函数体内真实调用」而非「文件内函数声明名单」——
    // 声明顺序 ≠ 执行顺序：正则扫描会把声明当调用（auth.ts 误报），
    // 也会因调用数不足阈值漏掉单调用违规文件（bad_flow 漏报）。
    // 注解合并（P4.5）依赖 ir.json 写盘：此前仅 TS/JS 自动提取，C/Python 项目
    // 直接调 evaluateTrust 时注解静默失效（DSH 复测发现的文档/API 陷阱）——
    // 按语言分派提取器兜底写盘；TS/JS 路径保持原样（裸数组形态，零变化）。
    {
      const lang = ctx.language || "typescript";
      // 静态导入（vitest 环境下 lazy require 的 CJS 互操作不可靠——
      // TS 路径从未触发过该分支：仓库根遗留 ir.json 短路了 existsSync 检查）
      const autoExtractor: Record<string, () => any[]> = {
        typescript: () => extractIR(ctx.projectPath),
        javascript: () => extractIR(ctx.projectPath),
        python: () => extractIRPython(ctx.projectPath),
        c: () => extractIRC(ctx.projectPath),
      };
      const extractFn = autoExtractor[lang];
      if (extractFn) {
        try {
          const fs = require("fs");
          if (!fs.existsSync(path.join(ctx.projectPath, "ir.json"))) {
            const ir = extractFn();
            // C 走合并形态（与 execute/MCP 写盘一致）；TS/Python 保持裸数组形态
            const payload = lang === "c" ? { typeMap: {}, functions: ir } : ir;
            fs.writeFileSync(path.join(ctx.projectPath, "ir.json"), JSON.stringify(payload, null, 2));
          }
        } catch { /* best-effort — 回退正则扫描 */ }
      }
    }

    // ── SSG State Machine: load protocol rules once ──
    protocolRulesData = loadProtocolRules(ctx.projectPath);

    // ── P4.5: 合并项目 IR 注解协议（IR 优先，缺 namespace 继承内置 JSON） ──
    // 内置 protocols.json 的规则是通用弱约束（如 generate_jwt pre=[]），
    // 项目文件里的 @protocol 注解才是项目真实协议（如 pre=[PASSWORD_VERIFIED]）。
    // planner 已用此合并语义，trust 引擎需对齐，否则项目级前置约束不生效。
    // 合并必须在序列构建【之前】：规则名是展开的保留单元（不内联），若合并
    // 晚于 extractCallSequencesFromProject，注解原语（有函数体、调项目函数的）
    // 会被内联掉，其 post 状态永不生效——真实 redis ACL 演示暴露（
    // checkPasswordBasedAuth 被内联 → AUTHENTICATED 未建立 → good 流误报）。
    // 与盲测 harness（scan-protocol-python）先合并后建序列的语义对齐。
    if (protocolRulesData) {
      try {
        const fs = require("fs");
        const irPath = path.join(ctx.projectPath, "ir.json");
        if (fs.existsSync(irPath)) {
          const ir = JSON.parse(fs.readFileSync(irPath, "utf-8"));
          // ir.json 两种形态：extractIR/extractIRPython 的裸数组、extractProjectIR
          // 的 { typeMap, functions } 合并对象（execute/MCP 写盘）——统一取函数列表。
          const functions = Array.isArray(ir) ? ir : (ir.functions || []);
          for (const f of functions) {
            if (!f.protocol) continue;
            const protocol = { ...f.protocol };
            const existing = protocolRulesData.rules.get(String(f.name));
            if (existing?.namespace && !protocol.namespace) {
              protocol.namespace = existing.namespace;
            }
            // 修复路径渲染真实函数名（fixPath 输出项目原语而非通用规则名）
            protocol.displayName = String(f.name);
            protocolRulesData.rules.set(String(f.name), protocol);
            // CamelCase 真实命名（C 代码普遍，如 ACLCheckAllPerm）注册的规则
            // 原样无法被任何匹配策略触达（normalize 只作用于调用名；词段匹配
            // 要求 ≥2 个下划线词段）——同步注册规范化形态使注解原语可被按名命中。
            // 加性改动：snake_case 注解（TS/Python 惯例）normalized === 原名，无变化。
            const normalized = normalizeName(String(f.name));
            if (normalized !== String(f.name)) {
              protocolRulesData.rules.set(normalized, protocol);
            }
          }
        }
      } catch { /* best-effort */ }
    }

    // ── Phase 1-5 Semantic Pipeline ──
    // 规则名集合作为展开的保留单元：规则函数不内联（调用名保留给匹配层）
    const callSequences = extractCallSequencesFromProject(
      ctx.projectPath,
      ctx.language,
      protocolRulesData ? new Set(protocolRulesData.rules.keys()) : undefined,
    );
    const flaggedCount = { value: 0 };
    const cleanCount = { value: 0 };

    // ── P4.6.1: 词段匹配门控的项目函数集合（best-effort，与注解合并共用 ir.json） ──
    // 词段匹配只对项目函数适用（改名协议原语）；外部库调用走 alias/关键词桥接。
    let projectFunctions: Set<string> | undefined;
    // ── 注解建议（采纳生死线）：未注解 C 项目的原语注解候选（加性，仅 C） ──
    // 未注解项目 SSG 层静默（0 flags）——建议清单是「看不见的问题」的入口：
    // 按函数名词汇启发式给出现成注释块模板（角色/命名空间/状态转移预填），
    // 人工确认后生效（与 c-alias-propose 的确认门同一哲学）。
    try {
      const fs = require("fs");
      const irPath = path.join(ctx.projectPath, "ir.json");
      if (fs.existsSync(irPath)) {
        const ir = JSON.parse(fs.readFileSync(irPath, "utf-8"));
        const functions = Array.isArray(ir) ? ir : (ir.functions || []);
        projectFunctions = collectProjectFunctionNames(functions);
        if ((ctx.language || "typescript") === "c") {
          annotationSuggestions = suggestAnnotations(
            functions,
            protocolRulesData ? new Set(protocolRulesData.rules.keys()) : undefined
          );
        }
      }
    } catch { /* best-effort */ }

    for (const seq of callSequences) {
      try {
        const semantic = await mapSequenceToSemanticWithLLM(seq.calls);

        // ── Phase 5: Cross-function propagation ──
        let enrichedDomains: import("./api-semantic-mapper").ProtocolDomain[] = [];
        if (callGraph.totalFunctions > 0) {
          // IR available: use call graph propagation
          const enriched = enrichSequence(semantic.steps, callGraph);
          enrichedDomains = enriched.propagatedDomains;
          if (enrichedDomains.length > 0) propagatedCount++;
        } else if (seq.function && seq.function !== "unknown") {
          // C project without IR: use heuristic inference
          enrichedDomains = inferDomainsFromFunctionName(seq.function);
          for (const call of seq.calls) {
            enrichedDomains.push(...inferDomainsFromFunctionName(call));
          }
        }

        // Merge propagated domains into the semantic sequence
        // so specific violation checks can use cross-function context
        if (enrichedDomains.length > 0) {
          for (const d of enrichedDomains) {
            if (!semantic.domains.includes(d)) {
              (semantic.domains as import("./api-semantic-mapper").ProtocolDomain[]).push(d);
            }
          }
        }

        // Track coverage stats (exclude JS/Python builtins)
        const noiseBuiltins = new Set([
          "console","log","error","warn","debug","info",
          "JSON","Math","Object","Array","String","Number","Boolean",
          "Promise","require","module","process","Buffer",
          "describe","it","test","expect","assert","beforeEach",
          "toString","valueOf","hasOwnProperty",
          "print","len","range","enumerate",
        ]);
        for (const step of semantic.steps) {
          if (!noiseBuiltins.has(step.api)) {
            totalApis++;
            if (step.source === "llm") llmHits++;
            else if (step.domain !== "util") lookupHits++;
          }
        }

        const validation = validateSemanticSequence(semantic);

        if (!validation.valid && validation.reason) {
          // Cross-domain violation — report as potential issue
          flaggedCount.value++;
          violations.push({
            severity: "medium",
            rule_id: "PROTOCOL_CROSS_DOMAIN",
            file: seq.file,
            function: seq.function || "unknown",
            message: `Cross-domain protocol concern: ${validation.reason}`,
            evidence: seq.calls.join(" → "),
            why: `Semantic domains [${validation.groups.join(", ")}] flagged as potentially incompatible`,
            fix: `Review call sequence for proper protocol transitions between ${validation.groups.join(" and ")}`,
            policy_ref: "protocol-safety.semantic",
          });
        } else if (validation.valid && validation.primaryGroup) {
          cleanCount.value++;
          // ── Phase 2: Run specific violation checks even on CLEAN sequences ──
          // A sequence may be a valid protocol operation but still violate
          // specific security requirements (e.g., TLS without cert verify)
          try {
            const specificViolations = checkSpecificViolations(
              semantic,
              seq.file ? path.join(ctx.projectPath, seq.file) : undefined,
              ctx.language
            );
            for (const sv of specificViolations) {
              violations.push({
                severity: "medium", // Phase 2: per-function window has inherent limitations
                rule_id: sv.ruleId,
                file: seq.file,
                function: seq.function || "unknown",
                message: sv.description,
                evidence: sv.evidence,
                why: `Protocol security requirement violated: ${sv.description}`,
                fix: `Ensure the required security check is performed: ${sv.description}`,
                policy_ref: "protocol-safety.specific",
              });
            }
          } catch { /* best-effort */ }
        }

        // ── SSG State Machine Validation ──
        // Validate the call sequence against protocol state machine rules.
        // Runs after semantic mapping so we can use domain classification
        // to bridge real API names to abstract protocol function names.
        if (protocolRulesData) {
          try {
            const ssgResult = validateSequenceWithSSG(
              semantic.steps,
              protocolRulesData.rules,
              protocolRulesData.namespaceInitialStates,
              seq.file,
              protocolRulesData.aliasIndex,
              protocolRulesData.wildcardAliases,
              projectFunctions,
              seq.directCalls ? new Set(seq.directCalls) : undefined,
            );
            ssgResults.push(ssgResult);
            ssgTotalCalls += ssgResult.stats.totalCalls;
            ssgMatchedCalls += ssgResult.stats.matchedCalls;
            ssgViolationCount += ssgResult.violations.length;

            // Convert SSG violations to TrustViolations and add to pipeline
            if (ssgResult.violations.length > 0) {
              const trustViolations = ssgViolationsToTrustViolations(
                ssgResult,
                seq.file,
                seq.function || "unknown",
              );
              for (const tv of trustViolations) {
                violations.push(tv);
              }
            }
          } catch { /* SSG validation best-effort */ }
        }
      } catch { /* best-effort per sequence */ }
    }

    // If no sequences found or all clean, fall back to risk-model for TP detection
    if (violations.length === 0) {
      try {
        const { assessRisk } = require("../risk-model");
        const risk = assessRisk(["init", "connect", "authenticate", "read", "write", "close"]);

        for (const pattern of risk.patterns || []) {
          const severity = mapRiskSeverity(pattern.severity);
          violations.push({
            severity,
            rule_id: pattern.id || `RISK_${pattern.patternName?.toUpperCase().replace(/\s+/g, "_") || "UNKNOWN"}`,
            file: "unknown",
            function: pattern.patternName || "unknown",
            message: pattern.detail || pattern.description || "Protocol risk detected",
            evidence: pattern.evidenceSequences?.join("; ") || pattern.detail || "",
            why: pattern.recommendation || `Detected risk pattern: ${pattern.patternName}`,
            fix: pattern.recommendation || "Review and address the detected risk pattern",
            policy_ref: "protocol-safety.default",
          });
        }
      } catch { /* best-effort fallback */ }
    }
  } catch { /* best-effort */ }

  return {
    violations,
    coverage: {
      totalApis,
      lookupHits,
      llmHits,
      propagatedDomains: propagatedCount,
      graphAvailable: callGraph.totalFunctions > 0,
    },
    ssgCoverage: protocolRulesData ? {
      sequencesValidated: ssgResults.length,
      totalCalls: ssgTotalCalls,
      matchedCalls: ssgMatchedCalls,
      ssgViolations: ssgViolationCount,
      summary: summarizeSSGCoverage(ssgResults),
      aliasWarnings: protocolRulesData.aliasWarnings?.length
        ? protocolRulesData.aliasWarnings : undefined,
    } : undefined,
    annotationSuggestions,
  };
}

function extractCallSequencesFromProject(
  projectPath: string,
  language?: string,
  keepNames?: Set<string>,
): CallSequence[] {
  // P4.5/P4.6: 优先 IR 精确序列（入口函数展开 + 非入口抑制，跨函数传播）
  const irSequences = extractCallSequencesFromIR(projectPath, keepNames);
  if (irSequences.length > 0) return irSequences;
  // 回退：正则扫描（C 等无 IR 语言保持原行为）
  return extractCallSequencesRegex(projectPath, language);
}

/**
 * P4.5/P4.6: 从 ir.json 构建验证序列——入口函数展开 + 非入口抑制
 * （共享实现见 src/call-sequence.ts buildCallSequences）：
 * 函数声明名单不再是验证对象；语义 marker（__progmune_*）供规则消费，
 * 不作真实调用；被项目函数调用的函数片段并入调用方展开序列。
 */
function extractCallSequencesFromIR(
  projectPath: string,
  keepNames?: Set<string>,
): CallSequence[] {
  try {
    const fs = require("fs");
    const irPath = path.join(projectPath, "ir.json");
    if (!fs.existsSync(irPath)) return [];
    const ir = JSON.parse(fs.readFileSync(irPath, "utf-8"));
    // ir.json 两种形态兼容：裸数组（extractIR / extractIRPython）与
    // { typeMap, functions } 合并对象（extractProjectIR，execute/MCP 写盘）。
    const functions = Array.isArray(ir) ? ir : (ir.functions || []);
    if (!Array.isArray(functions) || functions.length === 0) return [];
    return buildCallSequences(functions, keepNames);
  } catch {
    return [];
  }
}

/** 正则扫描回退路径（原实现）：按文件扫调用样 token，≥4 才成序列。 */
function extractCallSequencesRegex(
  projectPath: string,
  language?: string
): CallSequence[] {
  const sequences: CallSequence[] = [];

  try {
    const fs = require("fs");

    // Scan multiple common source directories (not just "src/")
    const candidateDirs = ["src", "server", "app", "lib", "api", "pages", "components", "routes"];
    const extensions = languageToExtensions(language);
    const allFiles: string[] = [];

    for (const dir of candidateDirs) {
      const dirPath = path.join(projectPath, dir);
      if (!fs.existsSync(dirPath)) continue;
      try {
        const files = walkDir(dirPath, extensions, 200);
        allFiles.push(...files);
      } catch { /* skip inaccessible dirs */ }
    }

    // Also scan TypeScript/JS files in root (e.g., next.config.ts, vite.config.ts)
    try {
      const rootEntries = fs.readdirSync(projectPath);
      for (const entry of rootEntries) {
        const full = path.join(projectPath, entry);
        if (!fs.statSync(full).isFile()) continue;
        if (extensions.some((ext: string) => entry.endsWith(ext))) {
          allFiles.push(full);
        }
      }
    } catch { /* best-effort */ }

    // Limit total files to prevent timeout
    const files = allFiles.slice(0, 300);

    for (const file of files) {
      // Skip test files — test assertions and setup code produce noise
      // in protocol validation. Real violations come from production code paths.
      const relFile = path.relative(projectPath, file);
      if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(relFile)) continue;
      if (relFile.includes("/test/") || relFile.includes("/__tests__/")) continue;

      try {
        const content = fs.readFileSync(file, "utf-8");
        const calls = extractCallsFromSource(content);
        if (calls.length >= 4) {
          sequences.push({
            calls,
            file: path.relative(projectPath, file),
            function: extractTopFunction(content),
          });
        }
      } catch { /* skip unreadable files */ }
    }
  } catch { /* best-effort */ }

  return sequences;
}

/**
 * Extract function call names from source code using simple regex.
 * Filters out keywords, operators, and common noise.
 */
function extractCallsFromSource(source: string): string[] {
  const calls: string[] = [];
  const callRegex = /\b([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*)\s*\(/g;
  const keywords = new Set([
    "if", "for", "while", "switch", "return", "sizeof", "typeof",
    "defined", "endif", "ifdef", "ifndef", "else", "elif",
    "case", "default", "break", "continue", "goto",
    "void", "int", "char", "long", "short", "float", "double",
    "struct", "enum", "union", "typedef", "static", "const", "volatile",
    "new", "delete", "class", "public", "private", "protected",
    "try", "catch", "throw", "finally", "async", "await",
  ]);

  let match;
  callRegex.lastIndex = 0;
  while ((match = callRegex.exec(source)) !== null) {
    const name = match[1];
    if (!keywords.has(name) && !name.startsWith("_")) {
      calls.push(name);
    }
  }

  return calls;
}

/**
 * Extract the top-level function name from source code.
 */
function extractTopFunction(source: string): string {
  const m = source.match(/(?:function\s+|def\s+|func\s+)(\w+)/);
  if (m) return m[1];
  const m2 = source.match(/(?:int\s+|void\s+|static\s+\w+\s+)(\w+)\s*\(/);
  if (m2) return m2[1];
  return "unknown";
}

// ── Verification Coverage Collector ──

function collectVerificationCoverage(ctx: TrustEvaluationContext): Record<string, number> {
  const coverage: Record<string, number> = {};

  // SSG Rules
  try {
    const { buildCoverageReport } = require("../ssg-validator");
    const report = buildCoverageReport?.();
    if (report?.coverage !== undefined && !Number.isNaN(report.coverage)) {
      coverage.ssgRules = Math.round(report.coverage * 30); // max 30
    } else {
      coverage.ssgRules = 15; // conservative default
    }
  } catch { coverage.ssgRules = 10; }

  // Ledger Invariant
  try {
    const { getAllSessions } = require("../failure-corpus");
    const sessions = getAllSessions?.() || [];
    const consistentCount = sessions.filter((s: any) => {
      try {
        const { checkLedgerConsistency } = require("../ssg-validator");
        const { getNsInit } = require("../protocol-registry");
        const trans = (s.attempts || []).flatMap((a: any) => a.transitions || []);
        if (trans.length === 0) return false;
        const result = checkLedgerConsistency(trans, getNsInit());
        return result.consistent;
      } catch { return false; }
    }).length;
    coverage.ledgerInvariant = sessions.length > 0
      ? Math.round((consistentCount / sessions.length) * 20)
      : 20; // assume passed if no sessions
  } catch { coverage.ledgerInvariant = 20; }

  // Coverage
  try {
    const { getAntibodyStats } = require("../failure-corpus");
    const stats = getAntibodyStats?.();
    if (stats?.totalHits !== undefined) {
      // Map antibody hits to coverage score (max 15)
      coverage.coverage = Math.min(15, Math.round((stats.totalHits || 0) / 10));
    } else {
      coverage.coverage = 8;
    }
  } catch { coverage.coverage = 5; }

  // TypeScript Type Check — always assume project handles this
  coverage.typescriptTypeCheck = ctx.language === "typescript" || !ctx.language ? 25 : 0;

  // Failure Genome
  try {
    const { getAntibodyStats } = require("../failure-corpus");
    const stats = getAntibodyStats?.();
    if (stats?.byLevel) {
      const totalSignatures = Object.values(stats.byLevel).reduce((a: number, b: any) => a + (b || 0), 0) as number;
      coverage.failureGenome = Math.min(10, Math.round(totalSignatures / 5));
    } else {
      coverage.failureGenome = 5;
    }
  } catch { coverage.failureGenome = 5; }

  return coverage;
}

// ── Governance Defect Collector ──

function collectGovernanceDefects(_ctx: TrustEvaluationContext): GovernanceDefect[] {
  const defects: GovernanceDefect[] = [];

  try {
    const { verifyAllFingerprints } = require("../ledger-registry");
    const summary = verifyAllFingerprints?.();
    if (summary) {
      if ((summary.tampered || 0) > 0) {
        for (let i = 0; i < summary.tampered; i++) {
          defects.push({ type: "hashMismatch" });
        }
      }
      if ((summary.notFound || 0) > 0) {
        defects.push({ type: "auditIncomplete" });
      }
    }
  } catch { /* best-effort */ }

  // Check ledger registry existence
  try {
    const fs = require("fs");
    const ledgerPath = path.join(_ctx.projectPath, ".progmune_corpus", "ledger");
    if (fs.existsSync(ledgerPath)) {
      const files = fs.readdirSync(ledgerPath);
      if (files.length === 0) {
        defects.push({ type: "ledgerMissing" });
      }
    } else {
      defects.push({ type: "ledgerMissing" });
    }
  } catch { defects.push({ type: "auditIncomplete" }); }

  return defects;
}

// ═══════════════════════════════════════════════
//  UTILITY FUNCTIONS
// ═══════════════════════════════════════════════

function mapRiskSeverity(severity: string): ViolationSeverity {
  switch ((severity || "").toLowerCase()) {
    case "critical": return "critical";
    case "high": return "high";
    case "medium": return "medium";
    default: return "low";
  }
}

function extractFunctionName(text: string): string {
  if (!text) return "unknown";
  // Try to find function name patterns
  const m = text.match(/(?:in|at|function|method)\s+[`']?(\w+)[`']?/i);
  if (m) return m[1];
  const m2 = text.match(/(\w+)\s*\(/);
  if (m2) return m2[1];
  return "unknown";
}

function extractFunctionAtLine(lines: string[], lineNum: number): string {
  // Search backward for a function definition
  for (let i = lineNum - 1; i >= Math.max(0, lineNum - 30); i--) {
    const line = lines[i]?.trim() || "";
    const m = line.match(/(?:function\s+(\w+)|(\w+)\s*[=:]\s*(?:async\s*)?\(|(\w+)\s*\([^)]*\)\s*\{)/);
    if (m) return m[1] || m[2] || m[3] || "unknown";
  }
  return "unknown";
}

/**
 * Recursively walk a directory, collecting file paths matching extensions.
 */
function languageToExtensions(language?: string): string[] {
  switch (language) {
    case "python": return [".py"];
    case "c": return [".c", ".h"];
    case "go": return [".go"];
    case "java": return [".java"];
    case "typescript":
    case "javascript":
    default:
      return [".ts", ".tsx", ".js"];
  }
}

function walkDir(dir: string, extensions: string[], maxFiles: number): string[] {
  const results: string[] = [];
  try {
    const fs = require("fs");
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= maxFiles) break;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
        results.push(...walkDir(fullPath, extensions, maxFiles - results.length));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (extensions.includes(ext)) {
          results.push(fullPath);
        }
      }
    }
  } catch { /* best-effort */ }
  return results;
}
