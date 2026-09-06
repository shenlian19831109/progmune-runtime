/**
 * Phase 11: Policy Engine
 *
 * Evaluates policy rules against a certified file and its
 * supporting data (provenance chain, accountability chain, PLSB).
 * Returns ALLOW, WARN, or BLOCK.
 */

import * as fs from "fs";
import * as path from "path";
import type {
  PolicyRule,
  PolicyResult,
  PolicyConfig,
  EnterprisePolicyConfig,
  EnterpriseRule,
  RuleViolation,
} from "./types";
import { DEFAULT_POLICY } from "./types";
// 静态导入（vitest 环境下 lazy require 的 CJS 互操作不可靠——engine.ts
// 同款陷阱，2026-08-27 DSH 修复先例；两模块无环，静态导入安全）
import { assessRisk } from "../risk-model";
import { buildKnowledgeBase } from "../protocol-knowledge";

export interface PolicyContext {
  /** From certify() */
  certificate: {
    validated: boolean;
    confidence: "high" | "medium" | "low";
    provenanceIntact: boolean;
    fingerprint: string;
    violations: number;
    plsbCoverage: string;   // "X/Y"
    plsbRecall: number;
    degraded: boolean;
    sessionId: string;
    file: string;
    /** 证书签发时间戳（审计修复 2026-09-06：证书时效可核验） */
    timestamp?: string;
  };
  /** From buildAccountabilityChain() */
  accountability?: {
    humanEvents: number;
    aiEvents: number;
    automatedEvents: number;
    custodyGap: boolean;
  };
}

function confidenceToNumber(c: string): number {
  if (c === "high") return 2;
  if (c === "medium") return 1;
  return 0;
}

