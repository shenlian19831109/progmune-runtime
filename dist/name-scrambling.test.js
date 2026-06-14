"use strict";
/**
 * P7.1: Name Scrambling Tests
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const name_scrambling_1 = require("./name-scrambling");
(0, vitest_1.describe)("P7.1 Name Scrambling", () => {
    (0, vitest_1.it)("runs the decisive structure learning test", () => {
        const report = (0, name_scrambling_1.runNameScrambling)();
        (0, vitest_1.expect)(report.baseline).toBeGreaterThan(0);
        (0, vitest_1.expect)(report.nameSurvivalRate).toBeGreaterThanOrEqual(0);
        (0, vitest_1.expect)(report.nameSurvivalRate).toBeLessThanOrEqual(1.5); // may exceed 1 if scrambled similarity > baseline
        (0, name_scrambling_1.printScramblingReport)(report);
    });
});
