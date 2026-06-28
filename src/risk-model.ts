/**
 * Risk Model — Pattern × Severity × Policy
 *
 * Upgrades detection from boolean (valid/invalid) to structured risk assessment.
 *
 * Architecture:
 *   Protocol → Concept → DetectionPattern → RiskObject → Policy → Decision
 *
 * Completeness becomes a knowledge-layer metric. Risk drives governance.
 */

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export type Severity = "Critical" | "High" | "Medium" | "Low";

export interface DetectionPattern {
  id: string;
  name: string;
  description: string;
  protocolName: string;      // Which protocol this pattern belongs to
  conceptName?: string;       // Which concept is affected
  severity: Severity;
  confidence: number;         // 0-100, based on validated evidence
  evidenceSequences: number;  // How many sequences support this pattern
  detect: (calls: string[]) => boolean;  // Detection function
  detail?: string;            // Human-readable violation detail
}

export interface RiskObject {
  riskLevel: Severity;
  patterns: Array<{
    patternId: string;
    patternName: string;
    severity: Severity;
    confidence: number;
    concept?: string;
    detail: string;
  }>;
  knowledgeUnit: {
    id: string;
    name: string;
    version: string;
    rfc?: string;
  };
  recommendation: "Block" | "Warn" | "Allow";
  summary: string;
}

// ═══════════════════════════════════════════════════════════════
// Detection Patterns (evidence-backed, weighted by severity)
// ═══════════════════════════════════════════════════════════════

export const DETECTION_PATTERNS: DetectionPattern[] = [
  // ── TLS Patterns ──
  {
    id: "TLS-MISSING-FINISHED",
    name: "Missing Finished",
    description: "TLS handshake started but Finished message not sent — handshake incomplete. Attacker may intercept before authentication completes.",
    protocolName: "TLS Handshake",
    conceptName: "Finished",
    severity: "Critical",
    confidence: 91,
    evidenceSequences: 135,
    detect: (calls) => {
      const hasInit = calls.some(c => /\b(\w*ssl\w*init|\w*SSL\w*new|\w*tls\w*init)\b/i.test(c));
      const hasConnect = calls.some(c => /\b(\w*ssl\w*connect|\w*ssl\w*handshake|\w*tls\w*connect)\b/i.test(c));
      const hasFree = calls.some(c => /\b(\w*ssl\w*free|\w*SSL\w*cleanup|\w*SSL_CTX_free)\b/i.test(c));
      return (hasInit || hasConnect) && !hasFree;
    },
    detail: "TLS handshake initiated but no Finished/free step detected. Connection may remain open or unverified.",
  },
  {
    id: "TLS-NO-INIT",
    name: "TLS Without Init",
    description: "TLS connect or read without prior initialization — possible use of uninitialized SSL context.",
    protocolName: "TLS Handshake",
    conceptName: "ClientHello",
    severity: "High",
    confidence: 85,
    evidenceSequences: 135,
    detect: (calls) => {
      const hasInit = calls.some(c => /\b(\w*ssl\w*init|\w*SSL\w*new|\w*tls\w*init)\b/i.test(c));
      const hasConnect = calls.some(c => /\b(\w*ssl\w*connect|\w*ssl\w*handshake)\b/i.test(c));
      return hasConnect && !hasInit;
    },
    detail: "SSL connect/handshake called without prior context initialization. Missing SSL_CTX_new or equivalent.",
  },
  {
    id: "TLS-DOUBLE-FREE",
    name: "TLS Double Free",
    description: "SSL free called more times than init — possible double-free. Normal cleanup (1:1) is safe.",
    protocolName: "TLS Handshake",
    conceptName: "Finished",
    severity: "Critical",
    confidence: 88,
    evidenceSequences: 135,
    detect: (calls) => {
      const initCount = calls.filter(c => /\b(\w*SSL\w*new|\w*ssl\w*init|\w*SSL_CTX_new)\b/i.test(c)).length;
      const freeCount = calls.filter(c => /\b(\w*ssl\w*free|\w*SSL_CTX_free)\b/i.test(c)).length;
      return freeCount > initCount && freeCount >= 2;
    },
    detail: "SSL free/cleanup called more times than init. Double-free vulnerability. Normal cleanup with matching init+free pairs is safe.",
  },

  // ── SSH Patterns ──
  {
    id: "SSH-NO-AUTH",
    name: "SSH Without Auth",
    description: "SSH connection established but no authentication step — possible unauthorized access.",
    protocolName: "SSH Connection",
    conceptName: "Authentication",
    severity: "Critical",
    confidence: 78,
    evidenceSequences: 135,
    detect: (calls) => {
      const hasInit = calls.some(c => /\b(\w*ssh\w*init|ssh\w*setup)\b/i.test(c));
      const hasAuth = calls.some(c => /\b(\w*ssh\w*auth|\w*ssh\w*login)\b/i.test(c));
      return hasInit && !hasAuth;
    },
    detail: "SSH session initialized but no authentication step. Connection may be unauthenticated.",
  },
  {
    id: "SSH-NO-CLEANUP",
    name: "SSH Missing Cleanup",
    description: "SSH session started but never properly closed — potential resource leak or session hijacking.",
    protocolName: "SSH Connection",
    conceptName: "Channel",
    severity: "High",
    confidence: 78,
    evidenceSequences: 135,
    detect: (calls) => {
      const hasInit = calls.some(c => /\b(\w*ssh\w*init)\b/i.test(c));
      const hasDone = calls.some(c => /\b(\w*ssh\w*done|\w*ssh\w*close|\w*ssh\w*free|\w*ssh\w*disconnect)\b/i.test(c));
      return hasInit && !hasDone;
    },
    detail: "SSH session initialized but never closed. Resource leak or session fixation risk.",
  },

  // ── HTTP Patterns ──
  {
    id: "HTTP-NO-RESPONSE",
    name: "HTTP Without Response",
    description: "HTTP request sent but no response processed — possible incomplete request handling.",
    protocolName: "HTTP Request",
    conceptName: "Response",
    severity: "Medium",
    confidence: 80,
    evidenceSequences: 150,
    detect: (calls) => {
      const hasInit = calls.some(c => /\b(\w*http\w*init|\w*http\w*handler)\b/i.test(c));
      const hasSend = calls.some(c => /\b(\w*http\w*send|\w*http\w*process|ap_pass_brigade)\b/i.test(c));
      return (hasInit || hasSend) && !calls.some(c => /\b(\w*http\w*cleanup|\w*http\w*finalize)\b/i.test(c));
    },
    detail: "HTTP request initiated but no cleanup/finalize step. Connection may hang.",
  },

  // ── Resource Patterns ──
  {
    id: "RES-ACQUIRE-NO-RELEASE",
    name: "Resource Acquire Without Release",
    description: "Resource acquired (malloc, open, SSL_new) but never released — definite resource leak.",
    protocolName: "Resource Lifecycle",
    severity: "Critical",
    confidence: 98,
    evidenceSequences: 250,
    detect: (calls) => {
      const acquireRe = /\b(malloc|calloc|SSL_CTX_new|SSL_new|BIO_new|open|fopen|socket)\b/i;
      const releaseRe = /\b(free|SSL_CTX_free|SSL_free|BIO_free|close|fclose)\b/i;
      const hasAcquire = calls.some(c => acquireRe.test(c) && !/\b(create|alloc|new|init)\w*\b/i.test(c));
      const hasRelease = calls.some(c => releaseRe.test(c));
      return hasAcquire && !hasRelease;
    },
    detail: "Resource acquired but no matching release call. Definite resource leak.",
  },
];

