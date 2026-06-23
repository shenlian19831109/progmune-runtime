/**
 * Phase 12: Ed25519 Signatures for Accountability Events
 *
 * Cryptographic proof that a specific actor performed a specific action.
 * Uses Node.js built-in crypto (Ed25519 since Node 12+).
 *
 * Each actor has a key pair. Events are signed by the actor's private key.
 * Verification proves: "actor X signed event Y at time Z".
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface KeyPair {
  publicKey: string;       // hex-encoded
  privateKey: string;      // hex-encoded
  actorId: string;         // who this key belongs to
  actorType: string;
  createdAt: string;
}

export interface SignatureResult {
  signature: string;        // hex-encoded Ed25519 signature
  publicKey: string;        // the public key used to verify
  actorId: string;
  algorithm: "ed25519";
}

export interface VerificationResult {
  valid: boolean;
  actorId: string;
  publicKey: string;
  detail?: string;
}

// ═══════════════════════════════════════════════════════════════
// Key Management
// ═══════════════════════════════════════════════════════════════

const KEYS_DIR = ".progmune_keys";

function keysDir(): string {
  const projectDir = process.env.PROGMUNE_PROJECT_DIR || process.cwd();
  return path.resolve(projectDir, KEYS_DIR);
}

function keyPath(actorId: string): string {
  return path.join(keysDir(), `${sanitizeFilename(actorId)}.json`);
}

function sanitizeFilename(id: string): string {
  return id.replace(/[^a-zA-Z0-9_@.-]/g, "_").slice(0, 64);
}

/** Generate a new Ed25519 key pair for an actor */
export function generateKeyPair(
  actorId: string,
  actorType: string
): KeyPair {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  });

  const kp: KeyPair = {
    publicKey: publicKey.toString("hex"),
    privateKey: privateKey.toString("hex"),
    actorId,
    actorType,
    createdAt: new Date().toISOString(),
  };

  // Auto-save to .progmune_keys/
  const dir = keysDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // Only save public info + type; private key stored separately
  fs.writeFileSync(
    keyPath(actorId) + ".pub",
    JSON.stringify({ actorId, actorType, publicKey: kp.publicKey, createdAt: kp.createdAt }, null, 2),
    "utf-8"
  );

  return kp;
}

/** Load public key for an actor */
export function loadPublicKey(actorId: string): string | null {
  const pubPath = keyPath(actorId) + ".pub";
  try {
    const data = JSON.parse(fs.readFileSync(pubPath, "utf-8"));
    return data.publicKey || null;
  } catch {
    return null;
  }
}

/** Check if a key exists for an actor */
export function hasKey(actorId: string): boolean {
  return loadPublicKey(actorId) !== null;
}

/** Load or generate a key for an actor */
export function ensureKey(actorId: string, actorType: string): KeyPair {
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
export function signEvent(
  payload: string,
  privateKey: string
): SignatureResult {
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
    publicKey: (pubKeyDer as Buffer).toString("hex"),
    actorId: "",
    algorithm: "ed25519",
  };
}

/**
 * Verify an Ed25519 signature against a payload and public key.
 */
export function verifySignature(
  payload: string,
  signature: string,
  publicKey: string
): VerificationResult {
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
  } catch (e: any) {
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
export function buildSignPayload(
  index: number,
  actorId: string,
  step: string,
  artifact: string,
  timestamp: string,
  result: string,
  prevHash: string
): string {
  return `${index}|${actorId}|${step}|${artifact}|${timestamp}|${result}|${prevHash}`;
}

/**
 * Sign an event payload using a stored key.
 * Returns the signature string, or undefined if no key available.
 */
export function trySign(
  actorId: string,
  payload: string
): SignatureResult | undefined {
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
