"use strict";
/**
 * Phase 9: Provenance Chain Builder
 *
 * Constructs an end-to-end provenance chain for a session.
 * Reads session data from the corpus and builds a timeline of
 * every generation, validation, repair, and deployment event.
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
exports.buildProvenanceChain = buildProvenanceChain;
const crypto = __importStar(require("crypto"));
function shortHash(data) {
    return crypto.createHash("sha256").update(data).digest("hex").slice(0, 16);
}
/** Compute event hash = SHA256(index + step + artifact + prevHash + timestamp + result) */
function hashEvent(index, step, artifact, prevHash, timestamp, result) {
    return shortHash(`${index}|${step}|${artifact}|${prevHash}|${timestamp}|${result}`);
}
/** Compute chain root hash = SHA256(all event hashes concatenated) */
function computeChainHash(events) {
    return shortHash(events.map((e) => e.hash).join(""));
}
function buildProvenanceChain(sessionId) {
    // Load session
    const { getAllSessions } = require("../failure-corpus");
    const sessions = getAllSessions();
    const session = sessions.find((s) => s.sessionId === sessionId || s.sessionId?.startsWith(sessionId));
    if (!session) {
        throw new Error(`Session not found: ${sessionId}`);
    }
    const events = [];
    let allTransitions = [];
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
                result: result,
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
                result: result,
                detail: hasViolations
                    ? `${attempt.violations.length} violation(s): ${attempt.violations.map((v) => v.description).join("; ")}`
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
    }
    catch { /* no fingerprint */ }
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
    const integrity = fingerprintMatch && chainSelfCheck ? "intact" : "broken";
    const validTrans = allTransitions.filter((t) => t.valid !== false).length;
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
