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
 * PLSB-100: Protocol Lifecycle Security Benchmark Tests
 */
const vitest_1 = require("vitest");
const plsb_benchmark_1 = require("./plsb-benchmark");
const gold_cve_1 = require("./gold-cve");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
(0, vitest_1.describe)("PLSB-100 Benchmark", () => {
    (0, vitest_1.it)("taxonomy has 13 weakness types with valid structure", () => {
        (0, vitest_1.expect)(plsb_benchmark_1.PROTOCOL_WEAKNESS_TAXONOMY.length).toBe(13);
        const ids = new Set();
        for (const w of plsb_benchmark_1.PROTOCOL_WEAKNESS_TAXONOMY) {
            (0, vitest_1.expect)(w.id).toMatch(/^PLS-\d{3}$/);
            (0, vitest_1.expect)(w.name).toBeTruthy();
            (0, vitest_1.expect)(w.category).toBeTruthy();
            (0, vitest_1.expect)(w.description.length).toBeGreaterThan(20);
            (0, vitest_1.expect)(w.example_broken.length).toBeGreaterThan(0);
            (0, vitest_1.expect)(w.example_expected.length).toBeGreaterThan(0);
            (0, vitest_1.expect)(ids.has(w.id)).toBe(false); // no duplicates
            ids.add(w.id);
        }
    });
    (0, vitest_1.it)("builds benchmark with at least 25 verified entries", () => {
        const b = (0, plsb_benchmark_1.buildPLSB)();
        (0, vitest_1.expect)(b.entries.length).toBeGreaterThanOrEqual(25);
        (0, vitest_1.expect)(b.metadata.verified).toBeGreaterThanOrEqual(25);
        (0, vitest_1.expect)(b.taxonomy).toBe(plsb_benchmark_1.PROTOCOL_WEAKNESS_TAXONOMY);
    });
    (0, vitest_1.it)("exports and re-imports PLSB benchmark faithfully", () => {
        const b = (0, plsb_benchmark_1.buildPLSB)();
        const tmpPath = path.resolve(__dirname, "..", "benchmarks", "plsb-test-tmp.json");
        (0, plsb_benchmark_1.exportPLSB)(b, tmpPath);
        const reloaded = JSON.parse(fs.readFileSync(tmpPath, "utf-8"));
        (0, vitest_1.expect)(reloaded.entries.length).toBe(b.entries.length);
        (0, vitest_1.expect)(reloaded.taxonomy.length).toBe(b.taxonomy.length);
        (0, vitest_1.expect)(reloaded.metadata.verified).toBe(b.metadata.verified);
        fs.unlinkSync(tmpPath);
    });
    (0, vitest_1.it)("every verified entry has valid broken/expected arrays", () => {
        const b = (0, plsb_benchmark_1.buildPLSB)();
        const verified = b.entries.filter(e => e.verified);
        (0, vitest_1.expect)(verified.length).toBeGreaterThan(0);
        for (const e of verified) {
            (0, vitest_1.expect)(e.broken.length).toBeGreaterThan(0);
            (0, vitest_1.expect)(e.expected.length).toBeGreaterThan(0);
            (0, vitest_1.expect)(e.category).toBeTruthy();
            (0, vitest_1.expect)(e.source).toBeTruthy();
        }
    });
    (0, vitest_1.it)("verified recall exceeds 85%", () => {
        const b = (0, plsb_benchmark_1.buildPLSB)();
        const verified = b.entries.filter(e => e.verified);
        if (verified.length === 0)
            return;
        const goldDataset = {
            cases: verified.map(e => ({
                id: e.id, category: e.category, severity: e.severity,
                broken: e.broken, expected: e.expected,
                verifiedBy: e.source, notes: e.notes,
            })),
            metadata: { total: verified.length, byCategory: {}, verifiedBy: {} },
        };
        const result = (0, gold_cve_1.runGoldBenchmark)(goldDataset);
        (0, vitest_1.expect)(result.recall).toBeGreaterThan(0.85);
    });
    (0, vitest_1.it)("at least 5 PLS categories are covered", () => {
        const b = (0, plsb_benchmark_1.buildPLSB)();
        (0, vitest_1.expect)(b.metadata.coverage.covered).toBeGreaterThanOrEqual(5);
    });
    (0, vitest_1.it)("all entries map to valid PLS IDs or none", () => {
        const b = (0, plsb_benchmark_1.buildPLSB)();
        const validPLS = new Set(plsb_benchmark_1.PROTOCOL_WEAKNESS_TAXONOMY.map(t => t.id));
        for (const e of b.entries) {
            if (e.pls_id) {
                (0, vitest_1.expect)(validPLS.has(e.pls_id)).toBe(true);
            }
        }
    });
    (0, vitest_1.it)("prints report without throwing", () => {
        const b = (0, plsb_benchmark_1.buildPLSB)();
        (0, vitest_1.expect)(() => (0, plsb_benchmark_1.printPLSBReport)(b)).not.toThrow();
    });
});
