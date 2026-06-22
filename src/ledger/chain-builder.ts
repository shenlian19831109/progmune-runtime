/**
 * Phase 9: Provenance Chain Builder
 *
 * Constructs an end-to-end provenance chain for a session.
 * Reads session data from the corpus and builds a timeline of
 * every generation, validation, repair, and deployment event.
 */

import * as crypto from "crypto";
import type {
  ProvenanceChain,
  ProvenanceEvent,
  ProvenanceIntegrity,
} from "./types";

function shortHash(data: string): string {
  return crypto.createHash("sha256").update(data).digest("hex").slice(0, 16);
}

/** Compute event hash = SHA256(index + step + artifact + prevHash + timestamp + result) */
function hashEvent(
  index: number,
  step: string,
  artifact: string,
  prevHash: string,
  timestamp: string,
  result: string
): string {
  return shortHash(`${index}|${step}|${artifact}|${prevHash}|${timestamp}|${result}`);
}

/** Compute chain root hash = SHA256(all event hashes concatenated) */
function computeChainHash(events: Array<{ hash: string }>): string {
  return shortHash(events.map((e) => e.hash).join(""));
}

export function buildProvenanceChain(sessionId: string): ProvenanceChain {
  // Load session
  const { getAllSessions } = require("../failure-corpus");
  const sessions: any[] = getAllSessions();
  const session = sessions.find(
    (s: any) => s.sessionId === sessionId || s.sessionId?.startsWith(sessionId)
  );

  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const events: ProvenanceEvent[] = [];
  let allTransitions: any[] = [];
  let repairCount = 0;
  let prevHash = ""; // Genesis block — first event has empty prevHash

  for (const attempt of session.attempts || []) {
    const trans = attempt.transitions || [];
    const ts = new Date(attempt.timestamp || Date.now()).toISOString();

    // Generation events — one per transition
    for (const t of trans) {
      const fn = t.function || "unknown";
      const result = t.valid !== false ? "passed" : "failed";
      const eventHash = hashEvent(events.length, "generation", fn, prevHash, ts, result);
      events.push({
        index: events.length,
        step: "generation",
        timestamp: ts,
        actor: attempt.plannerSeed?.includes("fallback") ? "planner" : "llm",
        artifact: fn,
        hash: eventHash,
        prevHash,
        result: result as "passed" | "failed",
        detail: t.valid !== false ? undefined : "SSG protocol violation",
      });
      prevHash = eventHash;
    }

    // Validation event — per attempt
    if (trans.length > 0) {
      const hasViolations = (attempt.violations || []).length > 0;
      const result = hasViolations ? "failed" : "passed";
      const eventHash = hashEvent(events.length, "validation", `${trans.length} transitions`, prevHash, ts, result);
      events.push({
        index: events.length,
        step: "validation",
        timestamp: ts,
        actor: attempt.plannerSeed?.includes("fallback") ? "planner" : "validator",
        artifact: `${trans.length} transitions`,
        hash: eventHash,
        prevHash,
        result: result as "passed" | "failed",
        detail: hasViolations
          ? `${attempt.violations.length} violation(s): ${attempt.violations.map((v: any) => v.description).join("; ")}`
          : "All constraints satisfied",
      });
      prevHash = eventHash;
    }

    // Repair events
    if (attempt.outcome === "constraint_violation" && attempt.violations?.length > 0) {
      for (const v of attempt.violations || []) {
        const eventHash = hashEvent(events.length, "repair", v.violatedConstraint || "unknown", prevHash, ts, "repaired");
        events.push({
          index: events.length,
          step: "repair",
          timestamp: ts,
          actor: "planner",
          artifact: v.violatedConstraint || "unknown",
          hash: eventHash,
          prevHash,
          result: "repaired",
          detail: `SVL-${v.svl || "?"}: ${v.description || ""}`,
        });
        prevHash = eventHash;
        repairCount++;
      }
    }

    allTransitions = allTransitions.concat(trans);
  }

  // Deploy event (fingerprint registration)
  let storedHash = "";
  try {
    const { getFingerprint } = require("../ledger-registry");
    const fp = getFingerprint(session.sessionId);
    if (fp) {
      storedHash = fp.ledgerHash || "";
      const ts = new Date(fp.timestamp || Date.now()).toISOString();
      const eventHash = hashEvent(events.length, "deploy", `fingerprint: ${fp.ledgerHash?.slice(0, 12)}`, prevHash, ts, "approved");
      events.push({
        index: events.length,
        step: "deploy",
        timestamp: ts,
        actor: "system",
        artifact: `fingerprint: ${fp.ledgerHash?.slice(0, 12)}`,
        hash: eventHash,
        prevHash,
        result: "approved",
        detail: `${fp.transitionCount} transitions registered`,
      });
      prevHash = eventHash;
    }
  } catch { /* no fingerprint */ }

  // Compute chain hash — root hash covering all events
  const chainHash = computeChainHash(events);

  // Compute integrity: check both fingerprint match and chain self-consistency
  const finalHash = shortHash(JSON.stringify(allTransitions));
  const fingerprintMatch = !storedHash || storedHash === finalHash;

  // Self-check: recompute chain and verify it matches
  let chainSelfCheck = true;
  let checkPrev = "";
  for (const e of events) {
    const recomputed = hashEvent(e.index, e.step, e.artifact, checkPrev, e.timestamp, e.result);
    if (recomputed !== e.hash) {
      chainSelfCheck = false;
      break;
    }
    checkPrev = e.hash;
  }

  const integrity: ProvenanceIntegrity =
    fingerprintMatch && chainSelfCheck ? "intact" : "broken";

  const validTrans = allTransitions.filter((t: any) => t.valid !== false).length;

  return {
    sessionId: session.sessionId,
    intent: session.intent || "",
    events,
    chainHash,
    integrity,
    finalLedgerHash: finalHash,
    storedFingerprintHash: storedHash,
    totalTransitions: allTransitions.length,
    validTransitions: validTrans,
    invalidTransitions: allTransitions.length - validTrans,
    repairCount,
  };
}