function parsePlsbCovered(coverage: string): number {
  const m = coverage.match(/^(\d+)\//);
  return m ? parseInt(m[1], 10) : 0;
}

/** Load policy from project config file, merged with defaults */
export function loadPolicyConfig(
  projectPath: string,
  configPath?: string
): { rules: PolicyRule[]; source: string; configError?: string } {
  const cfgFile = configPath
    ? path.resolve(configPath)
    : path.join(projectPath, ".progmune-policy.json");

  if (!fs.existsSync(cfgFile)) {
    return { rules: [...DEFAULT_POLICY], source: "built-in defaults" };
  }

  try {
    const cfg: PolicyConfig = JSON.parse(fs.readFileSync(cfgFile, "utf-8"));
    const inherit = cfg.inherit !== false; // default: inherit

    if (!inherit) {
      return { rules: cfg.rules || [...DEFAULT_POLICY], source: cfgFile };
    }

    // Merge: project rules override defaults by type
    const merged = [...DEFAULT_POLICY];
    for (const pr of cfg.rules || []) {
      const idx = merged.findIndex(dr => dr.type === pr.type);
      if (idx >= 0) {
        // Override existing rule
        merged[idx] = {
          type: merged[idx].type,
          severity: pr.severity || merged[idx].severity,
          description: pr.description || merged[idx].description,
          threshold: pr.threshold ?? merged[idx].threshold,
          require: pr.require ?? merged[idx].require,
        };
      } else {
        // Add new rule
        merged.push(pr);
      }
    }

    return { rules: merged, source: cfgFile };
  } catch (e: any) {
    // 审计修复（fail-closed 信号）：解析失败不再静默回退——显式携带
    // configError，由调用方（policy CLI / MCP）决定拒绝评估并报错
    console.error(`⚠️  Failed to load policy config: ${e.message}.`);
    return {
      rules: [...DEFAULT_POLICY],
      source: "built-in defaults (config error)",
      configError: `Failed to parse ${cfgFile}: ${e.message}`,
    };
  }
}

/** 真实调用提取（certificate.file 的 best-effort 词法扫描，供 risk 规则
 *  使用——不伪造输入；读不到文件时返回空数组，由调用方按 fail-closed
 *  计为违规） */
function extractCallsBestEffort(file: string): string[] {
  if (!file) return [];
  try {
    const fs = require("fs");
    const code = fs.readFileSync(file, "utf-8");
    const calls: string[] = [];
    const re = /(?<=^|[^\w$])([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(code)) !== null) {
      const seg = m[1].split(".").pop() || "";
      if (/^(if|for|while|switch|catch|return|new|case|do|super|this)$/.test(seg)) continue;
      if (calls.length < 200 && !calls.includes(seg)) calls.push(seg);
    }
    return calls;
  } catch {
    return [];
  }
}

export function evaluatePolicy(
  ctx: PolicyContext,
  rules?: PolicyRule[]
): PolicyResult {
  const activeRules = rules || DEFAULT_POLICY;
  const violations: RuleViolation[] = [];

  for (const rule of activeRules) {
    switch (rule.type) {
      // ── Confidence ──
      case "confidence": {
        const minLevel = rule.threshold ?? 1; // default: medium
        const actual = confidenceToNumber(ctx.certificate.confidence);
        if (actual < minLevel || ctx.certificate.degraded) {
          violations.push({
            rule,
            actual: ctx.certificate.degraded ? "degraded" : ctx.certificate.confidence,
            expected: `confidence >= ${minLevel === 2 ? "high" : "medium"}`,
            detail: ctx.certificate.degraded
              ? "This file was generated via a fallback/degraded path — reliability is reduced."
              : `Confidence is ${ctx.certificate.confidence}. Recommend re-generating with full validation.`,
          });
        }
        break;
      }

      // ── Provenance ──
      case "provenance": {
        if (!ctx.certificate.provenanceIntact) {
          violations.push({
            rule,
            actual: "broken",
            expected: "intact",
            detail: `Provenance chain for session ${ctx.certificate.sessionId} is broken — the ledger fingerprint has changed since generation.`,
          });
        }
        break;
      }

      // ── PLSB Coverage ──
      case "plsb_coverage": {
        const minCovered = rule.threshold ?? 5;
        const covered = parsePlsbCovered(ctx.certificate.plsbCoverage);
        if (covered < minCovered) {
          violations.push({
            rule,
            actual: `${covered} categories covered`,
            expected: `>= ${minCovered} categories`,
            detail: `PLSB covers ${ctx.certificate.plsbCoverage} categories. Add protocol rules for uncovered weakness types.`,
          });
        }
        break;
      }

      // ── Human Review ──
      case "human_review": {
        const minHumans = rule.require ?? 1;
        const humans = ctx.accountability?.humanEvents ?? 0;
        if (humans < minHumans) {
          violations.push({
            rule,
            actual: `${humans} human(s) in chain`,
            expected: `>= ${minHumans} human reviewer(s)`,
            detail: ctx.accountability?.custodyGap
              ? "Custody gaps detected — actor identities could not be verified."
              : "No human reviewer found in the accountability chain. Use --author, --reviewer flags.",
          });
        }
        break;
      }

      // ── Fingerprint ──
      case "fingerprint": {
        if (!ctx.certificate.fingerprint || ctx.certificate.fingerprint.includes("pending")) {
          violations.push({
            rule,
            actual: "no fingerprint",
            expected: "fingerprint registered",
            detail: "Run 'npm run check' to register missing fingerprints.",
          });
        }
        break;
      }

      // ── Risk-Based (Protocol-agnostic) ──
      case "risk": {
        const minSeverity = rule.threshold ?? 2;
        const minConfidence = rule.require ?? 70;
        try {
          // 真实调用提取（certificate.file 的 best-effort 词法扫描）——
          // 审计修复（Kimi 2026-09-06）：不再伪造 ["SSL_CTX_new","SSL_connect"]
          // 假输入喂评估；输入不可得时按 fail-closed 计为违规
          const calls = extractCallsBestEffort(ctx.certificate.file);
          if (calls.length === 0) {
            violations.push({
              rule,
              actual: "no call data extractable from certificate file",
              expected: "risk assessment over real call sequence",
              detail: "risk rule requires a readable file with calls; unavailable input is a violation (fail-closed)",
            });
          } else {
            const risk = assessRisk(calls);
            const criticalOrHigh = risk.patterns.filter((p: any) => {
              const sevOrder = ["Low", "Medium", "High", "Critical"];
              return sevOrder.indexOf(p.severity) >= minSeverity && p.confidence >= minConfidence;
            });
            if (criticalOrHigh.length > 0) {
              violations.push({
                rule,
                actual: `${criticalOrHigh.length} risk pattern(s) ≥ severity threshold`,
                expected: `0 patterns at this severity+confidence level`,
                detail: criticalOrHigh.map((p: any) => `${p.patternName} (${p.severity}, ${p.confidence}%): ${p.detail}`).join("; "),
              });
            }
          }
        } catch {
          // fail-closed：risk model 不可用 → 显式违规，而非静默跳过
          // （审计修复：原空 catch 使整条规则无声失效）
          violations.push({
            rule,
            actual: "risk model unavailable",
            expected: "risk assessment completed",
            detail: "risk-model module failed to load — failing closed (explicit violation)",
          });
        }
        break;
      }

      // ── Knowledge Base Coverage ──
      case "kb_coverage": {
        const minStable = rule.threshold ?? 3;
        let stableCount = 0;
        try {
          const kb = buildKnowledgeBase();
          stableCount = kb.units.filter((u: any) => u.maturity === "stable").length;
        } catch {
          // fail-closed 显式化（审计修复）：原空 catch 后 stableCount=0 恰好
          // 触发违规，但消息误导为「0 stable assets」——改为明确的不可用违规
          violations.push({
            rule,
            actual: "knowledge base unavailable",
            expected: `>= ${minStable} stable assets`,
            detail: "protocol-knowledge module failed to load — failing closed (explicit violation)",
          });
          break;
        }

        if (stableCount < minStable) {
          violations.push({
            rule,
            actual: `${stableCount} stable assets`,
            expected: `>= ${minStable} stable assets`,
            detail: `The Knowledge Base has ${stableCount} stable protocol assets. Need at least ${minStable} for production governance. Run 'npm run status' to see coverage.`,
          });
        }
        break;
      }

      // ── Violations ──
      case "violations": {
        const maxViolations = rule.threshold ?? 0;
        if (ctx.certificate.violations > maxViolations) {
          violations.push({
            rule,
            actual: `${ctx.certificate.violations} SSG violation(s)`,
            expected: `<= ${maxViolations}`,
            detail: `Ledger consistency check found ${ctx.certificate.violations} violation(s). Run 'progmune_repair' to fix.`,
          });
        }
        break;
      }
    }
  }

  // ── Compute verdict ──
  const blockViolations = violations.filter((v) => v.rule.severity === "block");
  const warnViolations = violations.filter((v) => v.rule.severity === "warn");

  let verdict: PolicyResult["verdict"];
  if (blockViolations.length > 0) {
    verdict = "BLOCK";
  } else if (warnViolations.length > 0) {
    verdict = "WARN";
  } else {
    verdict = "ALLOW";
  }

  const passed = activeRules.length - violations.length;

  let summary: string;
  if (verdict === "ALLOW") {
    summary = `✅ ALLOW — all ${activeRules.length} policy rules passed. Safe to deploy.`;
  } else if (verdict === "WARN") {
    summary = `⚠️ WARN — ${passed}/${activeRules.length} rules passed, ${warnViolations.length} warning(s). Review before deploy.`;
  } else {
    summary = `❌ BLOCK — ${blockViolations.length} blocking violation(s). Deployment is blocked until these are resolved.`;
  }

  return {
    passed: verdict !== "BLOCK",
    verdict,
    rules: activeRules.length,
    passed_rules: passed,
    failed_rules: violations.length,
    violations,
    summary,
  };
}

// ── Phase 1: Enterprise Policy Support ──

export interface LoadedEnterprisePolicy {
  policy: EnterprisePolicyConfig;
  source: string;
  rules: EnterpriseRule[];
  isEnterprise: boolean;
}

/**
 * Load policy configuration from a project's .progmune-policy.json.
 * Auto-detects enterprise format (has `enterprise` array with `id` fields)
 * vs legacy format (has `rules` array with `type` fields).
 *
 * For legacy format: returns isEnterprise=false, rules=[]
 * For enterprise format: returns parsed EnterpriseRule[] with policy_ref
 */
export function loadEnterprisePolicyConfig(
  projectPath: string,
  configPath?: string
): LoadedEnterprisePolicy {
  const cfgFile = configPath
    ? path.resolve(configPath)
    : path.join(projectPath, ".progmune-policy.json");

  const emptyResult: LoadedEnterprisePolicy = {
    policy: { rules: [...DEFAULT_POLICY] },
    source: "built-in defaults",
    rules: [],
    isEnterprise: false,
  };

  if (!fs.existsSync(cfgFile)) {
    return emptyResult;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(cfgFile, "utf-8"));

    // Auto-detect: enterprise format has `enterprise` array with `id` fields
    if (raw.enterprise && Array.isArray(raw.enterprise) && raw.enterprise.length > 0) {
      const first = raw.enterprise[0];
      if (first.id && first.policy_ref) {
        const policy: EnterprisePolicyConfig = {
          version: raw.version || "1.0",
          name: raw.name,
          description: raw.description,
          rules: raw.rules || [...DEFAULT_POLICY],
          inherit: raw.inherit,
          dimensions: raw.dimensions,
          enterprise: raw.enterprise,
        };
        return {
          policy,
          source: cfgFile,
          rules: raw.enterprise as EnterpriseRule[],
          isEnterprise: true,
        };
      }
    }

    // Fallback: treat as legacy format
    const policy: EnterprisePolicyConfig = {
      version: raw.version,
      name: raw.name,
      description: raw.description,
      rules: raw.rules || [...DEFAULT_POLICY],
      inherit: raw.inherit,
      dimensions: raw.dimensions,
    };
    return {
      policy,
      source: cfgFile,
      rules: [],
      isEnterprise: false,
    };
  } catch (e: any) {
    console.error(`⚠️  Failed to load enterprise policy config: ${e.message}. Using defaults.`);
    return emptyResult;
  }
}
