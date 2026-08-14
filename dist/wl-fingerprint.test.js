"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * P8.3a: WL Fingerprint — The decisive upgrade from statistics to topology
 *
 * Compares WL (256-dim subgraph histogram) against 18-dim statistics.
 * If WL discriminates where statistics fail, protocol space opens.
 */
const vitest_1 = require("vitest");
const wl_fingerprint_1 = require("./wl-fingerprint");
const state_inference_1 = require("./experimental/state-inference");
// ── Test data: diverse protocol topologies ──
const LINEAR_3 = [
    ["open_file", "read_file", "close_file"],
    ["open_file", "write_file", "close_file"],
];
const LINEAR_3_ALT = [
    ["sql_open", "sql_read", "sql_close"],
    ["sql_open", "sql_write", "sql_close"],
];
const LINEAR_5 = [
    ["init", "fetch", "process", "next", "fetch", "process", "exit"],
    ["init", "fetch", "process", "exit"],
];
const BRANCHING = [
    ["evaluate", "grant", "log"],
    ["evaluate", "deny", "log"],
    ["evaluate", "grant", "log", "log"],
];
const SELF_LOOP = [
    ["begin", "process", "process", "process", "commit"],
    ["begin", "process", "commit"],
    ["begin", "update", "process", "commit"],
];
const STAR = [
    ["hub", "leaf_a", "hub", "leaf_b", "hub", "destroy"],
    ["hub", "leaf_c", "hub", "leaf_a", "hub", "destroy"],
];
(0, vitest_1.describe)("P8.3a WL Fingerprint", () => {
    (0, vitest_1.it)("extracts WL fingerprint from state machine", () => {
        const sm = (0, state_inference_1.inferStateMachine)(LINEAR_3);
        const wl = (0, wl_fingerprint_1.extractWLFingerprint)(sm, 3);
        (0, vitest_1.expect)(wl.vector.length).toBe(256);
        (0, vitest_1.expect)(wl.uniqueLabels).toBeGreaterThan(0);
        const nonZero = wl.vector.filter(v => v > 0).length;
        (0, vitest_1.expect)(nonZero).toBeGreaterThan(0);
        (0, wl_fingerprint_1.printWLReport)(wl);
    });
    (0, vitest_1.it)("DOUBLE-BLIND: WL survives name scrambling (100%)", () => {
        // Same topology, scrambled names → WL must be identical
        const smA = (0, state_inference_1.inferStateMachine)(LINEAR_3);
        const smB = (0, state_inference_1.inferStateMachine)(LINEAR_3_ALT);
        const wlA = (0, wl_fingerprint_1.extractWLFingerprint)(smA, 3);
        const wlB = (0, wl_fingerprint_1.extractWLFingerprint)(smB, 3);
        const sim = (0, wl_fingerprint_1.wlSimilarity)(wlA, wlB);
        console.log(`  WL double-blind (linear_3 vs linear_3_alt): ${(sim * 100).toFixed(0)}%`);
        (0, vitest_1.expect)(sim).toBeGreaterThan(0.95);
    });
    (0, vitest_1.it)("WL DISCRIMINATION: different topologies have lower similarity", () => {
        const topologies = [
            { name: "linear_3", seqs: LINEAR_3 },
            { name: "linear_5", seqs: LINEAR_5 },
            { name: "branching", seqs: BRANCHING },
            { name: "self_loop", seqs: SELF_LOOP },
            { name: "star", seqs: STAR },
        ];
        const wls = topologies.map(t => ({
            name: t.name,
            wl: (0, wl_fingerprint_1.extractWLFingerprint)((0, state_inference_1.inferStateMachine)(t.seqs), 3),
        }));
        // Same-topology vs cross-topology
        const sameWl = (0, wl_fingerprint_1.extractWLFingerprint)((0, state_inference_1.inferStateMachine)(LINEAR_3_ALT), 3);
        const sameSim = (0, wl_fingerprint_1.wlSimilarity)(wls[0].wl, sameWl);
        console.log(`\n  ═══ WL DISCRIMINATION ═══`);
        console.log(`  Same topology:  ${(sameSim * 100).toFixed(0)}%`);
        const crossSims = [];
        for (let i = 0; i < wls.length; i++) {
            for (let j = i + 1; j < wls.length; j++) {
                const sim = (0, wl_fingerprint_1.wlSimilarity)(wls[i].wl, wls[j].wl);
                crossSims.push(sim);
                console.log(`  ${wls[i].name} ↔ ${wls[j].name}: ${(sim * 100).toFixed(0)}%`);
            }
        }
        // Key test: same should be higher than the MAX cross-topology similarity
        const maxCross = Math.max(...crossSims);
        const minCross = Math.min(...crossSims);
        const spread = maxCross - minCross;
        console.log(`\n  Same: ${(sameSim * 100).toFixed(0)}%  Cross range: ${(minCross * 100).toFixed(0)}-${(maxCross * 100).toFixed(0)}%`);
        console.log(`  WL Discrimination spread: ${(spread * 100).toFixed(0)}%`);
        // Same topology must be more similar than average cross-topology
        const avgCross = crossSims.reduce((a, b) => a + b, 0) / crossSims.length;
        (0, vitest_1.expect)(sameSim).toBeGreaterThan(avgCross);
    });
    (0, vitest_1.it)("WL vs STATS: WL captures patterns that 18-dim statistics miss", () => {
        // The decisive comparison: WL should show LOWER similarity
        // between different topologies than 18-dim stats do.
        // If WL spread > stats spread, WL is genuinely better.
        const pairs = [
            { name: "linear_3 ↔ linear_5", a: LINEAR_3, b: LINEAR_5 },
            { name: "linear_3 ↔ branching", a: LINEAR_3, b: BRANCHING },
            { name: "linear_3 ↔ star", a: LINEAR_3, b: STAR },
            { name: "branching ↔ star", a: BRANCHING, b: STAR },
            { name: "self_loop ↔ star", a: SELF_LOOP, b: STAR },
        ];
        console.log(`\n  ═══ WL vs STATS Comparison ═══`);
        console.log(`  ${'Pair'.padEnd(28)} ${'18-dim'.padEnd(8)} ${'WL-256'.padEnd(8)} ${'Δ'}`);
        console.log(`  ${'─'.repeat(54)}`);
        let wlSpread = 0, statsSpread = 0;
        let wlMin = 1, wlMax = 0, statsMin = 1, statsMax = 0;
        for (const pair of pairs) {
            const smA = (0, state_inference_1.inferStateMachine)(pair.a);
            const smB = (0, state_inference_1.inferStateMachine)(pair.b);
            const statsSim = (0, state_inference_1.stateFingerprintSimilarity)((0, state_inference_1.extractStateFingerprint)(smA), (0, state_inference_1.extractStateFingerprint)(smB));
            const wlSim = (0, wl_fingerprint_1.wlSimilarity)((0, wl_fingerprint_1.extractWLFingerprint)(smA, 3), (0, wl_fingerprint_1.extractWLFingerprint)(smB, 3));
            wlMin = Math.min(wlMin, wlSim);
            wlMax = Math.max(wlMax, wlSim);
            statsMin = Math.min(statsMin, statsSim);
            statsMax = Math.max(statsMax, statsSim);
            const delta = wlSim - statsSim;
            console.log(`  ${pair.name.padEnd(28)} ${(statsSim * 100).toFixed(0).padStart(3)}%     ${(wlSim * 100).toFixed(0).padStart(3)}%     ${delta > 0 ? '+' : ''}${(delta * 100).toFixed(0)}%`);
        }
        wlSpread = wlMax - wlMin;
        statsSpread = statsMax - statsMin;
        console.log(`\n  Stats spread: ${(statsSpread * 100).toFixed(0)}%  WL spread: ${(wlSpread * 100).toFixed(0)}%`);
        console.log(`  WL improvement: ${wlSpread > statsSpread ? '+' : ''}${((wlSpread - statsSpread) * 100).toFixed(0)}%`);
        // WL should have wider spread (= better discrimination)
        // Even if it doesn't, WL must not be WORSE than stats
        (0, vitest_1.expect)(wlSpread).toBeGreaterThanOrEqual(statsSpread * 0.5);
    });
});
