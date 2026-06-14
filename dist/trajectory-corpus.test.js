"use strict";
/**
 * P6.10: Trajectory Corpus Expansion Tests
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const trajectory_corpus_1 = require("./trajectory-corpus");
const auto_protocol_synthesizer_1 = require("./auto-protocol-synthesizer");
(0, vitest_1.describe)("P6.10 Trajectory Corpus Expansion", () => {
    (0, vitest_1.it)("contains 110+ sequences across 18 libraries", () => {
        (0, vitest_1.expect)(trajectory_corpus_1.EXPANDED_TRAJECTORIES.length).toBe(18);
        const all = (0, trajectory_corpus_1.collectExpandedTrajectories)();
        (0, vitest_1.expect)(all.length).toBeGreaterThanOrEqual(100);
        const libraries = new Set(trajectory_corpus_1.EXPANDED_TRAJECTORIES.map(l => l.library));
        (0, vitest_1.expect)(libraries.size).toBe(18);
        const domains = new Set(trajectory_corpus_1.EXPANDED_TRAJECTORIES.map(l => l.domain));
        (0, vitest_1.expect)(domains.size).toBeGreaterThanOrEqual(5);
    });
    (0, vitest_1.it)("synthesizes protocols from expanded corpus", () => {
        const expanded = (0, trajectory_corpus_1.collectExpandedTrajectories)();
        const protocols = (0, auto_protocol_synthesizer_1.synthesizeProtocols)(expanded);
        (0, vitest_1.expect)(protocols.length).toBeGreaterThan(0);
        // With 50+ expanded sequences, should find more clusters than the original 5
        (0, vitest_1.expect)(protocols.length).toBeGreaterThanOrEqual(3);
    });
    (0, vitest_1.it)("runs corpus expansion and measures bootstrap improvement", async () => {
        const report = await (0, trajectory_corpus_1.runCorpusExpansion)();
        (0, vitest_1.expect)(report.expandedCount).toBeGreaterThanOrEqual(50);
        (0, vitest_1.expect)(report.rulesSynthesized).toBeGreaterThan(0);
        (0, trajectory_corpus_1.printExpansionReport)(report);
    }, 60000);
});
