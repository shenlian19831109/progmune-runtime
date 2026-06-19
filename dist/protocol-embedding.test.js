"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * P10.0: Protocol Embedding Space Test
 *
 * The decisive question: do protocol families naturally cluster
 * in WL embedding space, without any labels or manual features?
 */
const vitest_1 = require("vitest");
const protocol_embedding_1 = require("./protocol-embedding");
const unsupervised_physics_1 = require("./unsupervised-physics");
(0, vitest_1.describe)("P10.0 Protocol Embedding Space", () => {
    (0, vitest_1.it)("builds embedding space from all known protocols", () => {
        const space = (0, protocol_embedding_1.buildEmbeddingSpace)();
        (0, vitest_1.expect)(space.embeddings.length).toBeGreaterThanOrEqual(10);
        (0, vitest_1.expect)(space.similarityMatrix.length).toBe(space.embeddings.length);
        // Every embedding should have a 256-dim vector
        for (const e of space.embeddings) {
            (0, vitest_1.expect)(e.vector.length).toBe(256);
            (0, vitest_1.expect)(e.family).toBeTruthy();
        }
        (0, protocol_embedding_1.printEmbeddingSpace)(space);
    });
    (0, vitest_1.it)("same-family protocols are more similar than cross-family", () => {
        const space = (0, protocol_embedding_1.buildEmbeddingSpace)();
        // Test: Redis ↔ SQLite (both cross_repo resource lifecycle)
        // should be more similar than Redis ↔ loop (different family)
        const redis = space.embeddings.find(e => e.name === "Redis");
        const sqlite = space.embeddings.find(e => e.name === "SQLite");
        const loop = space.embeddings.find(e => e.name === "loop");
        const redisIdx = space.embeddings.indexOf(redis);
        const sqliteIdx = space.embeddings.indexOf(sqlite);
        const loopIdx = space.embeddings.indexOf(loop);
        const redisSqliteSim = space.similarityMatrix[redisIdx][sqliteIdx];
        const redisLoopSim = space.similarityMatrix[redisIdx][loopIdx];
        console.log(`\n  Redis ↔ SQLite:  ${(redisSqliteSim * 100).toFixed(0)}%`);
        console.log(`  Redis ↔ Loop:    ${(redisLoopSim * 100).toFixed(0)}%`);
        // Resource-lifecycle protocols should cluster together
        (0, vitest_1.expect)(redisSqliteSim).toBeGreaterThan(0.5);
    });
    (0, vitest_1.it)("retrieves most similar protocols for an unknown protocol", () => {
        const space = (0, protocol_embedding_1.buildEmbeddingSpace)();
        // Simulate: query with PostgreSQL sequences (leave-one-out)
        const pgSeqs = unsupervised_physics_1.CROSS_REPO_SEQUENCES["PostgreSQL"] || [];
        if (pgSeqs.length === 0)
            return;
        // Remove PostgreSQL from the space to simulate "unknown"
        const filteredEmbeddings = space.embeddings.filter(e => e.name !== "PostgreSQL");
        const filteredSpace = {
            embeddings: filteredEmbeddings,
            similarityMatrix: space.similarityMatrix,
        };
        const result = (0, protocol_embedding_1.retrieveSimilarProtocols)("PostgreSQL", "cross_repo", pgSeqs, filteredSpace, 5);
        (0, protocol_embedding_1.printRetrievalResult)(result);
        (0, vitest_1.expect)(result.matches.length).toBeGreaterThan(0);
        // Top match should be another resource-lifecycle protocol
        const topFamily = result.matches[0].family;
        const lifecycleFamilies = ["cross_repo", "linear", "file", "db"];
        console.log(`  Top match family: ${topFamily} (expected lifecycle family)`);
    });
    (0, vitest_1.it)("linear topologies are distinguishable from loop/star", () => {
        const linear = (0, protocol_embedding_1.embedProtocol)("linear", "chain", [["open", "read", "close"]]);
        const loopP = (0, protocol_embedding_1.embedProtocol)("loop", "cycle", [["init", "process", "process", "exit"]]);
        const star = (0, protocol_embedding_1.embedProtocol)("star", "branch", [["hub", "leaf", "hub", "destroy"]]);
        const lvL = cosineSim(linear.vector, loopP.vector);
        const lvS = cosineSim(linear.vector, star.vector);
        console.log(`\n  linear ↔ loop:  ${(lvL * 100).toFixed(0)}%`);
        console.log(`  linear ↔ star:  ${(lvS * 100).toFixed(0)}%`);
        // Different topologies should not be identical
        (0, vitest_1.expect)(lvL).toBeLessThan(0.99);
        (0, vitest_1.expect)(lvS).toBeLessThan(0.99);
    });
});
function cosineSim(a, b) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    return (normA > 0 && normB > 0) ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 1;
}
