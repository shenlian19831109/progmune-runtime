"use strict";
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
exports.buildAccountabilityChain = buildAccountabilityChain;
exports.verifyAccountabilityChain = verifyAccountabilityChain;
const crypto = __importStar(require("crypto"));
const chain_builder_1 = require("./chain-builder");
const signatures_1 = require("./signatures");
// ── Core Builder ──
function shortHash(data) {
    return crypto.createHash("sha256").update(data).digest("hex").slice(0, 16);
}
function hashAccountabilityEvent(index, actorId, actorType, step, artifact, prevHash, timestamp, result) {
    return shortHash(`${index}|${actorId}|${actorType}|${step}|${artifact}|${prevHash}|${timestamp}|${result}`);
}
function computeActorType(provEvent) {
    const actor = provEvent.actor || "";
    if (actor === "human")
        return "human";
    if (actor === "llm")
        return "llm";
    if (actor === "validator" || actor === "system")
        return "validator";
    if (actor === "planner")
        return "llm"; // planner = LLM-driven
    if (actor === "antibody")
        return "validator"; // antibody = automated
    return "validator";
}
function computeActorLabel(provEvent, options) {
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
function buildAccountabilityChain(sessionId, options = {}) {
    // 1. Build the underlying provenance chain
    const provChain = (0, chain_builder_1.buildProvenanceChain)(sessionId);
    // 2. Convert each provenance event to an accountability event
    const events = [];
    let prevHash = "";
    const custodyGaps = [];
    for (const provEvent of provChain.events) {
        const { actorId, actorType, actorLabel } = computeActorLabel(provEvent, options);
        const action = describeAction(provEvent);
        const eventHash = hashAccountabilityEvent(provEvent.index, actorId, actorType, provEvent.step, provEvent.artifact, prevHash, provEvent.timestamp, provEvent.result);
        // Check custody gap: any event without verified actor identity
        const hasGap = actorId.startsWith("unknown:") ||
            (actorType === "human" && !options.author && !options.approver);
        custodyGaps.push(hasGap);
        // Try to sign the event
        let signature;
        try {
            const payload = (0, signatures_1.buildSignPayload)(provEvent.index, actorId, provEvent.step, provEvent.artifact, provEvent.timestamp, provEvent.result, prevHash);
            const sigResult = (0, signatures_1.trySign)(actorId, payload);
            if (sigResult)
                signature = sigResult.signature;
        }
        catch { /* signing is best-effort */ }
        const aev = {
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
            signature,
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
            if (events[i].step === "validation" || events[i].step === "repair") {
                valIdx = i;
                break;
            }
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
    const autoEvents = events.filter((e) => e.actorType === "validator" || e.actorType === "deployer").length;
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
function describeAction(ev) {
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
function makeHumanEvent(role, human, prevHash, index) {
    const step = role === "author" ? "generation" : role === "reviewer" ? "approval" : "approval";
    const timestamp = new Date().toISOString();
    const eventHash = hashAccountabilityEvent(index, human.id, "human", step, `intent: ${human.role}`, prevHash, timestamp, "approved");
    return {
        index,
        step: step,
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
function recomputeChainHashes(events) {
    let ph = "";
    for (let i = 0; i < events.length; i++) {
        events[i].index = i;
        events[i].prevHash = ph;
        events[i].hash = hashAccountabilityEvent(i, events[i].actorId, events[i].actorType, events[i].step, events[i].artifact, ph, events[i].timestamp, events[i].result);
        ph = events[i].hash;
    }
}
function computeAccountabilityChainHash(events) {
    return shortHash(events.map((e) => e.hash).join(""));
}
// ── Verify accountability chain integrity ──
function verifyAccountabilityChain(chain) {
    let ph = "";
    let unsignedCount = 0;
    let signedCount = 0;
    for (const e of chain.events) {
        // 1. Verify hash chain
        const recomputed = hashAccountabilityEvent(e.index, e.actorId, e.actorType, e.step, e.artifact, ph, e.timestamp, e.result);
        if (recomputed !== e.hash) {
            return {
                valid: false,
                brokenAt: e.index,
                detail: `Hash mismatch at event ${e.index}: expected ${recomputed}, got ${e.hash}`,
                unsignedCount, signedCount,
            };
        }
        // 2. Verify signature (if present)
        if (e.signature) {
            try {
                const { verifySignature, loadPublicKey } = require("./signatures");
                const payload = (0, signatures_1.buildSignPayload)(e.index, e.actorId, e.step, e.artifact, e.timestamp, e.result, e.prevHash);
                const pubKey = loadPublicKey(e.actorId);
                if (pubKey) {
                    const verification = verifySignature(payload, e.signature, pubKey);
                    e.signatureVerified = verification.valid;
                    if (!verification.valid) {
                        return {
                            valid: false,
                            brokenAt: e.index,
                            detail: `Signature verification failed at event ${e.index}: ${verification.detail}`,
                            unsignedCount, signedCount,
                        };
                    }
                }
                signedCount++;
            }
            catch { /* skip signature check if verification fails */ }
        }
        else {
            unsignedCount++;
        }
        ph = e.hash;
    }
    if (computeAccountabilityChainHash(chain.events) !== chain.chainHash) {
        return { valid: false, detail: "Chain root hash mismatch", unsignedCount, signedCount };
    }
    return { valid: true, unsignedCount, signedCount };
}
