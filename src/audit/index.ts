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
} from "./types";
