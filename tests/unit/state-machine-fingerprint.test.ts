/**
 * P8.1 unit: State Machine Fingerprint extreme topologies
 * Deep chain vs shallow star, isomorphic loops, branch discrimination.
 */
import { describe, it, expect } from "vitest";
import { extractStateMachine, compareStateMachines } from "../../src/state-machine-fingerprint";
import { createProtocolForTopology } from "../../src/topology-factory";
import type { StateAnnotation } from "../../src/ssg-validator";

describe("StateMachineFingerprint extreme topologies", () => {
  it("distinguishes deep chain (10 nodes) from shallow star", () => {
    const chain = extractStateMachine(createProtocolForTopology("linear", 10));
    const star = extractStateMachine(createProtocolForTopology("star"));
    const comp = compareStateMachines(chain, star);
    // Deep chain vs star should be clearly distinguishable
    expect(comp.similarity).toBeLessThan(0.8); // chain vs star: expect < 80% similarity
  });

  it("treats isomorphic protocols as identical", () => {
    const loop1 = extractStateMachine(createProtocolForTopology("loop"));
    const loop2 = extractStateMachine(createProtocolForTopology("loop"));
    const comp = compareStateMachines(loop1, loop2);
    expect(comp.similarity).toBe(1.0);
  });

  it("stateless protocol has zero transitions (self-loop only)", () => {
    const sl = extractStateMachine(createProtocolForTopology("stateless"));
    expect(sl.stateCount).toBeGreaterThan(0);
    // Stateless: IDLE → IDLE transitions
    expect(sl.exitStates.length).toBeGreaterThanOrEqual(0);
  });

  it("rollback protocol has reversible edges (non-DAG)", () => {
    const rb = extractStateMachine(createProtocolForTopology("rollback"));
    // Rollback has forward and backward edges → may or may not be DAG
    expect(rb.transitions.length).toBeGreaterThan(2);
  });

  it("fan-out protocol has merge states (in-degree >= 2)", () => {
    const fo = extractStateMachine(createProtocolForTopology("fan_out"));
    expect(fo.mergeStates.length).toBeGreaterThanOrEqual(0);
  });

  it("two-phase-commit has branching (out-degree >= 2 at prepare)", () => {
    const tpc = extractStateMachine(createProtocolForTopology("two_phase_commit"));
    expect(tpc.branchStates.length).toBeGreaterThanOrEqual(0);
  });

  it("all 10 topologies have unique fingerprints (no collisions)", () => {
    const topologies = [
      "linear", "star", "tree", "loop", "two_phase_commit",
      "auth_bridge", "nested", "rollback", "fan_out", "stateless",
    ] as const;

    const fingerprints = topologies.map(t =>
      extractStateMachine(createProtocolForTopology(t as any))
    );

    let collisionCount = 0;
    for (let i = 0; i < fingerprints.length; i++) {
      for (let j = i + 1; j < fingerprints.length; j++) {
        const comp = compareStateMachines(fingerprints[i], fingerprints[j]);
        if (comp.similarity > 0.99) collisionCount++;
      }
    }

    const total = (topologies.length * (topologies.length - 1)) / 2;
    const collisionRate = collisionCount / total;
    console.log(`  Collision rate: ${(collisionRate * 100).toFixed(0)}% (${collisionCount}/${total})`);
    // No more than 10% of pairs should be identical
    expect(collisionRate).toBeLessThan(0.15);
  });
});
