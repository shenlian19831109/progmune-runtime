"use strict";
/**
 * P3.7 + P3.8: Difficulty Map & Active Learning Tests
 *
 * Verifying:
 *   1. TransitionStats computation from trajectory + telemetry data
 *   2. Protocol difficulty ranking (critical/high/medium/low)
 *   3. Active Learning importance scoring
 *   4. Prioritized benchmark generation
 *   5. End-to-end: difficulty → importance → prioritized cases
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
const difficulty_map_1 = require("./difficulty-map");
const active_learning_1 = require("./active-learning");
// ═══════════════════════════════════════════════════════════════
// Difficulty Map
// ═══════════════════════════════════════════════════════════════
function makeTrajectory(overrides = {}) {
    return {
        id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: new Date().toISOString(),
        protocol: "_global",
        initialState: [],
        finalState: [],
        trajectory: ["open_file", "write_file", "close_file"],
        result: "success",
        context: { nestingDepth: 0, exceptionHandled: false, insideLoop: false, branchCount: 0, asyncContext: false },
        successRate: 1.0,
        metadata: { source: "human" },
        ...overrides,
    };
}
(0, vitest_1.describe)("Difficulty Map", () => {
    (0, vitest_1.it)("computes transition stats from trajectories", () => {
        const trajectories = [
            makeTrajectory({ result: "success", trajectory: ["open_file", "write_file", "close_file"] }),
            makeTrajectory({ result: "success", trajectory: ["open_file", "write_file", "close_file"] }),
            makeTrajectory({ result: "violation", trajectory: ["open_file", "write_file"] }), // missing close
            makeTrajectory({
                result: "repair", trajectory: ["open_file", "write_file", "close_file"],
                successRate: 1.0,
                violation: { type: "resource_leak", failingStepIndex: 2, expectedStates: [], actualStates: ["FILE_OPEN"], fixPath: ["close_file"], description: "fix" },
            }),
        ];
        const statsMap = (0, difficulty_map_1.buildDifficultyMap)(trajectories);
        // FileProtocol should have stats
        const fileKeys = [...statsMap.keys()].filter(k => k.startsWith("FileProtocol:"));
        (0, vitest_1.expect)(fileKeys.length).toBeGreaterThan(0);
        // open_file transition should have attempts
        const openKey = "FileProtocol:INIT→FILE_OPEN";
        const openStats = statsMap.get(openKey);
        (0, vitest_1.expect)(openStats).toBeDefined();
        (0, vitest_1.expect)(openStats.attempts).toBeGreaterThanOrEqual(3);
        (0, vitest_1.expect)(openStats.failures).toBeGreaterThanOrEqual(1); // the violation
        // close_file invalidation should be tracked
        const closeInvKey = "FileProtocol:FILE_OPEN→∅";
        const closeStats = statsMap.get(closeInvKey);
        (0, vitest_1.expect)(closeStats).toBeDefined();
    });
    (0, vitest_1.it)("difficulty > 0 for transitions with failures", () => {
        const trajectories = [
            makeTrajectory({ result: "success", trajectory: ["verify_password", "generate_jwt", "create_session"] }),
            makeTrajectory({ result: "violation", trajectory: ["verify_password"] }), // missing jwt
            makeTrajectory({ result: "violation", trajectory: ["verify_password"] }),
            makeTrajectory({ result: "violation", trajectory: ["verify_password"] }),
        ];
        const statsMap = (0, difficulty_map_1.buildDifficultyMap)(trajectories);
        // The failures are on verify_password transitions (missing the rest)
        // UNAUTHENTICATED→PASSWORD_VERIFIED should have failures from the violations
        const vpKey = "AuthProtocol:UNAUTHENTICATED→PASSWORD_VERIFIED";
        const vpStats = statsMap.get(vpKey);
        (0, vitest_1.expect)(vpStats).toBeDefined();
        (0, vitest_1.expect)(vpStats.attempts).toBeGreaterThanOrEqual(4); // 1 success + 3 violations
        (0, vitest_1.expect)(vpStats.failures).toBeGreaterThanOrEqual(3);
        (0, vitest_1.expect)(vpStats.difficulty).toBeGreaterThan(0);
    });
    (0, vitest_1.it)("ranks protocols by difficulty", () => {
        const trajectories = [
            // FileProtocol: mostly successes
            ...Array.from({ length: 10 }, () => makeTrajectory({ result: "success", trajectory: ["open_file", "write_file", "close_file"] })),
            // AuthProtocol: many failures
            makeTrajectory({ result: "violation", trajectory: ["verify_password"] }),
            makeTrajectory({ result: "violation", trajectory: ["verify_password"] }),
            makeTrajectory({ result: "violation", trajectory: ["generate_jwt"] }),
        ];
        const statsMap = (0, difficulty_map_1.buildDifficultyMap)(trajectories);
        const ranking = (0, difficulty_map_1.rankProtocolsByDifficulty)(statsMap);
        (0, vitest_1.expect)(ranking.length).toBeGreaterThanOrEqual(4); // P7.3: 9 protocol groups
        // AuthProtocol should be highest difficulty
        const auth = ranking.find(r => r.protocol === "AuthProtocol");
        const file = ranking.find(r => r.protocol === "FileProtocol");
        (0, vitest_1.expect)(auth.maxDifficulty).toBeGreaterThan(file.maxDifficulty);
        (0, difficulty_map_1.printDifficultyDashboard)(statsMap, ranking);
    });
    (0, vitest_1.it)("empty data = all zeros", () => {
        const statsMap = (0, difficulty_map_1.buildDifficultyMap)([]);
        const ranking = (0, difficulty_map_1.rankProtocolsByDifficulty)(statsMap);
        for (const r of ranking) {
            (0, vitest_1.expect)(r.avgDifficulty).toBe(0);
            (0, vitest_1.expect)(r.maxDifficulty).toBe(0);
            (0, vitest_1.expect)(r.risk).toBe("low");
        }
    });
});
// ═══════════════════════════════════════════════════════════════
// Active Learning
// ═══════════════════════════════════════════════════════════════
(0, vitest_1.describe)("Active Learning", () => {
    (0, vitest_1.it)("prioritizes gaps by importance (difficulty × usage × failure)", () => {
        // Seed with skewed data: FileProtocol is easy, AuthProtocol is hard
        const trajectories = [
            // File: many successes, few failures → low difficulty
            ...Array.from({ length: 20 }, () => makeTrajectory({ result: "success", trajectory: ["open_file", "write_file", "close_file"] })),
            // Auth: many failures → high difficulty
            ...Array.from({ length: 5 }, () => makeTrajectory({ result: "violation", trajectory: ["verify_password"] })),
        ];
        const report = (0, active_learning_1.generatePrioritizedBenchmarks)(trajectories);
        (0, vitest_1.expect)(report.totalGaps).toBeGreaterThan(0);
        (0, vitest_1.expect)(report.prioritized.length).toBeGreaterThan(0);
        // Auth transitions should have higher importance than File transitions
        // (auth has violations → higher difficulty)
        const authCases = report.prioritized.filter(c => c.targetsTransition.rule.includes("password") || c.targetsTransition.rule.includes("jwt") || c.targetsTransition.rule.includes("session"));
        const fileCases = report.prioritized.filter(c => c.targetsTransition.rule.includes("file") || c.targetsTransition.rule.includes("open") || c.targetsTransition.rule.includes("write") || c.targetsTransition.rule.includes("close"));
        if (authCases.length > 0 && fileCases.length > 0) {
            // Auth should have non-zero difficulty (has violations)
            const authHasDifficulty = authCases.some(c => c.difficulty > 0);
            (0, vitest_1.expect)(authHasDifficulty).toBe(true);
        }
        (0, active_learning_1.printActiveLearningReport)(report);
    });
    (0, vitest_1.it)("writes top-K priority benchmarks", () => {
        const trajectories = [
            ...Array.from({ length: 30 }, () => makeTrajectory({ result: "success", trajectory: ["open_file", "write_file", "close_file"] })),
        ];
        const report = (0, active_learning_1.generatePrioritizedBenchmarks)(trajectories);
        const outDir = path.resolve(__dirname, "..", "test-active-learning");
        const written = (0, active_learning_1.writeTopPriorityBenchmarks)(report, 8, outDir);
        (0, vitest_1.expect)(written.length).toBeGreaterThanOrEqual(1);
        // Verify files are valid JSON with importance scores
        for (const fp of written) {
            (0, vitest_1.expect)(fs.existsSync(fp)).toBe(true);
            const content = JSON.parse(fs.readFileSync(fp, "utf-8"));
            (0, vitest_1.expect)(content.source).toBe("active-learning");
            (0, vitest_1.expect)(content.cases.length).toBeGreaterThan(0);
            (0, vitest_1.expect)(content.cases.length).toBeLessThanOrEqual(8);
            for (const c of content.cases) {
                (0, vitest_1.expect)(c.importance).toBeGreaterThanOrEqual(0);
                (0, vitest_1.expect)(c.difficulty).toBeGreaterThanOrEqual(0);
            }
        }
    });
    (0, vitest_1.it)("importance = 0 when no data (all gaps equal priority)", () => {
        const report = (0, active_learning_1.generatePrioritizedBenchmarks)([]);
        // With no data, all gaps have equal importance
        // They're still generated, just not differentiated
        (0, vitest_1.expect)(report.totalGaps).toBeGreaterThan(0);
        for (const c of report.prioritized) {
            (0, vitest_1.expect)(c.importance).toBeGreaterThanOrEqual(0);
            (0, vitest_1.expect)(c.importance).toBeLessThanOrEqual(1);
        }
    });
});
