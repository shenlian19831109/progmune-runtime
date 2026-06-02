/**
 * Phase 4: Ledger Fingerprint Registry (P0)
 *
 * Execution Certificate = session + ledgerHash + ruleHash + timestamp.
 * Answers: "Has this session been tampered with? Have the rules changed?"
 *
 * Does NOT do: previousHash chains, blockchain-style verification, multi-node sync.
 * Those are for Phase 5+ when distributed execution is needed.
 */

import * as fs from "fs";
import * as path from "path";
import { hashLedger } from "./ssg-validator";
import type { StateTransition } from "./runtime-types";

// ── Types ──

export interface LedgerFingerprint {
  sessionId: string;
  ledgerHash: string;        // hashLedger(transitions)
  ruleHash: string;          // rule set hash at time of recording
  transitionCount: number;
  timestamp: number;
}

export interface FingerprintVerifyResult {
  sessionId: string;
  valid: boolean;
  stored: LedgerFingerprint;
  currentHash?: string;       // re-computed hash (if ledger available)
  currentRuleHash?: string;   // re-computed rule hash (if available)
  tampered: boolean;          // stored hash ≠ re-computed hash
}

export interface RegistrySummary {
  total: number;
  verified: FingerprintVerifyResult[];
  valid: number;
  tampered: number;
  notFound: number;           // fingerprint exists but session file missing
}

// ── Storage ──

function fingerprintsDir(): string {
  const projectDir = process.env.PROGMUNE_PROJECT_DIR || process.cwd();
  return path.resolve(projectDir, ".progmune_corpus/fingerprints");
}

function fingerprintPath(sessionId: string): string {
  return path.join(fingerprintsDir(), `${sessionId}.json`);
}

// ── Core API ──

/** Register a ledger fingerprint (execution certificate).
 *  Called after a session is recorded — creates an immutable proof of the ledger state. */
/** Register a ledger fingerprint as an execution certificate. */
/** @requires LEDGER_DATA @produces FINGERPRINT */
export function registerFingerprint(
  sessionId: string,
  transitions: StateTransition[],
  ruleHash: string
): LedgerFingerprint {
  const dir = fingerprintsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const fingerprint: LedgerFingerprint = {
    sessionId,
    ledgerHash: hashLedger(transitions),
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
export function getFingerprint(sessionId: string): LedgerFingerprint | null {
  const fpPath = fingerprintPath(sessionId);
  if (!fs.existsSync(fpPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(fpPath, "utf-8"));
  } catch {
    return null;
  }
}

/** List all registered fingerprints, sorted by timestamp (oldest first). */
/** List all registered ledger fingerprints. */
export function getFingerprintRegistry(): LedgerFingerprint[] {
  const dir = fingerprintsDir();
  if (!fs.existsSync(dir)) return [];
  const fingerprints: LedgerFingerprint[] = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    try {
      const fp = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));
      if (fp.sessionId && fp.ledgerHash) {
        fingerprints.push(fp as LedgerFingerprint);
      }
    } catch {
      // Skip corrupted fingerprint files
    }
  }
  return fingerprints.sort((a, b) => a.timestamp - b.timestamp);
}

/** Verify a single session's fingerprint.
 *  Requires the session's transitions to re-hash and compare. */
/** Verify a single ledger fingerprint against current data. */
export function verifyFingerprint(
  sessionId: string,
  transitions?: StateTransition[],
  currentRuleHash?: string
): FingerprintVerifyResult {
  const stored = getFingerprint(sessionId);
  if (!stored) {
    return {
      sessionId,
      valid: false,
      stored: { sessionId, ledgerHash: "", ruleHash: "", transitionCount: 0, timestamp: 0 },
      tampered: true,
    };
  }

  const result: FingerprintVerifyResult = {
    sessionId,
    valid: true,
    stored,
    tampered: false,
  };

  if (transitions && transitions.length > 0) {
    result.currentHash = hashLedger(transitions);
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
export function verifyAllFingerprints(currentRuleHash?: string): RegistrySummary {
  const fingerprints = getFingerprintRegistry();
  const results: FingerprintVerifyResult[] = [];
  let valid = 0;
  let tampered = 0;
  let notFound = 0;

  const sessionsDir = path.resolve(
    process.env.PROGMUNE_PROJECT_DIR || process.cwd(),
    ".progmune_corpus/sessions"
  );

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
      let allTransitions: StateTransition[] = [];
      for (const attempt of (session.attempts || [])) {
        allTransitions = allTransitions.concat(attempt.transitions || []);
      }

      const result = verifyFingerprint(fp.sessionId, allTransitions, currentRuleHash);
      results.push(result);
      if (result.valid) {
        valid++;
      } else if (result.tampered) {
        tampered++;
      }
    } catch {
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
export function registerAllMissingFingerprints(): number {
  const sessionsDir = path.resolve(
    process.env.PROGMUNE_PROJECT_DIR || process.cwd(),
    ".progmune_corpus/sessions"
  );
  if (!fs.existsSync(sessionsDir)) return 0;

  let registered = 0;
  for (const file of fs.readdirSync(sessionsDir)) {
    if (!file.endsWith(".json")) continue;
    try {
      const session = JSON.parse(fs.readFileSync(path.join(sessionsDir, file), "utf-8"));
      const sessionId = session.sessionId;
      if (!sessionId) continue;

      // Skip if already fingerprinted
      const existing = getFingerprint(sessionId);
      if (existing && existing.ledgerHash) continue;

      let allTransitions: StateTransition[] = [];
      let ruleHash = "";
      for (const attempt of (session.attempts || [])) {
        allTransitions = allTransitions.concat(attempt.transitions || []);
        if (!ruleHash && (attempt.ruleHash || session.ruleHash)) {
          ruleHash = attempt.ruleHash || session.ruleHash;
        }
      }
      if (allTransitions.length === 0) continue;

      // Fall back to hashRules from existing info if no ruleHash found
      if (!ruleHash) {
        ruleHash = session.ruleHash || "unknown";
      }

      registerFingerprint(sessionId, allTransitions, ruleHash);
      registered++;
    } catch {
      // Skip unreadable session files
    }
  }
  return registered;
}
