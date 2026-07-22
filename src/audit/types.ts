/**
 * Phase 9: Governance Report Types
 *
 * Structured data model for the AI Code Governance Report.
 * Every field maps to data already present in .progmune_corpus/.
 */

import type { LedgerConsistencyViolation } from "../ssg-validator";

// ── Metadata ──

export interface GovernanceMetadata {
  generator: string;             // "progmune-runtime"
  version: string;               // runtime version
  timestamp: string;             // ISO 8601
  projectId: string;             // hash of project path
  validator: string;             // "SSG + Ledger + PLSB"
}

// ── Sessions ──

export interface SessionVerdict {
  sessionId: string;
  intent: string;
  transitionCount: number;
  validTransitions: number;
  invalidTransitions: number;
  fingerprintVerified: boolean;
  fingerprintTampered: boolean;
  consistencyPassed: boolean;
  violations: number;
}

export interface SessionsSection {
  total: number;
  verified: number;
  compromised: number;
  details: SessionVerdict[];
}

// ── SSV (Semantic State Verification) ──

export interface SSVSection {
  totalChecks: number;
  passed: number;
  failed: number;
  byCategory: Record<string, { total: number; passed: number; failed: number }>;
  violations: LedgerConsistencyViolation[];
}

// ── PLSB ──

export interface PLSBSection {
  version: string;
  totalEntries: number;
  verifiedEntries: number;
  coverage: number;              // matchedCategories / totalCategories
  recall: number;                // detected / total
  precision: number;             // categoryMatched / detected
  matchedCategories: string[];
  unmatchedCategories: string[];
}

// ── Provenance ──

export interface ProvenanceSection {
  totalFingerprints: number;
  verified: number;
  tampered: number;
  notFound: number;
}

// ── Antibodies ──

export interface AntibodiesSection {
  totalHits: number;
  fastPathHits: number;
  llmCallsSaved: number;
  tokensSaved: number;
  topSignatures: string[];
  byLevel: Record<string, { hits: number; tokensSaved: number }>;
}

// ── Recommendations ──

export interface GovernanceRecommendation {
  severity: "critical" | "high" | "medium" | "low";
  category: "provenance" | "ssv" | "plsb" | "coverage" | "antibodies";
  message: string;
  action: string;
}

// ── Business Translation (Phase 10: CTO-readable Trust Report) ──

export interface BusinessRisk {
  category: string;
  description: string;
  protocolsCovered: number;
  violationsPrevented: number;
  status: "protected" | "partial" | "exposed";
}

export interface KnowledgeDomain {
  domain: string;
  coverage: "full" | "partial" | "none";
  protocols: string[];
  entities?: string[];
}

export interface ProtocolEdge {
  from: string;
  to: string;
  label: string;
  verified: boolean;
  description?: string;
}

export interface BusinessTranslationSection {
  risks: BusinessRisk[];
  knowledgeCoverage: KnowledgeDomain[];
  protocolGraph: ProtocolEdge[];
  summary: {
    totalRisksMitigated: number;
    knowledgeDomainsCovered: number;
    businessProtocolsIntact: number;
    preventedViolationsByCategory: Record<string, number>;
  };
}

// ── Main Report ──

export type GovernanceVerdict = "PASS" | "WARN" | "FAIL";

export interface GovernanceReport {
  metadata: GovernanceMetadata;
  sessions: SessionsSection;
  ssv: SSVSection;
  plsb: PLSBSection;
  provenance: ProvenanceSection;
  antibodies: AntibodiesSection;
  verdict: GovernanceVerdict;
  recommendations: GovernanceRecommendation[];
  business?: BusinessTranslationSection;  // Phase 10: optional, default-on with --no-business to disable
}
