/**
 * Phase 10: Accountability Ledger
 *
 * Builds an actor-attributed chain of custody on top of the
 * provenance chain. Maps technical events to accountable actors,
 * identifies custody gaps, and computes the full AI supply chain
 * from human intent through AI generation to production deployment.
 *
 * Usage:
 *   buildAccountabilityChain(sessionId, humanActor?)
 */

import * as crypto from "crypto";
import { buildProvenanceChain } from "./chain-builder";
import type {
  AccountabilityChain,
  AccountabilityEvent,
  ActorType,
  ProvenanceChain,
  ProvenanceEvent,
  ProvenanceIntegrity,
} from "./types";

// ── Human Actor Identity ──

export interface HumanActor {
  id: string;           // Email, username, or system ID
  name: string;         // Display name
  role: string;         // "developer" | "reviewer" | "security_engineer"
}

export interface BuildOptions {
  /** The human who initiated the code generation */
  author?: HumanActor;
  /** The human(s) who reviewed the generated code */
  reviewers?: HumanActor[];
  /** The human or system that approved deployment */
  approver?: HumanActor;
  /** The CI/CD system that deployed */
  deployer?: { id: string; name: string };
}

// ── Core Builder ──

function shortHash(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex").slice(0, 16);
}

function hashAccountabilityEvent(
  index: number,
  actorId: string,
  actorType: string,
  step: string,
  artifact: string,
  prevHash: string,
  timestamp: string,
  result: string
): string {
  return shortHash(
    `${index}|${actorId}|${actorType}|${step}|${artifact}|${prevHash}|${timestamp}|${result}`
  );
}

function computeActorType(provEvent: ProvenanceEvent): ActorType {
  const actor = provEvent.actor || "";
  if (actor === "human") return "human";
  if (actor === "llm") return "llm";
  if (actor === "validator" || actor === "system") return "validator";
  if (actor === "planner") return "llm";       // planner = LLM-driven
  if (actor === "antibody") return "validator"; // antibody = automated
  return "validator";
}

function computeActorLabel(
  provEvent: ProvenanceEvent,
  options: BuildOptions
): { actorId: string; actorType: ActorType; actorLabel: string } {
  const step = provEvent.step;
  const actor = provEvent.actor || "";
  const timestamp = provEvent.timestamp || "";

  // Human actors from options
  if (step === "generation" && options.author) {
    return {
      actorId: options.author.id,
      actorType: "human",
      actorLabel: `${options.author.name} (${options.author.id}, ${options.author.role})`,
    };
  }
  if (step === "approval" && options.approver) {
    return {
      actorId: options.approver.id,
      actorType: "reviewer",
      actorLabel: `${options.approver.name} (${options.approver.id}, approved)`,
    };
  }
  if (step === "deploy" && options.deployer) {
    return {
      actorId: options.deployer.id,
      actorType: "deployer",
      actorLabel: `${options.deployer.name} (${options.deployer.id})`,
    };
  }

  // Fallback: infer from provenance actor string
  const actorType = computeActorType(provEvent);
  let actorId = "";
  let actorLabel = "";

  switch (actorType) {
    case "llm":
      actorId = `llm:${actor}@${timestamp.slice(0, 10)}`;
      actorLabel = `${actor} (LLM)`;
      break;
    case "validator":
      actorId = `system:progmune-ssg@${timestamp.slice(0, 10)}`;
      actorLabel = `Progmune Validator (SSG)`;
      break;
    case "human":
      actorId = `human:${actor}@${timestamp.slice(0, 10)}`;
      actorLabel = `${actor} (Human)`;
      break;
    case "reviewer":
      actorId = `reviewer:${actor}@${timestamp.slice(0, 10)}`;
      actorLabel = `${actor} (Reviewer)`;
      break;
    case "deployer":
      actorId = `deployer:${actor}@${timestamp.slice(0, 10)}`;
      actorLabel = `${actor} (Deployer)`;
      break;
    default:
      actorId = `unknown:${actor}@${timestamp.slice(0, 10)}`;
      actorLabel = `${actor}`;
  }

  return { actorId, actorType, actorLabel };
}

// ── Main Entry Point ──

