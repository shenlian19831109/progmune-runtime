"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * P9.2d: Gold CVE — diff-to-states conversion + detector validation
 *
 * Converts git-diff-based gold CVE data to gold dataset format,
 * then runs the invariant detector against verified sequences.
 * This isolates detector recall from ALL pipeline noise.
 */
const vitest_1 = require("vitest");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const gold_cve_1 = require("./gold-cve");
const SEED_PATH = path.resolve(__dirname, "..", "benchmarks", "gold-seed.json");
function loadSeedGold() {
    if (!fs.existsSync(SEED_PATH))
        return [];
    return JSON.parse(fs.readFileSync(SEED_PATH, "utf-8"));
}
function convertSeedToGold(seed) {
    const cases = seed.map((c, i) => ({
        id: `GOLD-${String(i + 1).padStart(3, "0")}`,
        cve: c.cve,
        title: c.notes?.slice(0, 80) || c.cve,
        category: c.category,
        severity: c.severity || "high",
        broken: c.before,
        expected: c.after,
        project: c.project,
        verifiedBy: "git_diff",
        notes: c.notes,
    }));
    const byCategory = {};
    for (const c of cases)
        byCategory[c.category] = (byCategory[c.category] || 0) + 1;
    return { cases, metadata: { total: cases.length, byCategory, verifiedBy: { git_diff: cases.length } } };
}
(0, vitest_1.describe)("P9.2d Diff-to-States Gold CVE", () => {
    (0, vitest_1.it)("converts seed diff data to gold dataset", () => {
        const seed = loadSeedGold();
        (0, vitest_1.expect)(seed.length).toBeGreaterThanOrEqual(3);
        const gold = convertSeedToGold(seed);
        (0, vitest_1.expect)(gold.cases.length).toBe(seed.length);
        // Every case should have verified broken/expected arrays
        for (const c of gold.cases) {
            (0, vitest_1.expect)(c.broken.length).toBeGreaterThan(0);
            (0, vitest_1.expect)(c.expected.length).toBeGreaterThan(0);
            (0, vitest_1.expect)(c.verifiedBy).toBe("git_diff");
        }
    });
    (0, vitest_1.it)("DETECTOR RUNS ON DIFF DATA: measures recall without parser noise", () => {
        const seed = loadSeedGold();
        if (seed.length === 0)
            return;
        const gold = convertSeedToGold(seed);
        const result = (0, gold_cve_1.runGoldBenchmark)(gold);
        (0, gold_cve_1.printGoldReport)(result);
        // With verified diff-based sequences, detector recall should be high
        (0, vitest_1.expect)(result.recall).toBeGreaterThan(0.6);
    });
    (0, vitest_1.it)("compares curated vs diff-based gold recall", () => {
        const curated = (0, gold_cve_1.runGoldBenchmark)((0, gold_cve_1.loadGoldDataset)());
        const seed = loadSeedGold();
        if (seed.length === 0)
            return;
        const diffBased = (0, gold_cve_1.runGoldBenchmark)(convertSeedToGold(seed));
        console.log(`\n  Curated gold (20):   ${(curated.recall * 100).toFixed(0)}% recall`);
        console.log(`  Diff-based gold (${seed.length}):  ${(diffBased.recall * 100).toFixed(0)}% recall`);
        console.log(`  Both measured WITHOUT parser noise — pure detector performance.`);
    });
});
