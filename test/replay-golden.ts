/**
 * Replay Golden Set — CI gate.
 *
 * Verifies all golden sessions pass deterministic replay.
 * Any failure blocks the build.
 *
 * Usage: npx ts-node test/replay-golden.ts
 */

import * as fs from "fs";
import * as path from "path";
import { replaySession } from "../src/deterministic-replay";

const GOLDEN_DIR = path.resolve(__dirname, "replay-golden");

function main() {
  const files = fs.readdirSync(GOLDEN_DIR).filter(f => f.endsWith(".json"));
  if (files.length === 0) {
    console.error("No golden sessions found.");
    process.exit(1);
  }

  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const file of files) {
    const sessionId = file.replace(".json", "");
    // Temporarily override sessions dir to use golden set
    // We replay from the golden file directly
    const session = JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, file), "utf-8"));
    const result = replaySessionFromData(sessionId, session);

    if (result.success) {
      passed++;
    } else {
      failed++;
      failures.push(`${sessionId.slice(0, 13)}...: ${result.divergenceDetail || "unknown"}`);
    }
  }

  console.log(`Replay Golden: ${passed}/${files.length} passed`);

  if (failed > 0) {
    console.error(`\n${failed} FAILURES:`);
    for (const f of failures) console.error(`  ❌ ${f}`);
    console.error(`\n❌ Replay Golden Set FAILED — blocking.`);
    process.exit(1);
  }

  console.log("✅ All golden sessions replay consistently.");
  process.exit(0);
}

/** Replay from a pre-loaded session object (avoids corpus dir dependency). */
function replaySessionFromData(sessionId: string, session: any): ReturnType<typeof replaySession> {
  // Use the same replay logic but from in-memory data
  const { replayLedger } = require("../src/deterministic-replay");
  const { getNsInit } = require("../src/protocol-registry");

  let transitions: any[] = [];
  let sessionRuleHash = session.ruleHash || "";
  for (const attempt of (session.attempts || [])) {
    transitions = transitions.concat(attempt.transitions || []);
    if (!sessionRuleHash && (attempt.ruleHash || session.ruleHash)) {
      sessionRuleHash = attempt.ruleHash || session.ruleHash;
    }
  }

  const { hashLedger } = require("../src/ssg-validator");
  const storedHash = transitions.length > 0 ? hashLedger(transitions) : "";

  return replayLedger(
    sessionId,
    transitions,
    sessionRuleHash,
    storedHash,
    undefined,
    undefined,
    getNsInit()
  );
}

main();