export function buildAccountabilityChain(
  sessionId: string,
  options: BuildOptions = {}
): AccountabilityChain {
  // 1. Build the underlying provenance chain
  const provChain: ProvenanceChain = buildProvenanceChain(sessionId);

  // 2. Convert each provenance event to an accountability event
  const events: AccountabilityEvent[] = [];
  let prevHash = "";
  const custodyGaps: boolean[] = [];

  for (const provEvent of provChain.events) {
    const { actorId, actorType, actorLabel } = computeActorLabel(provEvent, options);
    const action = describeAction(provEvent);

    const eventHash = hashAccountabilityEvent(
      provEvent.index,
      actorId,
      actorType,
      provEvent.step,
      provEvent.artifact,
      prevHash,
      provEvent.timestamp,
      provEvent.result
    );

    // Check custody gap: any event without verified actor identity
    const hasGap =
      actorId.startsWith("unknown:") ||
      (actorType === "human" && !options.author && !options.approver);

    custodyGaps.push(hasGap);

    const aev: AccountabilityEvent = {
      index: provEvent.index,
      step: provEvent.step,
      timestamp: provEvent.timestamp,
      actorId,
      actorType,
      actorLabel,
      artifact: provEvent.artifact,
      action,
      hash: eventHash,
      prevHash,
      result: provEvent.result,
      detail: provEvent.detail,
    };

    events.push(aev);
    prevHash = eventHash;
  }

  // 3. Add explicit human events from options (if not already in chain)
  if (options.author && events.length > 0) {
    // Prepend human author event
    const humanEvent = makeHumanEvent("author", options.author, events[0].hash, events.length);
    events.unshift(humanEvent);
    // Recompute hashes forward
    recomputeChainHashes(events);
  }

  if (options.reviewers && events.length > 0) {
    // Insert reviewer events after validation
    let valIdx = -1;
    for (let i = events.length - 1; i >= 0; i--) {
      if (events[i].step === "validation" || events[i].step === "repair") { valIdx = i; break; }
    }
    const insertIdx = valIdx >= 0 ? valIdx + 1 : events.length;
    for (const reviewer of options.reviewers) {
      const prev = insertIdx > 0 ? events[insertIdx - 1].hash : "";
      const re = makeHumanEvent("reviewer", reviewer, prev, insertIdx);
      events.splice(insertIdx, 0, re);
    }
    recomputeChainHashes(events);
  }

  if (options.approver && events.length > 0) {
    // Add approval event before deploy
    const depIdx = events.findIndex((e) => e.step === "deploy");
    const insertIdx = depIdx >= 0 ? depIdx : events.length;
    const prev = insertIdx > 0 ? events[insertIdx - 1].hash : "";
    const ae = makeHumanEvent("approver", options.approver, prev, insertIdx);
    events.splice(insertIdx, 0, ae);
    recomputeChainHashes(events);
  }

  // 4. Compute chain hash and stats
  const chainHash = computeAccountabilityChainHash(events);

  const humanEvents = events.filter((e) => e.actorType === "human" || e.actorType === "reviewer").length;
  const aiEvents = events.filter((e) => e.actorType === "llm").length;
  const autoEvents = events.filter(
    (e) => e.actorType === "validator" || e.actorType === "deployer"
  ).length;

  const hasGap = custodyGaps.some(Boolean);

  return {
    sessionId: provChain.sessionId,
    intent: provChain.intent,
    events,
    chainHash,
    integrity: provChain.integrity,
    custodyGap: hasGap,
    totalEvents: events.length,
    humanEvents,
    aiEvents,
    automatedEvents: autoEvents,
  };
}

// ── Helpers ──

function describeAction(ev: ProvenanceEvent): string {
  switch (ev.step) {
    case "generation":
      return `Generated ${ev.artifact}`;
    case "validation":
      return `Validated ${ev.artifact}`;
    case "repair":
      return `Repaired ${ev.artifact}`;
    case "approval":
      return `Approved ${ev.artifact}`;
    case "deploy":
      return `Deployed ${ev.artifact}`;
    default:
      return ev.step;
  }
}

function makeHumanEvent(
  role: string,
  human: HumanActor,
  prevHash: string,
  index: number
): AccountabilityEvent {
  const step = role === "author" ? "generation" : role === "reviewer" ? "approval" : "approval";
  const timestamp = new Date().toISOString();
  const eventHash = hashAccountabilityEvent(
    index, human.id, "human", step, `intent: ${human.role}`, prevHash, timestamp, "approved"
  );

  return {
    index,
    step: step as AccountabilityEvent["step"],
    timestamp,
    actorId: human.id,
    actorType: role === "author" ? "human" : "reviewer",
    actorLabel: `${human.name} (${human.id}, ${human.role})`,
    artifact: `Intent from ${human.name}`,
    action: role === "author" ? "Initiated code generation"
      : role === "reviewer" ? "Reviewed and approved"
      : "Approved deployment",
    hash: eventHash,
    prevHash,
    result: "approved",
  };
}

function recomputeChainHashes(events: AccountabilityEvent[]): void {
  let ph = "";
  for (let i = 0; i < events.length; i++) {
    events[i].index = i;
    events[i].prevHash = ph;
    events[i].hash = hashAccountabilityEvent(
      i,
      events[i].actorId,
      events[i].actorType,
      events[i].step,
      events[i].artifact,
      ph,
      events[i].timestamp,
      events[i].result
    );
    ph = events[i].hash;
  }
}

function computeAccountabilityChainHash(events: AccountabilityEvent[]): string {
  return shortHash(events.map((e) => e.hash).join(""));
}

// ── Verify accountability chain integrity ──

export function verifyAccountabilityChain(
  chain: AccountabilityChain
): { valid: boolean; brokenAt?: number; detail?: string } {
  let ph = "";
  for (const e of chain.events) {
    const recomputed = hashAccountabilityEvent(
      e.index, e.actorId, e.actorType, e.step, e.artifact, ph, e.timestamp, e.result
    );
    if (recomputed !== e.hash) {
      return {
        valid: false,
        brokenAt: e.index,
        detail: `Hash mismatch at event ${e.index}: expected ${recomputed}, got ${e.hash}`,
      };
    }
    ph = e.hash;
  }
  if (computeAccountabilityChainHash(chain.events) !== chain.chainHash) {
    return { valid: false, detail: "Chain root hash mismatch" };
  }
  return { valid: true };
}
