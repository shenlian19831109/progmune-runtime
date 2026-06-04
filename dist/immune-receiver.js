"use strict";
/**
 * Immune Network Receiver — the missing half of the global immune network.
 *
 * Accepts external failure fingerprints (from remote instances or file imports),
 * deduplicates against local records, and merges them into the local corpus.
 *
 * This closes the "send-only" gap: immune-reporter.ts pushes out, this pulls in.
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
exports.importFingerprints = importFingerprints;
exports.importFromFile = importFromFile;
exports.getReceiverStats = getReceiverStats;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
const CORPUS_DIR = path.resolve(__dirname, "..", ".progmune_corpus");
const RECEIVED_FILE = path.resolve(__dirname, "..", ".progmune_memory", "received_fingerprints.json");
/** Hash a fingerprint for deduplication. */
function hashFingerprint(fp) {
    const key = `${fp.instance_id}:${fp.timestamp}:${fp.violatedSVL}:${fp.constraintType}:${(fp.functionSequence || []).join(",")}`;
    return crypto.createHash("sha256").update(key).digest("hex").slice(0, 16);
}
/** Load the set of previously received fingerprint hashes. */
function getReceivedHashes() {
    try {
        if (fs.existsSync(RECEIVED_FILE)) {
            const raw = JSON.parse(fs.readFileSync(RECEIVED_FILE, "utf-8"));
            return new Set(raw.hashes || []);
        }
    }
    catch { /* receiver log may be unavailable */ }
    return new Set();
}
/** Save received fingerprint hashes. */
function saveReceivedHashes(hashes) {
    const dir = path.dirname(RECEIVED_FILE);
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
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
function importFingerprints(fingerprints) {
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
        if (!fs.existsSync(dateDir))
            fs.mkdirSync(dateDir, { recursive: true });
        // Get next sequence number
        const seqFile = path.join(CORPUS_DIR, ".seq");
        let seq = 1;
        try {
            if (fs.existsSync(seqFile)) {
                seq = parseInt(fs.readFileSync(seqFile, "utf-8"), 10) + 1;
            }
        }
        catch { /* best-effort */ }
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
function importFromFile(filePath) {
    if (!fs.existsSync(filePath)) {
        return { imported: 0, skipped: 0, total: 0 };
    }
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const fingerprints = Array.isArray(raw)
        ? raw
        : (raw.fingerprints || []);
    return importFingerprints(fingerprints);
}
/**
 * Get import statistics: how many external fingerprints have been received.
 */
function getReceiverStats() {
    const hashes = getReceivedHashes();
    let lastUpdated = null;
    try {
        if (fs.existsSync(RECEIVED_FILE)) {
            const raw = JSON.parse(fs.readFileSync(RECEIVED_FILE, "utf-8"));
            lastUpdated = raw.updatedAt || null;
        }
    }
    catch { /* best-effort */ }
    return { totalReceived: hashes.size, lastUpdated };
}
