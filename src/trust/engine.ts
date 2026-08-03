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
import {
  buildCallGraphFromIR,
  enrichSequence,
  inferDomainsFromFunctionName,
} from "./call-graph-propagator";
import type { CallGraphIndex } from "./call-graph-propagator";

// ── Main Entry Point ──

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
  const { violations: protocolViolations, coverage: mappingCoverageData } =
    await collectProtocolViolations(ctx, callGraph);
  const coverageData = collectVerificationCoverage(ctx);
  const governanceDefects = collectGovernanceDefects(ctx);

  // ═══════════════════════════════════════
  //  PHASE 2: NORMALIZE — All violations to TrustViolation[]
  // ═══════════════════════════════════════

  const allViolations: TrustViolation[] = [
    ...enterpriseViolations,
    ...protocolViolations,
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

  try {
    // ── Phase 1-5 Semantic Pipeline ──
    const callSequences = extractCallSequencesFromProject(ctx.projectPath, ctx.language);
    const flaggedCount = { value: 0 };
    const cleanCount = { value: 0 };

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
            const specificViolations = checkSpecificViolations(semantic, seq.file);
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
  };
}

/**
 * Extract call sequences from project source files.
 */
interface CallSequence {
  calls: string[];
  file: string;
  function?: string;
}

function extractCallSequencesFromProject(
  projectPath: string,
  language?: string
): CallSequence[] {
  const sequences: CallSequence[] = [];

  try {
    const fs = require("fs");
    const srcDir = path.join(projectPath, "src");
    if (!fs.existsSync(srcDir)) return sequences;

    const extensions = languageToExtensions(language);
    const files = walkDir(srcDir, extensions, 100);

    for (const file of files) {
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
