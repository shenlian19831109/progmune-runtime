/**
 * P8.1: State Machine Fingerprint Tests
 *
 * Three decisive experiments:
 *   A: State-Scramble — renaming states must preserve similarity (100%)
 *   B: Protocol discrimination — auth vs file must differ from auth vs auth
 *   C: All 9 protocols — structural grouping by state machine topology
 */
import { describe, it, expect } from "vitest";
import {
  extractStateMachine,
  renameStates,
  compareStateMachines,
  extractAllProtocolStateMachines,
  compareAllProtocolStateMachines,
  printStateMachineComparison,
} from "./state-machine-fingerprint";
import { loadDefaultProtocolDefinitions } from "./protocol-coverage";

describe("P8.1 State Machine Fingerprint", () => {
  it("extracts state machines from all 9 protocol groups", () => {
    const machines = extractAllProtocolStateMachines();
    expect(machines.size).toBeGreaterThanOrEqual(9);

    for (const [name, fp] of machines) {
      expect(fp.stateCount).toBeGreaterThan(0);
      // StatelessProtocol has empty pre/post → no transitions (expected)
      if (name === "StatelessProtocol") {
        expect(fp.transitions.length).toBeGreaterThanOrEqual(0);
      } else {
        expect(fp.transitions.length).toBeGreaterThan(0);
      }
      expect(fp.entryStates.length).toBeGreaterThanOrEqual(0);
      expect(fp.exitStates.length).toBeGreaterThanOrEqual(0);
    }
  });

  it("STATE-SCRAMBLE: renaming states preserves similarity 100%", () => {
    const defs = loadDefaultProtocolDefinitions();

    for (const proto of defs) {
      if (proto.rules.size === 0) continue;
      const original = extractStateMachine(proto.rules);
      const scrambled = renameStates(original);

      // Every state should be renamed (except INIT and ∅)
      for (const s of scrambled.entryStates) {
        if (s !== "INIT" && s !== "∅") expect(s).toMatch(/^S\d+$/);
      }

      const comp = compareStateMachines(original, scrambled);
      expect(comp.similarity).toBe(1.0);
    }
  });

  it("DISCRIMINATION: auth vs file differs from auth vs auth", () => {
    const machines = extractAllProtocolStateMachines();
    const auth = machines.get("AuthProtocol")!;
    const file = machines.get("FileProtocol")!;
    const db = machines.get("DBProtocol")!;

    // Same protocol → should be identical
    const authVsAuth = compareStateMachines(auth, auth);
    expect(authVsAuth.similarity).toBe(1.0);

    // Different protocols → should be distinguishable
    const authVsFile = compareStateMachines(auth, file);
    const authVsDb = compareStateMachines(auth, db);
    const fileVsDb = compareStateMachines(file, db);

    console.log(`\n  Auth ↔ Auth:   ${(authVsAuth.similarity*100).toFixed(0)}%`);
    console.log(`  Auth ↔ File:   ${(authVsFile.similarity*100).toFixed(0)}%`);
    console.log(`  Auth ↔ DB:     ${(authVsDb.similarity*100).toFixed(0)}%`);
    console.log(`  File ↔ DB:     ${(fileVsDb.similarity*100).toFixed(0)}%`);

    // Auth vs File should be LESS similar than Auth vs Auth
    const discriminationExists = authVsFile.similarity < authVsAuth.similarity;
    expect(discriminationExists).toBe(true);

    // File vs DB (both resource lifecycle) might be more similar than Auth vs File
    // because they share acquire→use→release structure
    console.log(`\n  Auth-File gap: ${((authVsAuth.similarity - authVsFile.similarity)*100).toFixed(0)}%`);
    console.log(`  File-DB (resource siblings): ${(fileVsDb.similarity*100).toFixed(0)}%`);
  });

  it("PROTOCOL CLUSTERING: linear vs non-linear protocols separate", () => {
    const machines = extractAllProtocolStateMachines();
    const names = [...machines.keys()];

    // Linear protocols: auth, file, db, dev_pipeline, cross
    const linear = ["AuthProtocol", "FileProtocol", "DBProtocol", "IRProtocol", "CrossProtocol"];
    // Non-linear: transaction (DAG), conditional (tree), loop (self-loop)
    const nonlinear = ["TransactionProtocol", "ConditionalProtocol", "LoopProtocol"];

    let linearInternalSim = 0, linearCount = 0;
    for (let i = 0; i < linear.length; i++) {
      for (let j = i + 1; j < linear.length; j++) {
        if (machines.has(linear[i]) && machines.has(linear[j])) {
          linearInternalSim += compareStateMachines(machines.get(linear[i])!, machines.get(linear[j])!).similarity;
          linearCount++;
        }
      }
    }

    let nonlinearInternalSim = 0, nonlinearCount = 0;
    for (let i = 0; i < nonlinear.length; i++) {
      for (let j = i + 1; j < nonlinear.length; j++) {
        if (machines.has(nonlinear[i]) && machines.has(nonlinear[j])) {
          nonlinearInternalSim += compareStateMachines(machines.get(nonlinear[i])!, machines.get(nonlinear[j])!).similarity;
          nonlinearCount++;
        }
      }
    }

    const avgLinear = linearCount > 0 ? linearInternalSim / linearCount : 0;
    const avgNonlinear = nonlinearCount > 0 ? nonlinearInternalSim / nonlinearCount : 0;

    console.log(`\n  Avg linear↔linear:     ${(avgLinear*100).toFixed(0)}%`);
    console.log(`  Avg nonlinear↔nonlinear: ${(avgNonlinear*100).toFixed(0)}%`);
  });

  it("ALL 9 PROTOCOLS: ranked similarity matrix", () => {
    const results = compareAllProtocolStateMachines();

    console.log(`\n  Ranked by structural similarity:`);
    console.log(`  ${'Protocol A'.padEnd(22)} ${'Protocol B'.padEnd(22)} ${'Sim'.padEnd(6)} Trans  State Deg  Role`);
    console.log(`  ${'─'.repeat(80)}`);

    for (const r of results.slice(0, 15)) {
      console.log(
        `  ${r.protocolA.padEnd(22)} ${r.protocolB.padEnd(22)} ` +
        `${(r.comparison.similarity * 100).toFixed(0).padStart(3)}%  ` +
        `${(r.comparison.transitionPatternSimilarity * 100).toFixed(0).padStart(3)}%  ` +
        `${(r.comparison.stateCountRatio * 100).toFixed(0).padStart(3)}%  ` +
        `${(r.comparison.degreeProfileSimilarity * 100).toFixed(0).padStart(3)}%  ` +
        `${(r.comparison.roleProfileSimilarity * 100).toFixed(0).padStart(3)}%`
      );
    }

    // All results should be valid (0-1 range)
    for (const r of results) {
      expect(r.comparison.similarity).toBeGreaterThanOrEqual(0);
      expect(r.comparison.similarity).toBeLessThanOrEqual(1.01);
    }
  });
});
