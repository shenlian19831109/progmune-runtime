/**
 * Phase 9: Governance Audit Module
 *
 * Public API for AI Code Governance Reports.
 * Re-exports the builder, types, and formatters.
 */

export { buildGovernanceReport } from "./report-builder";
export { formatAsJSON } from "./formatters/json";
export { formatAsTerminal } from "./formatters/terminal";
export { formatAsMarkdown } from "./formatters/markdown";
export { formatAsHTML } from "./formatters/html";
export type {
  GovernanceReport,
  GovernanceMetadata,
  GovernanceVerdict,
  GovernanceRecommendation,
  SessionsSection,
  SSVSection,
  PLSBSection,
  ProvenanceSection,
  AntibodiesSection,
  SessionVerdict,
  BusinessRisk,
  KnowledgeDomain,
  ProtocolEdge,
  BusinessTranslationSection,
} from "./types";

export {
  translateToBusinessRisks,
  getKnowledgeCoverage,
  getProtocolGraph,
  buildBusinessSummary,
} from "./business-translator";

export type {
  BusinessTranslationSummary,
} from "./business-translator";
