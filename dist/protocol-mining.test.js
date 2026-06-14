"use strict";
/**
 * P6.7: Large-scale Protocol Mining Tests
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const protocol_mining_1 = require("./protocol-mining");
(0, vitest_1.describe)("P6.7 Large-scale Protocol Mining", () => {
    (0, vitest_1.it)("curated 20+ repo signatures across diverse domains", () => {
        (0, vitest_1.expect)(protocol_mining_1.MINING_SIGNATURES.length).toBeGreaterThanOrEqual(20);
        const domains = new Set(protocol_mining_1.MINING_SIGNATURES.map(s => s.domain));
        // Should cover at least 10 distinct domains
        (0, vitest_1.expect)(domains.size).toBeGreaterThanOrEqual(10);
        const languages = new Set(protocol_mining_1.MINING_SIGNATURES.map(s => s.language));
        (0, vitest_1.expect)(languages.size).toBeGreaterThanOrEqual(4); // Python, JS, Go, C, Rust
    });
    (0, vitest_1.it)("each signature has valid call patterns", () => {
        for (const sig of protocol_mining_1.MINING_SIGNATURES) {
            (0, vitest_1.expect)(sig.patterns.length).toBeGreaterThan(0);
            for (const p of sig.patterns) {
                (0, vitest_1.expect)(p.length).toBeGreaterThanOrEqual(2);
            }
        }
    });
    (0, vitest_1.it)("runs full mining pipeline and measures bootstrap improvement", async () => {
        const report = await (0, protocol_mining_1.runLargeScaleMining)();
        (0, vitest_1.expect)(report.reposScanned).toBeGreaterThanOrEqual(20);
        (0, vitest_1.expect)(report.sequencesExtracted).toBeGreaterThan(50);
        (0, vitest_1.expect)(report.uniqueSequences).toBeGreaterThan(30);
        (0, vitest_1.expect)(report.clustersFound).toBeGreaterThan(0);
        // New rules should be synthesized from the expanded corpus
        (0, vitest_1.expect)(report.newRulesSynthesized).toBeGreaterThan(0);
        // Total rules should be significantly larger than the original 31
        (0, vitest_1.expect)(report.totalRulesAfter).toBeGreaterThan(40);
        (0, protocol_mining_1.printMiningReport)(report);
    }, 30000);
});
