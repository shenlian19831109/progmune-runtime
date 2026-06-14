"use strict";
/**
 * P3.11-13: Pairwise Preference Tests
 *
 * Verifying:
 *   1. Pairwise preference recording and win rate computation
 *   2. Ranker stress test with acceptable/unacceptable patterns
 *   3. PreferenceRanker using pairwise win rates
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const pairwise_preference_1 = require("./pairwise-preference");
const planner_telemetry_1 = require("./planner-telemetry");
// ═══════════════════════════════════════════════════════════════
// P3.11: Pairwise Preference
// ═══════════════════════════════════════════════════════════════
(0, vitest_1.describe)("Pairwise Preference", () => {
    (0, vitest_1.it)("records and queries win rates", () => {
        const store = (0, pairwise_preference_1.createPreferenceStore)();
        const fpA = (0, planner_telemetry_1.candidateFingerprint)("FileProtocol", ["open_file", "write_file", "close_file"], "resource_leak");
        const fpB = (0, planner_telemetry_1.candidateFingerprint)("FileProtocol", ["open_file", "write_file"], "resource_leak");
        const fpC = (0, planner_telemetry_1.candidateFingerprint)("FileProtocol", ["atomic_write"], "resource_leak");
        // A beats B 8 times
        for (let i = 0; i < 8; i++) {
            (0, pairwise_preference_1.recordPreference)(store, fpA, fpB, "safely write config file", "FileProtocol");
        }
        // B beats A 2 times
        for (let i = 0; i < 2; i++) {
            (0, pairwise_preference_1.recordPreference)(store, fpB, fpA, "safely write config file", "FileProtocol");
        }
        // A beats C 5 times
        for (let i = 0; i < 5; i++) {
            (0, pairwise_preference_1.recordPreference)(store, fpA, fpC, "safely write config file", "FileProtocol");
        }
        (0, vitest_1.expect)(store.preferences.length).toBe(15);
        // A: 8+5=13 wins / 10+5=15 comparisons = 86.7%
        const aRate = (0, pairwise_preference_1.getWinRate)(store, fpA, 3);
        (0, vitest_1.expect)(aRate).toBeCloseTo(13 / 15, 2);
        // B: 2 wins / 10 comparisons = 20%
        const bRate = (0, pairwise_preference_1.getWinRate)(store, fpB, 3);
        (0, vitest_1.expect)(bRate).toBe(0.2);
        // C: 0 wins / 5 comparisons = 0%
        const cRate = (0, pairwise_preference_1.getWinRate)(store, fpC, 3);
        (0, vitest_1.expect)(cRate).toBe(0);
        // Unknown fingerprint: default 0.5
        const unknown = (0, pairwise_preference_1.getWinRate)(store, "unknown-fp", 3);
        (0, vitest_1.expect)(unknown).toBe(0.5);
    });
    (0, vitest_1.it)("defaults to 0.5 for fingerprints with insufficient comparisons", () => {
        const store = (0, pairwise_preference_1.createPreferenceStore)();
        const fp = (0, planner_telemetry_1.candidateFingerprint)("FileProtocol", ["close_file"], "resource_leak");
        (0, pairwise_preference_1.recordPreference)(store, fp, "other", "test", "FileProtocol");
        // 1 win, 1 comparison → need 3 minimum
        (0, vitest_1.expect)((0, pairwise_preference_1.getWinRate)(store, fp, 3)).toBe(0.5);
        // 1 win, 1 comparison → enough for min 1
        (0, vitest_1.expect)((0, pairwise_preference_1.getWinRate)(store, fp, 1)).toBe(1.0);
    });
});
// ═══════════════════════════════════════════════════════════════
// P3.12: Ranker Stress Test
// ═══════════════════════════════════════════════════════════════
function fakeCandidateGenerator(goal, _protocol) {
    if (goal.includes("safely write")) {
        return [
            { id: "safe", source: "protocol", actions: fnActions(["open_file", "write_file", "close_file"]), explanation: "safe" },
            { id: "flush", source: "corpus", actions: fnActions(["open_file", "write_file", "flush", "close_file"]), explanation: "safe+flush" },
            { id: "leak", source: "corpus", actions: fnActions(["open_file", "write_file"]), explanation: "leaky" },
            { id: "bare", source: "antibody", actions: fnActions(["write_file"]), explanation: "bare" },
        ];
    }
    if (goal.includes("authenticate")) {
        return [
            { id: "full", source: "protocol", actions: fnActions(["verify_password", "generate_jwt", "create_session"]), explanation: "full" },
            { id: "partial", source: "protocol", actions: fnActions(["verify_password", "generate_jwt"]), explanation: "partial" },
            { id: "skip", source: "antibody", actions: fnActions(["generate_jwt"]), explanation: "skip-verify" },
            { id: "wrong", source: "corpus", actions: fnActions(["logout"]), explanation: "wrong" },
        ];
    }
    return [];
}
function fnActions(fns) {
    return fns.map(fn => ({ kind: "call", function: fn, args: [] }));
}
(0, vitest_1.describe)("Ranker Stress Test", () => {
    (0, vitest_1.it)("measures top-1 accuracy and top-3 acceptability", () => {
        const testCases = pairwise_preference_1.PAIRWISE_BENCHMARK_CASES.slice(0, 2); // first 2
        const report = (0, pairwise_preference_1.runRankerStressTest)(testCases, fakeCandidateGenerator);
        (0, vitest_1.expect)(report.cases).toBe(2);
        (0, vitest_1.expect)(report.top1Accuracy).toBeGreaterThanOrEqual(0);
        (0, vitest_1.expect)(report.top3Acceptability).toBeGreaterThanOrEqual(0);
        (0, vitest_1.expect)(report.unacceptableFiltered).toBeGreaterThanOrEqual(0);
        // With our fake generator: safe+flush both in top 3 for file case, full+partial for auth
        (0, vitest_1.expect)(report.top3Acceptability).toBeGreaterThan(0.5);
        (0, pairwise_preference_1.printRankerStressReport)(report);
    });
    (0, vitest_1.it)("all benchmark cases have expectedTop1, acceptableTop3, unacceptableRepairs", () => {
        for (const c of pairwise_preference_1.PAIRWISE_BENCHMARK_CASES) {
            (0, vitest_1.expect)(c.expectedTop1.length).toBeGreaterThan(0);
            (0, vitest_1.expect)(c.acceptableTop3.length).toBeGreaterThan(0);
            (0, vitest_1.expect)(c.unacceptableRepairs.length).toBeGreaterThan(0);
        }
    });
});
// ═══════════════════════════════════════════════════════════════
// P3.13: PreferenceRanker
// ═══════════════════════════════════════════════════════════════
(0, vitest_1.describe)("PreferenceRanker", () => {
    (0, vitest_1.it)("ranks candidates by pairwise win rate", () => {
        const store = (0, pairwise_preference_1.createPreferenceStore)();
        const safeFp = (0, planner_telemetry_1.candidateFingerprint)("FileProtocol", ["open_file", "write_file", "close_file"], "resource_leak");
        const leakFp = (0, planner_telemetry_1.candidateFingerprint)("FileProtocol", ["open_file", "write_file"], "resource_leak");
        // Safe beats leak 9 times, leak beats safe 1 time
        for (let i = 0; i < 9; i++)
            (0, pairwise_preference_1.recordPreference)(store, safeFp, leakFp, "write file", "FileProtocol");
        for (let i = 0; i < 1; i++)
            (0, pairwise_preference_1.recordPreference)(store, leakFp, safeFp, "write file", "FileProtocol");
        const ranker = new pairwise_preference_1.PreferenceRanker(store);
        const safe = { id: "safe", source: "protocol", actions: fnActions(["open_file", "write_file", "close_file"]), explanation: "safe" };
        const leak = { id: "leak", source: "corpus", actions: fnActions(["open_file", "write_file"]), explanation: "leaky" };
        const features = [
            { protocolSafety: 1.0, historicalSuccessRate: 0.5, actionCount: 3, latencyCost: 0.6, auditability: 0.8, corpusEvidence: 0, source: "protocol" },
            { protocolSafety: 0.3, historicalSuccessRate: 0.5, actionCount: 2, latencyCost: 0.4, auditability: 0.5, corpusEvidence: 0, source: "corpus" },
        ];
        const ranked = ranker.rank([leak, safe], features, "FileProtocol", "resource_leak");
        // Safe should rank higher (90% win rate vs 10%)
        (0, vitest_1.expect)(ranked[0].id).toBe("safe");
        (0, vitest_1.expect)(ranked[1].id).toBe("leak");
    });
    (0, vitest_1.it)("defaults to heuristic when no preference data", () => {
        const ranker = new pairwise_preference_1.PreferenceRanker();
        const safe = { id: "safe", source: "protocol", actions: fnActions(["open_file", "write_file", "close_file"]), explanation: "safe" };
        const leak = { id: "leak", source: "antibody", actions: fnActions(["open_file", "write_file"]), explanation: "missing close" };
        // Safe has higher protocolSafety, leak has lower (missing close = unsafe)
        const safeFeatures = { protocolSafety: 1.0, historicalSuccessRate: 0.5, actionCount: 3, latencyCost: 0.6, auditability: 0.8, corpusEvidence: 0, source: "protocol" };
        const leakFeatures = { protocolSafety: 0.2, historicalSuccessRate: 0.3, actionCount: 2, latencyCost: 0.4, auditability: 0.4, corpusEvidence: 0, source: "antibody" };
        // Without preference data, falls back to heuristic
        const ranked = ranker.rank([leak, safe], [leakFeatures, safeFeatures], "FileProtocol");
        (0, vitest_1.expect)(ranked[0].id).toBe("safe");
    });
});
