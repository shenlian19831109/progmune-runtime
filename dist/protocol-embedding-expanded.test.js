"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * P10.1: Scaled Protocol Embedding Space — clustering validation
 */
const vitest_1 = require("vitest");
const protocol_embedding_expanded_1 = require("./protocol-embedding-expanded");
(0, vitest_1.describe)("P10.1 Scaled Embedding Space", () => {
    (0, vitest_1.it)("builds scaled space with 55+ protocol variants", () => {
        const space = (0, protocol_embedding_expanded_1.buildScaledEmbeddingSpace)(5); // 10 topologies × 5 variants + 5 cross-repo
        (0, protocol_embedding_expanded_1.printScaledReport)(space);
        // Should have ~55 protocols (10×5 + 5 cross-repo)
        (0, vitest_1.expect)(space.protocols.length).toBeGreaterThanOrEqual(50);
        (0, vitest_1.expect)(space.familyCount).toBeGreaterThanOrEqual(10);
        // Every embedding should be 256-dim
        for (const p of space.protocols) {
            (0, vitest_1.expect)(p.vector.length).toBe(256);
        }
    });
    (0, vitest_1.it)("within-family similarity exceeds cross-family", () => {
        const space = (0, protocol_embedding_expanded_1.buildScaledEmbeddingSpace)(4);
        // Compute within-family and cross-family averages
        let withinTotal = 0, withinN = 0;
        let crossTotal = 0, crossN = 0;
        for (let i = 0; i < space.protocols.length; i++) {
            for (let j = i + 1; j < space.protocols.length; j++) {
                const sim = space.similarityMatrix[i][j];
                if (space.labels[i] === space.labels[j]) {
                    withinTotal += sim;
                    withinN++;
                }
                else {
                    crossTotal += sim;
                    crossN++;
                }
            }
        }
        const withinAvg = withinN > 0 ? withinTotal / withinN : 0;
        const crossAvg = crossN > 0 ? crossTotal / crossN : 0;
        const effect = withinAvg - crossAvg;
        console.log(`\n  Within-family avg: ${(withinAvg * 100).toFixed(0)}%`);
        console.log(`  Cross-family avg:  ${(crossAvg * 100).toFixed(0)}%`);
        console.log(`  Clustering effect: ${effect > 0 ? '+' : ''}${(effect * 100).toFixed(0)}%`);
        // Same-family protocols should be more similar than cross-family
        (0, vitest_1.expect)(withinAvg).toBeGreaterThan(crossAvg);
    });
    (0, vitest_1.it)("K-means ARI exceeds random baseline", () => {
        const space = (0, protocol_embedding_expanded_1.buildScaledEmbeddingSpace)(4);
        const vectors = space.protocols.map(p => p.vector);
        const k = space.familyCount;
        // Run K-means 5 times and take the best ARI
        let bestARI = -Infinity;
        for (let trial = 0; trial < 5; trial++) {
            const predLabels = (0, protocol_embedding_expanded_1.kMeansCluster)(vectors, k);
            const ari = (0, protocol_embedding_expanded_1.adjustedRandIndex)(space.labels, predLabels);
            if (ari > bestARI)
                bestARI = ari;
        }
        console.log(`\n  K-means (k=${k}, best of 5): ARI = ${bestARI.toFixed(3)}`);
        // ARI should be better than random (0)
        (0, vitest_1.expect)(bestARI).toBeGreaterThan(0);
    });
    (0, vitest_1.it)("same-topology variants cluster together (not scattered randomly)", () => {
        const space = (0, protocol_embedding_expanded_1.buildScaledEmbeddingSpace)(3);
        // For each family, check that variants are closer to siblings than to outsiders
        const families = [...new Set(space.labels)];
        let correctlyClustered = 0;
        let total = 0;
        for (const family of families) {
            const members = space.protocols
                .map((p, i) => ({ p, i }))
                .filter(({ p }) => p.family === family);
            for (const { p: member, i } of members) {
                // Find the closest neighbor
                let closestFamily = "";
                let closestSim = 0;
                for (let j = 0; j < space.protocols.length; j++) {
                    if (j === i)
                        continue;
                    const sim = space.similarityMatrix[i][j];
                    if (sim > closestSim) {
                        closestSim = sim;
                        closestFamily = space.protocols[j].family;
                    }
                }
                if (closestFamily === family)
                    correctlyClustered++;
                total++;
            }
        }
        const rate = total > 0 ? correctlyClustered / total : 0;
        console.log(`\n  Nearest-neighbor accuracy: ${(rate * 100).toFixed(0)}% (${correctlyClustered}/${total})`);
        console.log(`  Expected by random chance: ~10% (1/${families.length} families)`);
        // Should be substantially better than random
        (0, vitest_1.expect)(rate).toBeGreaterThan(0.2);
    });
});
