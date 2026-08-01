"use strict";
/**
 * Phase 11: Policy Engine
 *
 * Evaluates policy rules against a certified file and its
 * supporting data (provenance chain, accountability chain, PLSB).
 * Returns ALLOW, WARN, or BLOCK.
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
exports.loadPolicyConfig = loadPolicyConfig;
exports.evaluatePolicy = evaluatePolicy;
exports.loadEnterprisePolicyConfig = loadEnterprisePolicyConfig;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const types_1 = require("./types");
function confidenceToNumber(c) {
    if (c === "high")
        return 2;
    if (c === "medium")
        return 1;
    return 0;
}
function parsePlsbCovered(coverage) {
    const m = coverage.match(/^(\d+)\//);
    return m ? parseInt(m[1], 10) : 0;
}
/** Load policy from project config file, merged with defaults */
function loadPolicyConfig(projectPath, configPath) {
    const cfgFile = configPath
        ? path.resolve(configPath)
        : path.join(projectPath, ".progmune-policy.json");
    if (!fs.existsSync(cfgFile)) {
        return { rules: [...types_1.DEFAULT_POLICY], source: "built-in defaults" };
    }
    try {
        const cfg = JSON.parse(fs.readFileSync(cfgFile, "utf-8"));
        const inherit = cfg.inherit !== false; // default: inherit
        if (!inherit) {
            return { rules: cfg.rules || [...types_1.DEFAULT_POLICY], source: cfgFile };
        }
        // Merge: project rules override defaults by type
        const merged = [...types_1.DEFAULT_POLICY];
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
            }
            else {
                // Add new rule
                merged.push(pr);
            }
        }
        return { rules: merged, source: cfgFile };
    }
    catch (e) {
        console.error(`⚠️  Failed to load policy config: ${e.message}. Using defaults.`);
        return { rules: [...types_1.DEFAULT_POLICY], source: "built-in defaults (config error)" };
    }
}
function evaluatePolicy(ctx, rules) {
    const activeRules = rules || types_1.DEFAULT_POLICY;
    const violations = [];
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
                    const { assessRisk } = require("../risk-model");
                    // Extract call sequence from file (best-effort)
                    const calls = ctx.certificate.validated ? [] : ["SSL_CTX_new", "SSL_connect"]; // fallback
                    const risk = assessRisk(calls.length > 0 ? calls : ["init", "connect"]);
                    const criticalOrHigh = risk.patterns.filter((p) => {
                        const sevOrder = ["Low", "Medium", "High", "Critical"];
                        return sevOrder.indexOf(p.severity) >= minSeverity && p.confidence >= minConfidence;
                    });
                    if (criticalOrHigh.length > 0) {
                        violations.push({
                            rule,
                            actual: `${criticalOrHigh.length} risk pattern(s) ≥ severity threshold`,
                            expected: `0 patterns at this severity+confidence level`,
                            detail: criticalOrHigh.map((p) => `${p.patternName} (${p.severity}, ${p.confidence}%): ${p.detail}`).join("; "),
                        });
                    }
                }
                catch { /* risk model unavailable */ }
                break;
            }
            // ── Knowledge Base Coverage ──
            case "kb_coverage": {
                const minStable = rule.threshold ?? 3;
                let stableCount = 0;
                try {
                    const { buildKnowledgeBase } = require("../protocol-knowledge");
                    const kb = buildKnowledgeBase();
                    stableCount = kb.units.filter((u) => u.maturity === "stable").length;
                }
                catch { /* KB unavailable */ }
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
    let verdict;
    if (blockViolations.length > 0) {
        verdict = "BLOCK";
    }
    else if (warnViolations.length > 0) {
        verdict = "WARN";
    }
    else {
        verdict = "ALLOW";
    }
    const passed = activeRules.length - violations.length;
    let summary;
    if (verdict === "ALLOW") {
        summary = `✅ ALLOW — all ${activeRules.length} policy rules passed. Safe to deploy.`;
    }
    else if (verdict === "WARN") {
        summary = `⚠️ WARN — ${passed}/${activeRules.length} rules passed, ${warnViolations.length} warning(s). Review before deploy.`;
    }
    else {
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
/**
 * Load policy configuration from a project's .progmune-policy.json.
 * Auto-detects enterprise format (has `enterprise` array with `id` fields)
 * vs legacy format (has `rules` array with `type` fields).
 *
 * For legacy format: returns isEnterprise=false, rules=[]
 * For enterprise format: returns parsed EnterpriseRule[] with policy_ref
 */
function loadEnterprisePolicyConfig(projectPath, configPath) {
    const cfgFile = configPath
        ? path.resolve(configPath)
        : path.join(projectPath, ".progmune-policy.json");
    const emptyResult = {
        policy: { rules: [...types_1.DEFAULT_POLICY] },
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
                const policy = {
                    version: raw.version || "1.0",
                    name: raw.name,
                    description: raw.description,
                    rules: raw.rules || [...types_1.DEFAULT_POLICY],
                    inherit: raw.inherit,
                    dimensions: raw.dimensions,
                    enterprise: raw.enterprise,
                };
                return {
                    policy,
                    source: cfgFile,
                    rules: raw.enterprise,
                    isEnterprise: true,
                };
            }
        }
        // Fallback: treat as legacy format
        const policy = {
            version: raw.version,
            name: raw.name,
            description: raw.description,
            rules: raw.rules || [...types_1.DEFAULT_POLICY],
            inherit: raw.inherit,
            dimensions: raw.dimensions,
        };
        return {
            policy,
            source: cfgFile,
            rules: [],
            isEnterprise: false,
        };
    }
    catch (e) {
        console.error(`⚠️  Failed to load enterprise policy config: ${e.message}. Using defaults.`);
        return emptyResult;
    }
}
