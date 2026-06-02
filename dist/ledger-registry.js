"use strict";
/**
 * Phase 4: Ledger Fingerprint Registry (P0)
 *
 * Execution Certificate = session + ledgerHash + ruleHash + timestamp.
 * Answers: "Has this session been tampered with? Have the rules changed?"
 *
 * Does NOT do: previousHash chains, blockchain-style verification, multi-node sync.
 * Those are for Phase 5+ when distributed execution is needed.
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
exports.registerFingerprint = registerFingerprint;
exports.getFingerprint = getFingerprint;
exports.getFingerprintRegistry = getFingerprintRegistry;
exports.verifyFingerprint = verifyFingerprint;
exports.verifyAllFingerprints = verifyAllFingerprints;
exports.registerAllMissingFingerprints = registerAllMissingFingerprints;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const ssg_validator_1 = require("./ssg-validator");
// ── Storage ──
function fingerprintsDir() {
    const projectDir = process.env.PROGMUNE_PROJECT_DIR || process.cwd();
    return path.resolve(projectDir, ".progmune_corpus/fingerprints");
}
function fingerprintPath(sessionId) {
    return path.join(fingerprintsDir(), `${sessionId}.json`);
}
// ── Core API ──
/** Register a ledger fingerprint (execution certificate).
 *  Called after a session is recorded — creates an immutable proof of the ledger state. */
/** Register a ledger fingerprint as an execution certificate. */
/** @requires LEDGER_DATA @produces FINGERPRINT */
function registerFingerprint(sessionId, transitions, ruleHash) {
    const dir = fingerprintsDir();
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    const fingerprint = {
        sessionId,
        ledgerHash: (0, ssg_validator_1.hashLedger)(transitions),
        ruleHash,
        transitionCount: transitions.length,
        timestamp: Date.now(),
    };
    fs.writeFileSync(fingerprintPath(sessionId), JSON.stringify(fingerprint, null, 2), "utf-8");
    return fingerprint;
}
/** Get a single stored fingerprint by sessionId. Returns null if not registered. */
/** Get a stored ledger fingerprint by session ID. */
/** @requires SESSION_ID @produces FINGERPRINT */
function getFingerprint(sessionId) {
    const fpPath = fingerprintPath(sessionId);
    if (!fs.existsSync(fpPath))
        return null;
    try {
        return JSON.parse(fs.readFileSync(fpPath, "utf-8"));
    }
    catch {
        return null;
    }
}
/** List all registered fingerprints, sorted by timestamp (oldest first). */
/** List all registered ledger fingerprints. */
function getFingerprintRegistry() {
    const dir = fingerprintsDir();
    if (!fs.existsSync(dir))
        return [];
    const fingerprints = [];
    for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith(".json"))
            continue;
        try {
            const fp = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));
            if (fp.sessionId && fp.ledgerHash) {
                fingerprints.push(fp);
            }
        }
        catch {
            // Skip corrupted fingerprint files
        }
    }
    return fingerprints.sort((a, b) => a.timestamp - b.timestamp);
}
/** Verify a single session's fingerprint.
 *  Requires the session's transitions to re-hash and compare. */
/** Verify a single ledger fingerprint against current data. */
function verifyFingerprint(sessionId, transitions, currentRuleHash) {
    const stored = getFingerprint(sessionId);
    if (!stored) {
        return {
            sessionId,
            valid: false,
            stored: { sessionId, ledgerHash: "", ruleHash: "", transitionCount: 0, timestamp: 0 },
            tampered: true,
        };
    }
    const result = {
        sessionId,
        valid: true,
        stored,
        tampered: false,
    };
    if (transitions && transitions.length > 0) {
        result.currentHash = (0, ssg_validator_1.hashLedger)(transitions);
        if (result.currentHash !== stored.ledgerHash) {
            result.valid = false;
            result.tampered = true;
        }
    }
    if (currentRuleHash && currentRuleHash !== stored.ruleHash) {
        result.currentRuleHash = currentRuleHash;
        // Rule hash mismatch doesn't mean tampering — rules may have legitimately changed
        result.valid = false;
    }
    return result;
}
/** Verify all registered fingerprints.
 *  Loads each session to re-hash and compare against the stored fingerprint. */
/** Verify all registered ledger fingerprints and return tampered status. */
/** @requires FINGERPRINT_DATA @produces VERIFICATION_RESULT */
/** @requires FINGERPRINT_DATA @produces VERIFICATION_RESULT */
function verifyAllFingerprints(currentRuleHash) {
    const fingerprints = getFingerprintRegistry();
    const results = [];
    let valid = 0;
    let tampered = 0;
    let notFound = 0;
    const sessionsDir = path.resolve(process.env.PROGMUNE_PROJECT_DIR || process.cwd(), ".progmune_corpus/sessions");
    for (const fp of fingerprints) {
        // Try to load the session file
        const sessionFile = path.join(sessionsDir, `${fp.sessionId}.json`);
        if (!fs.existsSync(sessionFile)) {
            notFound++;
            results.push({
                sessionId: fp.sessionId,
                valid: false,
                stored: fp,
                tampered: false,
            });
            continue;
        }
        try {
            const session = JSON.parse(fs.readFileSync(sessionFile, "utf-8"));
            let allTransitions = [];
            for (const attempt of (session.attempts || [])) {
                allTransitions = allTransitions.concat(attempt.transitions || []);
            }
            const result = verifyFingerprint(fp.sessionId, allTransitions, currentRuleHash);
            results.push(result);
            if (result.valid) {
                valid++;
            }
            else if (result.tampered) {
                tampered++;
            }
        }
        catch {
            notFound++;
            results.push({
                sessionId: fp.sessionId,
                valid: false,
                stored: fp,
                tampered: false,
            });
        }
    }
    return {
        total: fingerprints.length,
        verified: results,
        valid,
        tampered,
        notFound,
    };
}
/** Register fingerprints for all sessions that don't yet have one.
 *  Called during `npm run check` to ensure all sessions are fingerprinted. */
/** Register fingerprints for all sessions that lack them. */
/** @requires SESSION_DATA @produces FINGERPRINT_DATA */
function registerAllMissingFingerprints() {
    const sessionsDir = path.resolve(process.env.PROGMUNE_PROJECT_DIR || process.cwd(), ".progmune_corpus/sessions");
    if (!fs.existsSync(sessionsDir))
        return 0;
    let registered = 0;
    for (const file of fs.readdirSync(sessionsDir)) {
        if (!file.endsWith(".json"))
            continue;
        try {
            const session = JSON.parse(fs.readFileSync(path.join(sessionsDir, file), "utf-8"));
            const sessionId = session.sessionId;
            if (!sessionId)
                continue;
            // Skip if already fingerprinted
            const existing = getFingerprint(sessionId);
            if (existing && existing.ledgerHash)
                continue;
            let allTransitions = [];
            let ruleHash = "";
            for (const attempt of (session.attempts || [])) {
                allTransitions = allTransitions.concat(attempt.transitions || []);
                if (!ruleHash && (attempt.ruleHash || session.ruleHash)) {
                    ruleHash = attempt.ruleHash || session.ruleHash;
                }
            }
            if (allTransitions.length === 0)
                continue;
            // Fall back to hashRules from existing info if no ruleHash found
            if (!ruleHash) {
                ruleHash = session.ruleHash || "unknown";
            }
            registerFingerprint(sessionId, allTransitions, ruleHash);
            registered++;
        }
        catch {
            // Skip unreadable session files
        }
    }
    return registered;
}
