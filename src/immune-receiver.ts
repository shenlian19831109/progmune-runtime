/**
 * Immune Network Receiver — the missing half of the global immune network.
 *
 * Accepts external failure fingerprints (from remote instances or file imports),
 * deduplicates against local records, and merges them into the local corpus.
 *
 * This closes the "send-only" gap: immune-reporter.ts pushes out, this pulls in.
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// Fingerprint format — shared with immune-reporter.ts
interface ImmuneFingerprint {
  instance_id: string;
  timestamp: string;
  violatedSVL: string;
  constraintType: string;
  functionSequence: string[];
  preState?: string[];
  postState?: string[];
  count: number;
}

const CORPUS_DIR = path.resolve(__dirname, "..", ".progmune_corpus");
const RECEIVED_FILE = path.resolve(__dirname, "..", ".progmune_memory", "received_fingerprints.json");

/** Hash a fingerprint for deduplication. */
function hashFingerprint(fp: ImmuneFingerprint): string {
  const key = `${fp.instance_id}:${fp.timestamp}:${fp.violatedSVL}:${fp.constraintType}:${(fp.functionSequence || []).join(",")}`;
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 16);
}

/** Load the set of previously received fingerprint hashes. */
function getReceivedHashes(): Set<string> {
  try {
    if (fs.existsSync(RECEIVED_FILE)) {
      const raw = JSON.parse(fs.readFileSync(RECEIVED_FILE, "utf-8"));
      return new Set(raw.hashes || []);
    }
  } catch { /* receiver log may be unavailable */ }
  return new Set();
}

/** Save received fingerprint hashes. */
function saveReceivedHashes(hashes: Set<string>): void {
  const dir = path.dirname(RECEIVED_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(RECEIVED_FILE, JSON.stringify({
    hashes: [...hashes],
    updatedAt: new Date().toISOString(),
    total: hashes.size,
  }, null, 2));
}

/**
 * Import external fingerprints into the local failure corpus.
 * Deduplicates: each fingerprint is only imported once.
 *
 * @returns count of imported and skipped fingerprints.
 */
export function importFingerprints(
  fingerprints: ImmuneFingerprint[],
): { imported: number; skipped: number; total: number } {
  const received = getReceivedHashes();
  let imported = 0;
  let skipped = 0;

  for (const fp of fingerprints) {
    const hash = hashFingerprint(fp);
    if (received.has(hash)) {
      skipped++;
      continue;
    }

    // Write fingerprint into the corpus as a failure record
    const today = new Date().toISOString().slice(0, 10);
    const dateDir = path.join(CORPUS_DIR, today);
    if (!fs.existsSync(dateDir)) fs.mkdirSync(dateDir, { recursive: true });

    // Get next sequence number
    const seqFile = path.join(CORPUS_DIR, ".seq");
    let seq = 1;
    try {
      if (fs.existsSync(seqFile)) {
        seq = parseInt(fs.readFileSync(seqFile, "utf-8"), 10) + 1;
      }
    } catch { /* best-effort */ }

    const record = {
      intent: `[remote:${fp.instance_id}] ${fp.constraintType}`,
      functionPath: fp.functionSequence,
      violatedSVL: fp.violatedSVL,
      constraintType: fp.constraintType,
      preState: fp.preState,
      postState: fp.postState,
      fingerprintHash: hash,
      sourceInstance: fp.instance_id,
      sourceTimestamp: fp.timestamp,
      importedAt: new Date().toISOString(),
    };

    const fileName = `fail_${Date.now()}_${seq}.json`;
    fs.writeFileSync(path.join(dateDir, fileName), JSON.stringify(record, null, 2));

    // Update sequence
    fs.writeFileSync(seqFile, String(seq));

    received.add(hash);
    imported++;
  }

  saveReceivedHashes(received);
  return { imported, skipped, total: fingerprints.length };
}

/**
 * Import fingerprints from a JSON file (e.g., downloaded from the Hub).
 */
export function importFromFile(filePath: string): { imported: number; skipped: number; total: number } {
  if (!fs.existsSync(filePath)) {
    return { imported: 0, skipped: 0, total: 0 };
  }
  const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  const fingerprints: ImmuneFingerprint[] = Array.isArray(raw)
    ? raw
    : (raw.fingerprints || []);
  return importFingerprints(fingerprints);
}

/**
 * Get import statistics: how many external fingerprints have been received.
 */
export function getReceiverStats(): { totalReceived: number; lastUpdated: string | null } {
  const hashes = getReceivedHashes();
  let lastUpdated: string | null = null;
  try {
    if (fs.existsSync(RECEIVED_FILE)) {
      const raw = JSON.parse(fs.readFileSync(RECEIVED_FILE, "utf-8"));
      lastUpdated = raw.updatedAt || null;
    }
  } catch { /* best-effort */ }
  return { totalReceived: hashes.size, lastUpdated };
}
