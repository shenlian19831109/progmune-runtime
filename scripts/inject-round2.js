#!/usr/bin/env node
/**
 * P0 Round 2: Inject registration + file_upload + resource trajectories
 * Lightweight vanilla JS — no ts-node needed.
 */
const fs = require("fs");
const path = require("path");

const CORPUS_DIR = path.resolve(process.cwd(), ".progmune_corpus", "trajectories");
const today = new Date().toISOString().slice(0, 10);
const dateDir = path.join(CORPUS_DIR, today);

// ── Trajectory sequences ──
const sequences = {
  registration: [
    ["register_user", "send_verification_code", "verify_code", "activate_account"],
    ["register_user", "send_verification_code", "resend_verification_code", "verify_code", "activate_account"],
    ["register_user", "send_verification_code", "expire_verification", "send_verification_code", "verify_code", "activate_account"],
    ["register_user", "reject_registration"],
    ["register_user", "send_verification_code", "reject_registration"],
    ["register_user", "send_verification_code", "resend_verification_code", "expire_verification", "send_verification_code", "verify_code", "activate_account"],
    ["register_user", "send_verification_code", "verify_code", "activate_account"],
  ],
  file_upload: [
    ["receive_upload", "validate_file", "store_file", "reference_file"],
    ["receive_upload", "virus_scan_file", "validate_file", "store_file", "reference_file"],
    ["receive_upload", "validate_file", "reject_file"],
    ["receive_upload", "reject_file"],
    ["receive_upload", "virus_scan_file", "reject_file"],
    ["receive_upload", "validate_file", "store_file", "delete_file"],
    ["receive_upload", "virus_scan_file", "validate_file", "store_file", "reference_file", "delete_file"],
  ],
  resource: [
    ["sanitize", "validate_type", "validate_range"],
    ["sanitize", "validate_type"],
    ["sanitize", "validate_type", "validate_range", "escape_output"],
    ["rate_limit_resource", "sanitize", "validate_type", "validate_range"],
    ["rate_limit_resource", "sanitize", "validate_type", "validate_range", "escape_output"],
    ["sanitize", "escape_output"],
  ],
};

const namespaceMap = {
  registration: "registration",
  file_upload: "file_upload",
  resource: "resource",
};

const dryRun = process.argv.includes("--dry-run");

if (!dryRun) fs.mkdirSync(dateDir, { recursive: true });

let total = 0;
const counts = {};

for (const [domain, seqs] of Object.entries(sequences)) {
  counts[domain] = 0;
  const ns = namespaceMap[domain];

  for (const seq of seqs) {
    const id = `T-P0-R2-${domain}-${counts[domain]}`;
    const traj = {
      id,
      timestamp: new Date().toISOString(),
      protocol: domain.replace(/_/g, "-"),
      namespace: ns,
      initialState: [],
      finalState: [],
      trajectory: seq,
      result: "clean",
      context: { nestingDepth: 0, exceptionHandled: false, insideLoop: false, branchCount: 0, asyncContext: false },
      successRate: 1.0,
      metadata: { source: "p0-vocabulary-injection-round2", phase: "P0 Round 2 — Two-Hump Rule Vocabulary Injection", experiment: "P0-registration-file_upload-resource" },
      feedback: { accepted: true, rejected: false },
      cost: { latency: seq.length * 2, actions: seq.length },
    };

    if (dryRun) {
      console.log(`[DRY] ${id}: ${seq.join(" → ")}`);
    } else {
      fs.writeFileSync(path.join(dateDir, `${id}.json`), JSON.stringify(traj, null, 2));
    }
    counts[domain]++;
    total++;
  }
}

console.log(`\n═══ P0 Round 2 Injection ═══`);
console.log(`  Mode: ${dryRun ? "DRY RUN" : "LIVE"}`);
console.log(`  Output: ${dateDir}/`);
for (const [d, c] of Object.entries(counts)) {
  console.log(`  ${d}: ${c} trajectories`);
}
console.log(`  Total: ${total} new trajectories`);
console.log(`  Namespaces covered: registration, file_upload, resource`);
console.log(`  Estimated coverage: 24.4% → ~35.6% (+10/90 transitions)`);
