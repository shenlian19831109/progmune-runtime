/**
 * Phase 9: Ledger Provenance Types
 *
 * End-to-end provenance tracking for AI-generated code.
 * Every step in the code lifecycle has a cryptographically-verifiable event.
 */

export type ProvenanceStep =
  | "generation"
  | "validation"
  | "repair"
  | "approval"
  | "deploy";

export interface ProvenanceEvent {
  index: number;            // Position in chain (0-based)
  step: ProvenanceStep;
  timestamp: string;        // ISO 8601
  actor: string;            // "planner" | "llm" | "human" | "antibody" | "system"
  artifact: string;         // function name or file path
  hash: string;             // SHA-256 of this event's content
  prevHash: string;         // Hash of previous event (links to prior event; "" for index 0)
  result: "passed" | "failed" | "repaired" | "approved";
  detail?: string;
}

export type ProvenanceIntegrity = "intact" | "broken";

export interface ProvenanceChain {
  sessionId: string;
  intent: string;
  events: ProvenanceEvent[];
  chainHash: string;        // Root hash — SHA-256 of all event hashes concatenated. Any tampering breaks this.
  integrity: ProvenanceIntegrity;
  finalLedgerHash: string;
  storedFingerprintHash: string;
  totalTransitions: number;
  validTransitions: number;
  invalidTransitions: number;
  repairCount: number;
}
