/**
 * P8.2: Generate diverse benchmark dataset
 *
 * Produces benchmarks/diverse.json: 10 topologies × 20 trajectories each.
 * Each trajectory is a valid random walk through the topology's state machine.
 * Function names are part of the data (for scrambling tests, see P8.0c).
 *
 * Usage: npx tsx scripts/generate-diverse-benchmark.ts
 */

import * as fs from "fs";
import * as path from "path";
import { createProtocolForTopology, ALL_TOPOLOGIES, TopologyName } from "../src/topology-factory";

const TRACES_PER_TOPOLOGY = 20;
const MIN_LEN = 2;
const MAX_LEN = 8;

interface DiverseSequence {
  id: string;
  topology: string;
  actions: string[];
}

/** Generate a valid random walk through the protocol state machine. */
function generateRandomWalk(
  rules: Map<string, { pre_states: string[]; post_states: string[]; invalidate?: string[] }>,
  minLen: number,
  maxLen: number
): string[] {
  const entries = [...rules.entries()];
  const targetLen = minLen + Math.floor(Math.random() * (maxLen - minLen + 1));
  const path: string[] = [];

  // Start from any rule that can fire from INIT or IDLE (stateless)
  const startCandidates = entries.filter(([, r]) =>
    r.pre_states.length === 0 || r.pre_states.includes("INIT") || r.pre_states.includes("IDLE")
  );
  if (startCandidates.length === 0) return path;

  const [startFn] = startCandidates[Math.floor(Math.random() * startCandidates.length)];
  path.push(startFn);

  const stateSet = new Set<string>(["INIT", "IDLE"]);
  const currentRule = rules.get(startFn)!;
  if (currentRule.invalidate) currentRule.invalidate.forEach(s => stateSet.delete(s));
  for (const s of currentRule.post_states) stateSet.add(s);

  while (path.length < targetLen) {
    const candidates = entries.filter(([fn, r]) =>
      fn !== path[path.length - 1] && // prefer not to self-loop unless it's the only option
      r.pre_states.every(s => stateSet.has(s))
    );

    if (candidates.length === 0) {
      // Try self-loop
      const selfCands = entries.filter(([fn, r]) =>
        fn === path[path.length - 1] && r.pre_states.every(s => stateSet.has(s))
      );
      if (selfCands.length > 0) {
        path.push(selfCands[0][0]);
        continue;
      }
      break;
    }

    const [nextFn, nextRule] = candidates[Math.floor(Math.random() * candidates.length)];
    path.push(nextFn);
    if (nextRule.invalidate) nextRule.invalidate.forEach(s => stateSet.delete(s));
    for (const s of nextRule.post_states) stateSet.add(s);
  }

  return path;
}

function main() {
  const sequences: DiverseSequence[] = [];

  for (const topo of ALL_TOPOLOGIES) {
    const rules = createProtocolForTopology(topo);
    let generated = 0;
    let attempts = 0;

    while (generated < TRACES_PER_TOPOLOGY && attempts < TRACES_PER_TOPOLOGY * 10) {
      const walk = generateRandomWalk(rules, MIN_LEN, MAX_LEN);
      attempts++;
      if (walk.length >= MIN_LEN) {
        sequences.push({
          id: `${topo}_${generated}`,
          topology: topo,
          actions: walk,
        });
        generated++;
      }
    }

    console.log(`  ${topo.padEnd(18)} ${generated}/${TRACES_PER_TOPOLOGY} traces (${attempts} attempts)`);
  }

  // Shuffle to avoid ordering bias
  for (let i = sequences.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [sequences[i], sequences[j]] = [sequences[j], sequences[i]];
  }

  const outputPath = path.resolve(__dirname, "..", "benchmarks", "diverse.json");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(
    outputPath,
    JSON.stringify(
      {
        sequences,
        metadata: {
          total: sequences.length,
          topologies: ALL_TOPOLOGIES,
          tracesPerTopology: TRACES_PER_TOPOLOGY,
          date: new Date().toISOString(),
        },
      },
      null,
      2
    )
  );

  console.log(`\n✅ Generated ${sequences.length} sequences → ${outputPath}`);
}

main();
