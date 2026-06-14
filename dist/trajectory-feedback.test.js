"use strict";
/**
 * P2: Trajectory Feedback Tests — pre-burial for P4 Reward Model
 *
 * These tests verify that feedback and cost fields survive
 * write→read roundtrips through the trajectory corpus.
 *
 * IMPORTANT: process.env.PROGMUNE_PROJECT_DIR must be set BEFORE
 * importing from failure-corpus, because module-level path constants
 * are computed at import time. This file sets the env var FIRST.
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
// ═══ MUST be set before any import from failure-corpus ═══
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const FEEDBACK_TEST_DIR = path.resolve(__dirname, "..", "test-corpus-feedback");
process.env.PROGMUNE_PROJECT_DIR = FEEDBACK_TEST_DIR;
// Ensure directories exist before module loads
fs.mkdirSync(FEEDBACK_TEST_DIR, { recursive: true });
fs.mkdirSync(path.join(FEEDBACK_TEST_DIR, ".progmune_corpus"), { recursive: true });
fs.mkdirSync(path.join(FEEDBACK_TEST_DIR, ".progmune_corpus", "trajectories"), { recursive: true });
// ═══ Now safe to import ═══
const vitest_1 = require("vitest");
const failure_corpus_1 = require("./failure-corpus");
(0, vitest_1.describe)("P2: Trajectory feedback", () => {
    (0, vitest_1.it)("stores accepted repair feedback on TrajectoryRecord", () => {
        (0, failure_corpus_1.recordTrajectory)({
            protocol: "FileProtocol",
            initialState: ["FILE_OPEN"],
            finalState: [],
            trajectory: ["open_file", "write_file", "close_file"],
            result: "repair",
            violationType: "resource_leak",
            violationDesc: "File not closed",
            fixPath: ["close_file"],
            successRate: 1.0,
            source: "planner",
            feedback: { accepted: true, rejected: false },
            cost: { latency: 12, actions: 3 },
        });
        const trajectories = (0, failure_corpus_1.loadTrajectories)();
        const accepted = trajectories.filter(t => t.result === "repair" && t.feedback?.accepted === true);
        (0, vitest_1.expect)(accepted.length).toBeGreaterThanOrEqual(1);
        const withCost = trajectories.filter(t => t.cost?.latency !== undefined);
        (0, vitest_1.expect)(withCost.length).toBeGreaterThanOrEqual(1);
    });
    (0, vitest_1.it)("stores rejected repair feedback", () => {
        (0, failure_corpus_1.recordTrajectory)({
            protocol: "FileProtocol",
            initialState: ["FILE_OPEN"],
            finalState: ["FILE_OPEN"],
            trajectory: ["open_file", "write_file"],
            result: "repair",
            violationType: "resource_leak",
            violationDesc: "Attempted fix but still leaking",
            fixPath: ["close_file"],
            successRate: 0.0,
            source: "planner",
            feedback: { accepted: false, rejected: true },
            cost: { latency: 8, actions: 2 },
        });
        const trajectories = (0, failure_corpus_1.loadTrajectories)();
        const rejected = trajectories.filter(t => t.result === "repair" && t.feedback?.rejected === true);
        (0, vitest_1.expect)(rejected.length).toBeGreaterThanOrEqual(1);
    });
    (0, vitest_1.it)("accumulates feedback statistics for future reward model", () => {
        const all = (0, failure_corpus_1.loadTrajectories)().filter(t => t.result === "repair");
        const accepted = all.filter(t => t.feedback?.accepted === true).length;
        const rejected = all.filter(t => t.feedback?.rejected === true).length;
        const total = accepted + rejected;
        (0, vitest_1.expect)(total).toBeGreaterThanOrEqual(2);
        const acceptanceRate = accepted / total;
        (0, vitest_1.expect)(acceptanceRate).toBeGreaterThanOrEqual(0);
        (0, vitest_1.expect)(acceptanceRate).toBeLessThanOrEqual(1);
        // Cost summary for P4 reward model
        const costs = all
            .map(t => t.cost?.latency)
            .filter((l) => l !== undefined);
        (0, vitest_1.expect)(costs.length).toBeGreaterThanOrEqual(1);
        const avgLatency = costs.reduce((s, l) => s + l, 0) / costs.length;
        (0, vitest_1.expect)(avgLatency).toBeGreaterThan(0);
    });
});
