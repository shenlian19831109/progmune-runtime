"use strict";
/**
 * Phase 12: Ed25519 Signatures for Accountability Events
 *
 * Cryptographic proof that a specific actor performed a specific action.
 * Uses Node.js built-in crypto (Ed25519 since Node 12+).
 *
 * Each actor has a key pair. Events are signed by the actor's private key.
 * Verification proves: "actor X signed event Y at time Z".
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
exports.generateKeyPair = generateKeyPair;
exports.loadPublicKey = loadPublicKey;
exports.hasKey = hasKey;
exports.ensureKey = ensureKey;
exports.signEvent = signEvent;
exports.verifySignature = verifySignature;
exports.buildSignPayload = buildSignPayload;
exports.trySign = trySign;
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// ═══════════════════════════════════════════════════════════════
// Key Management
// ═══════════════════════════════════════════════════════════════
const KEYS_DIR = ".progmune_keys";
function keysDir() {
    const projectDir = process.env.PROGMUNE_PROJECT_DIR || process.cwd();
    return path.resolve(projectDir, KEYS_DIR);
}
function keyPath(actorId) {
    return path.join(keysDir(), `${sanitizeFilename(actorId)}.json`);
}
function sanitizeFilename(id) {
    return id.replace(/[^a-zA-Z0-9_@.-]/g, "_").slice(0, 64);
}
/** Generate a new Ed25519 key pair for an actor */
function generateKeyPair(actorId, actorType) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519", {
        publicKeyEncoding: { type: "spki", format: "der" },
        privateKeyEncoding: { type: "pkcs8", format: "der" },
    });
    const kp = {
        publicKey: publicKey.toString("hex"),
        privateKey: privateKey.toString("hex"),
        actorId,
        actorType,
        createdAt: new Date().toISOString(),
    };
    // Auto-save to .progmune_keys/
    const dir = keysDir();
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
    // Only save public info + type; private key stored separately
    fs.writeFileSync(keyPath(actorId) + ".pub", JSON.stringify({ actorId, actorType, publicKey: kp.publicKey, createdAt: kp.createdAt }, null, 2), "utf-8");
    return kp;
}
/** Load public key for an actor */
function loadPublicKey(actorId) {
    const pubPath = keyPath(actorId) + ".pub";
    try {
        const data = JSON.parse(fs.readFileSync(pubPath, "utf-8"));
        return data.publicKey || null;
    }
    catch {
        return null;
    }
}
/** Check if a key exists for an actor */
function hasKey(actorId) {
    return loadPublicKey(actorId) !== null;
}
/** Load or generate a key for an actor */
function ensureKey(actorId, actorType) {
    const existingPub = loadPublicKey(actorId);
    if (existingPub) {
        return {
            publicKey: existingPub,
            privateKey: "", // Private key not stored in .pub file
            actorId,
            actorType,
            createdAt: "",
        };
    }
    return generateKeyPair(actorId, actorType);
}
// ═══════════════════════════════════════════════════════════════
// Signing & Verification
// ═══════════════════════════════════════════════════════════════
/**
 * Sign a payload with a private key.
 * Returns the hex-encoded Ed25519 signature + public key for verification.
 */
function signEvent(payload, privateKey) {
    const privKeyObj = crypto.createPrivateKey({
        key: Buffer.from(privateKey, "hex"),
        format: "der",
        type: "pkcs8",
    });
    const pubKeyObj = crypto.createPublicKey(privKeyObj);
    const pubKeyDer = pubKeyObj.export({ type: "spki", format: "der" });
    const signature = crypto.sign(null, Buffer.from(payload, "utf-8"), privKeyObj);
    return {
        signature: signature.toString("hex"),
        publicKey: pubKeyDer.toString("hex"),
        actorId: "",
        algorithm: "ed25519",
    };
}
/**
 * Verify an Ed25519 signature against a payload and public key.
 */
function verifySignature(payload, signature, publicKey) {
    try {
        const pubKeyObj = crypto.createPublicKey({
            key: Buffer.from(publicKey, "hex"),
            format: "der",
            type: "spki",
        });
        const sigBuffer = Buffer.from(signature, "hex");
        const valid = crypto.verify(null, Buffer.from(payload, "utf-8"), pubKeyObj, sigBuffer);
        return {
            valid,
            actorId: "",
            publicKey,
            detail: valid ? undefined : "Signature verification failed — data may have been tampered.",
        };
    }
    catch (e) {
        return {
            valid: false,
            actorId: "",
            publicKey,
            detail: `Verification error: ${e.message}`,
        };
    }
}
/**
 * Build the payload string that gets signed for an accountability event.
 * Deterministic: reconstructable from the event data alone.
 */
function buildSignPayload(index, actorId, step, artifact, timestamp, result, prevHash) {
    return `${index}|${actorId}|${step}|${artifact}|${timestamp}|${result}|${prevHash}`;
}
/**
 * Sign an event payload using a stored key.
 * Returns the signature string, or undefined if no key available.
 */
function trySign(actorId, payload) {
    // In CI, keys are injected via environment variable
    const envKey = process.env[`PROGMUNE_KEY_${sanitizeFilename(actorId).toUpperCase()}`];
    if (envKey) {
        const result = signEvent(payload, envKey);
        result.actorId = actorId;
        return result;
    }
    // In local dev, try loading from .progmune_keys/
    // (private keys are not stored by default — user provides them)
    return undefined;
}
