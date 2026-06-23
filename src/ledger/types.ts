/**
 * Phase 9: Ledger Provenance Types
 * Phase 10: Accountability Ledger Types
 *
 * End-to-end provenance + accountability tracking for AI-generated code.
 * Every step identifies WHO acted, not just WHAT happened.
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

// ── Phase 10: Accountability Types ──

/** Who or what performed an action in the AI code supply chain */
export type ActorType =
  | "human"       // A person — developer, reviewer, security engineer
  | "llm"         // An AI model — Claude, GPT, DeepSeek
  | "validator"   // Automated verification — Progmune SSG
  | "reviewer"    // Human reviewer who approved
  | "deployer";   // CI/CD system or human who deployed

/** An accountability event identifies WHO acted, not just the role */
export interface AccountabilityEvent {
  index: number;
  step: ProvenanceStep;
  timestamp: string;          // ISO 8601
  actorId: string;            // Identifiable identity (email, model ID, system ID)
  actorType: ActorType;       // Role classification
  actorLabel: string;         // Human-readable label (e.g., "Alice (alice@example.com)")
  artifact: string;           // What was acted upon
  action: string;             // What was done
  hash: string;               // SHA-256 of this event
  prevHash: string;           // Hash of previous event (chain link)
  result: "passed" | "failed" | "repaired" | "approved";
  signature?: string;         // Cryptographic signature (when available)
  detail?: string;
}

/** Full accountability chain — from human intent through AI generation to deployment */
export interface AccountabilityChain {
  sessionId: string;
  intent: string;
  events: AccountabilityEvent[];
  chainHash: string;          // Root hash — tampering breaks this
  integrity: ProvenanceIntegrity;
  custodyGap: boolean;        // True if any link in the chain has unverified actor identity
  totalEvents: number;
  humanEvents: number;        // Events with human actors
  aiEvents: number;           // Events with LLM actors
  automatedEvents: number;    // Events with validator/deployer actors
}

