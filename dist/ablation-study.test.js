"use strict";
/**
 * P7.0: Ablation Study Tests
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const ablation_study_1 = require("./ablation-study");
(0, vitest_1.describe)("P7.0 Ablation Study", () => {
    (0, vitest_1.it)("measures repo similarity with and without synonyms", () => {
        const report = (0, ablation_study_1.runAblationStudy)();
        (0, vitest_1.expect)(report.baseline.repoSimilarity).toBeGreaterThan(0);
        (0, vitest_1.expect)(report.noSynonyms.repoSimilarity).toBeGreaterThanOrEqual(0);
        // The key metric: how much similarity survives without synonyms
        const survivalRate = report.noSynonyms.repoSimilarity / Math.max(0.01, report.baseline.repoSimilarity);
        console.log(`Survival rate (without synonyms): ${(survivalRate * 100).toFixed(0)}%`);
        (0, ablation_study_1.printAblationReport)(report);
    });
});