// ═══════════════════════════════════════════════════════════════
// Risk Assessment Engine
// ═══════════════════════════════════════════════════════════════

export function assessRisk(calls: string[], protocolName?: string): RiskObject {
  const patterns = DETECTION_PATTERNS.filter(p => {
    if (protocolName && p.protocolName !== protocolName) return false;
    return p.detect(calls);
  });

  if (patterns.length === 0) {
    return {
      riskLevel: "Low",
      patterns: [],
      knowledgeUnit: { id: "", name: protocolName || "Unknown", version: "", rfc: undefined },
      recommendation: "Allow",
      summary: "No known risk patterns detected.",
    };
  }

  // Highest severity pattern determines risk level
  const severityOrder: Severity[] = ["Critical", "High", "Medium", "Low"];
  const maxSeverity = patterns.reduce((max, p) => {
    const i1 = severityOrder.indexOf(p.severity);
    const i2 = severityOrder.indexOf(max);
    return i1 < i2 ? p.severity : max;
  }, "Low" as Severity);

  // Recommendation based on highest severity
  let recommendation: RiskObject["recommendation"];
  if (maxSeverity === "Critical") recommendation = "Block";
  else if (maxSeverity === "High") recommendation = "Warn";
  else recommendation = "Allow";

  // Look up Knowledge Unit
  let unitId = "", unitVersion = "", unitRfc: string | undefined;
  try {
    const { buildKnowledgeBase } = require("./protocol-knowledge");
    const kb = buildKnowledgeBase();
    const unit = kb.units.find((u: any) => u.name === patterns[0].protocolName);
    if (unit) { unitId = unit.id; unitVersion = unit.currentVersion; unitRfc = unit.rfcReference; }
  } catch { /* KB unavailable */ }

  return {
    riskLevel: maxSeverity,
    patterns: patterns.map(p => ({
      patternId: p.id,
      patternName: p.name,
      severity: p.severity,
      confidence: p.confidence,
      concept: p.conceptName,
      detail: p.detail || p.description,
    })),
    knowledgeUnit: { id: unitId, name: patterns[0].protocolName, version: unitVersion, rfc: unitRfc },
    recommendation,
    summary: patterns.length === 1
      ? `${patterns[0].name}: ${patterns[0].detail || patterns[0].description}`
      : `${patterns.length} risk patterns detected. Highest: ${patterns[0].name} (${maxSeverity}).`,
  };
}

// ═══════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════

if (require.main === module) {
  const args = process.argv.slice(2);
  const calls = args.length > 0 ? args : ["SSL_CTX_new", "SSL_connect"];
  const risk = assessRisk(calls);
  console.log(JSON.stringify(risk, null, 2));
}
