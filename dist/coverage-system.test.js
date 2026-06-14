"use strict";
/**
 * P3.6: Coverage System Integration Tests
 *
 * Verifying:
 *   1. Coverage engine correctly computes state/transition coverage
 *   2. Dashboard visualizes gaps and risk ranking
 *   3. Benchmark generator produces cases for uncovered transitions
 *   4. End-to-end: analyze → generate → new cases
 */
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
const vitest_1 = require("vitest");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const protocol_coverage_1 = require("./protocol-coverage");
const coverage_dashboard_1 = require("./coverage-dashboard");
const benchmark_generator_1 = require("./benchmark-generator");
// ═══════════════════════════════════════════════════════════════
// Coverage Engine
// ═══════════════════════════════════════════════════════════════
(0, vitest_1.describe)("Coverage Engine", () => {
    function makeFileRules() {
        return new Map([
            ["open_file", { pre_states: [], post_states: ["FILE_OPEN"] }],
            ["write_file", { pre_states: ["FILE_OPEN"], post_states: ["FILE_DIRTY"] }],
            ["close_file", { pre_states: ["FILE_OPEN", "FILE_DIRTY"], post_states: [], invalidate: ["FILE_OPEN", "FILE_DIRTY"] }],
        ]);
    }
    const fileProto = (0, protocol_coverage_1.parseProtocolDefinition)("FileProtocol", makeFileRules(), "INIT");
    (0, vitest_1.it)("computes full coverage when all transitions visited", () => {
        const trajectories = [{
                id: "t1", timestamp: new Date().toISOString(),
                protocol: "FileProtocol", initialState: ["INIT"], finalState: [],
                trajectory: ["open_file", "write_file", "close_file"],
                result: "success", context: { nestingDepth: 0, exceptionHandled: false, insideLoop: false, branchCount: 0, asyncContext: false },
                successRate: 1.0, metadata: { source: "human" },
            }];
        const report = (0, protocol_coverage_1.analyzeCoverage)(fileProto, trajectories);
        (0, vitest_1.expect)(report.transitionCoverage.transitionCoverage).toBeGreaterThan(0.5);
        (0, vitest_1.expect)(report.stateCoverage.stateCoverage).toBeGreaterThan(0.5);
    });
    (0, vitest_1.it)("detects uncovered transitions", () => {
        const trajectories = [{
                id: "t2", timestamp: new Date().toISOString(),
                protocol: "FileProtocol", initialState: ["INIT"], finalState: [],
                trajectory: ["open_file", "close_file"], // missing write_file
                result: "success", context: { nestingDepth: 0, exceptionHandled: false, insideLoop: false, branchCount: 0, asyncContext: false },
                successRate: 1.0, metadata: { source: "human" },
            }];
        const report = (0, protocol_coverage_1.analyzeCoverage)(fileProto, trajectories);
        (0, vitest_1.expect)(report.transitionCoverage.missingTransitions.length).toBeGreaterThan(0);
    });
    (0, vitest_1.it)("empty trajectories = zero coverage", () => {
        const report = (0, protocol_coverage_1.analyzeCoverage)(fileProto, []);
        (0, vitest_1.expect)(report.transitionCoverage.transitionCoverage).toBe(0);
        (0, vitest_1.expect)(report.stateCoverage.stateCoverage).toBe(0);
        (0, vitest_1.expect)(report.trajectoryCount).toBe(0);
    });
});
// ═══════════════════════════════════════════════════════════════
// Default Protocol Definitions
// ═══════════════════════════════════════════════════════════════
(0, vitest_1.describe)("Default Protocol Definitions", () => {
    (0, vitest_1.it)("loads all 9 protocol groups", () => {
        const protocols = (0, protocol_coverage_1.loadDefaultProtocolDefinitions)();
        (0, vitest_1.expect)(protocols.length).toBeGreaterThanOrEqual(9);
        const names = protocols.map(p => p.name);
        (0, vitest_1.expect)(names).toContain("FileProtocol");
        (0, vitest_1.expect)(names).toContain("AuthProtocol");
        (0, vitest_1.expect)(names).toContain("DBProtocol");
        (0, vitest_1.expect)(names).toContain("IRProtocol");
        (0, vitest_1.expect)(names).toContain("StatelessProtocol");
        (0, vitest_1.expect)(names).toContain("TransactionProtocol");
        (0, vitest_1.expect)(names).toContain("ConditionalProtocol");
        (0, vitest_1.expect)(names).toContain("LoopProtocol");
        (0, vitest_1.expect)(names).toContain("CrossProtocol");
    });
    (0, vitest_1.it)("each protocol (except stateless) has states and transitions", () => {
        for (const p of (0, protocol_coverage_1.loadDefaultProtocolDefinitions)()) {
            (0, vitest_1.expect)(p.states.length).toBeGreaterThan(0);
            // StatelessProtocol has empty pre/post states → 0 acquire transitions
            if (p.name === "StatelessProtocol") {
                (0, vitest_1.expect)(p.transitions.length).toBeGreaterThanOrEqual(0);
            }
            else {
                (0, vitest_1.expect)(p.transitions.length).toBeGreaterThan(0);
            }
        }
    });
    (0, vitest_1.it)("FileProtocol has open/write/close transitions", () => {
        const file = (0, protocol_coverage_1.loadDefaultProtocolDefinitions)().find(p => p.name === "FileProtocol");
        const tKeys = file.transitions.map(t => `${t.from}→${t.to}`);
        (0, vitest_1.expect)(tKeys).toContain("INIT→FILE_OPEN"); // open_file
        (0, vitest_1.expect)(tKeys).toContain("FILE_OPEN→∅"); // close_file invalidates FILE_OPEN
    });
    (0, vitest_1.it)("AuthProtocol has auth lifecycle transitions", () => {
        const auth = (0, protocol_coverage_1.loadDefaultProtocolDefinitions)().find(p => p.name === "AuthProtocol");
        const tKeys = auth.transitions.map(t => `${t.from}→${t.to}`);
        (0, vitest_1.expect)(tKeys).toContain("UNAUTHENTICATED→PASSWORD_VERIFIED"); // verify_password
        (0, vitest_1.expect)(tKeys).toContain("PASSWORD_VERIFIED→TOKEN_ISSUED"); // generate_jwt
        (0, vitest_1.expect)(tKeys).toContain("TOKEN_ISSUED→SESSION_ACTIVE"); // create_session
        (0, vitest_1.expect)(tKeys).toContain("SESSION_ACTIVE→UNAUTHENTICATED"); // logout
    });
});
// ═══════════════════════════════════════════════════════════════
// Coverage Dashboard
// ═══════════════════════════════════════════════════════════════
const GEN_DIR = path.resolve(__dirname, "..", "test-coverage-gen");
process.env.PROGMUNE_PROJECT_DIR = GEN_DIR;
fs.mkdirSync(GEN_DIR, { recursive: true });
fs.mkdirSync(path.join(GEN_DIR, ".progmune_corpus", "trajectories"), { recursive: true });
(0, vitest_1.describe)("Coverage Dashboard", () => {
    (0, vitest_1.it)("generates dashboard from current trajectories", () => {
        const dashboard = (0, coverage_dashboard_1.generateCoverageDashboard)([]);
        (0, vitest_1.expect)(dashboard.reports.length).toBeGreaterThanOrEqual(9);
        (0, vitest_1.expect)(dashboard.riskRanking.length).toBeGreaterThanOrEqual(9);
        (0, vitest_1.expect)(dashboard.overallTransitionCoverage).toBeGreaterThanOrEqual(0);
        (0, vitest_1.expect)(dashboard.overallTransitionCoverage).toBeLessThanOrEqual(1);
        (0, vitest_1.expect)(dashboard.criticalProtocols).toBeGreaterThanOrEqual(0);
        (0, coverage_dashboard_1.printCoverageDashboard)(dashboard);
    });
    (0, vitest_1.it)("correctly ranks empty protocols as critical", () => {
        const dashboard = (0, coverage_dashboard_1.generateCoverageDashboard)([]);
        // With zero trajectories, all protocols should be critical or high risk
        const emptyProtocols = dashboard.riskRanking.filter(r => r.trajectoryCount === 0);
        for (const r of emptyProtocols) {
            (0, vitest_1.expect)(r.stateCoverage).toBe(0);
            (0, vitest_1.expect)(r.transitionCoverage).toBe(0);
            (0, vitest_1.expect)(r.risk).toBe("critical");
        }
    });
});
// ═══════════════════════════════════════════════════════════════
// Benchmark Generator
// ═══════════════════════════════════════════════════════════════
(0, vitest_1.describe)("Benchmark Generator", () => {
    (0, vitest_1.it)("generates cases for uncovered transitions", () => {
        const generated = (0, benchmark_generator_1.generateMissingBenchmarks)([]);
        // With zero trajectories, all protocols have uncovered transitions
        (0, vitest_1.expect)(Object.keys(generated).length).toBeGreaterThanOrEqual(3);
        // Each protocol should have generated cases
        for (const [protocol, cases] of Object.entries(generated)) {
            (0, vitest_1.expect)(cases.length).toBeGreaterThan(0);
            for (const c of cases) {
                (0, vitest_1.expect)(c.broken.length).toBeGreaterThan(0);
                (0, vitest_1.expect)(c.expected.length).toBeGreaterThan(0);
                (0, vitest_1.expect)(c.expected.length).toBeGreaterThan(c.broken.length);
                (0, vitest_1.expect)(["resource_leak", "missing_prerequisite"]).toContain(c.violationType);
            }
        }
    });
    (0, vitest_1.it)("writes generated benchmarks to disk", () => {
        const generated = (0, benchmark_generator_1.generateMissingBenchmarks)([]);
        const outDir = path.resolve(GEN_DIR, "generated-benchmarks");
        const written = (0, benchmark_generator_1.writeGeneratedBenchmarks)(generated, outDir);
        (0, vitest_1.expect)(written.length).toBeGreaterThanOrEqual(3);
        // Verify files exist and are valid JSON
        for (const filepath of written) {
            (0, vitest_1.expect)(fs.existsSync(filepath)).toBe(true);
            const content = JSON.parse(fs.readFileSync(filepath, "utf-8"));
            (0, vitest_1.expect)(content.cases.length).toBeGreaterThan(0);
            (0, vitest_1.expect)(content.source).toBe("coverage-gap");
        }
    });
    (0, vitest_1.it)("runs the full coverage→generation pipeline", () => {
        const result = (0, benchmark_generator_1.runCoverageDrivenGeneration)();
        (0, vitest_1.expect)(result.existingCases).toBeGreaterThanOrEqual(1); // from previous test writes
        (0, vitest_1.expect)(result.generatedCases).toBeGreaterThanOrEqual(10);
        (0, vitest_1.expect)(result.writtenFiles.length).toBeGreaterThanOrEqual(3);
        console.log(`\nCoverage-Driven Generation: ${result.summary}`);
    });
});
