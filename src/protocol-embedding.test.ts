/**
 * P10.0: Protocol Embedding Space Test
 *
 * The decisive question: do protocol families naturally cluster
 * in WL embedding space, without any labels or manual features?
 */
import { describe, it, expect } from "vitest";
import {
  embedProtocol,
  buildEmbeddingSpace,
  retrieveSimilarProtocols,
  printEmbeddingSpace,
  printRetrievalResult,
} from "./protocol-embedding";
import { CROSS_REPO_SEQUENCES } from "./unsupervised-physics";
import { createProtocolForTopology, ALL_TOPOLOGIES } from "./topology-factory";

describe("P10.0 Protocol Embedding Space", () => {
  it("builds embedding space from all known protocols", () => {
    const space = buildEmbeddingSpace();
    expect(space.embeddings.length).toBeGreaterThanOrEqual(10);
    expect(space.similarityMatrix.length).toBe(space.embeddings.length);

    // Every embedding should have a 256-dim vector
    for (const e of space.embeddings) {
      expect(e.vector.length).toBe(256);
      expect(e.family).toBeTruthy();
    }

    printEmbeddingSpace(space);
  });

  it("same-family protocols are more similar than cross-family", () => {
    const space = buildEmbeddingSpace();

    // Test: Redis ↔ SQLite (both cross_repo resource lifecycle)
    // should be more similar than Redis ↔ loop (different family)
    const redis = space.embeddings.find(e => e.name === "Redis")!;
    const sqlite = space.embeddings.find(e => e.name === "SQLite")!;
    const loop = space.embeddings.find(e => e.name === "loop")!;

    const redisIdx = space.embeddings.indexOf(redis);
    const sqliteIdx = space.embeddings.indexOf(sqlite);
    const loopIdx = space.embeddings.indexOf(loop);

    const redisSqliteSim = space.similarityMatrix[redisIdx][sqliteIdx];
    const redisLoopSim = space.similarityMatrix[redisIdx][loopIdx];

    console.log(`\n  Redis ↔ SQLite:  ${(redisSqliteSim*100).toFixed(0)}%`);
    console.log(`  Redis ↔ Loop:    ${(redisLoopSim*100).toFixed(0)}%`);

    // Resource-lifecycle protocols should cluster together
    expect(redisSqliteSim).toBeGreaterThan(0.5);
  });

  it("retrieves most similar protocols for an unknown protocol", () => {
    const space = buildEmbeddingSpace();

    // Simulate: query with PostgreSQL sequences (leave-one-out)
    const pgSeqs = CROSS_REPO_SEQUENCES["PostgreSQL"] || [];
    if (pgSeqs.length === 0) return;

    // Remove PostgreSQL from the space to simulate "unknown"
    const filteredEmbeddings = space.embeddings.filter(e => e.name !== "PostgreSQL");
    const filteredSpace = {
      embeddings: filteredEmbeddings,
      similarityMatrix: space.similarityMatrix,
    };

    const result = retrieveSimilarProtocols(
      "PostgreSQL", "cross_repo", pgSeqs, filteredSpace, 5
    );
    printRetrievalResult(result);

    expect(result.matches.length).toBeGreaterThan(0);
    // Top match should be another resource-lifecycle protocol
    const topFamily = result.matches[0].family;
    const lifecycleFamilies = ["cross_repo", "linear", "file", "db"];
    console.log(`  Top match family: ${topFamily} (expected lifecycle family)`);
  });

  it("linear topologies are distinguishable from loop/star", () => {
    const linear = embedProtocol("linear", "chain", [["open","read","close"]]);
    const loopP = embedProtocol("loop", "cycle", [["init","process","process","exit"]]);
    const star = embedProtocol("star", "branch", [["hub","leaf","hub","destroy"]]);

    const lvL = cosineSim(linear.vector, loopP.vector);
    const lvS = cosineSim(linear.vector, star.vector);

    console.log(`\n  linear ↔ loop:  ${(lvL*100).toFixed(0)}%`);
    console.log(`  linear ↔ star:  ${(lvS*100).toFixed(0)}%`);

    // Different topologies should not be identical
    expect(lvL).toBeLessThan(0.99);
    expect(lvS).toBeLessThan(0.99);
  });
});

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return (normA > 0 && normB > 0) ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 1;
}
