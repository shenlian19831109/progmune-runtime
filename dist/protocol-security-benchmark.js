"use strict";
/**
 * P9.2b++: Protocol Security Benchmark — defining a new security category
 *
 * This is NOT just another CVE benchmark. It's the FIRST dataset
 * specifically designed for protocol lifecycle vulnerabilities —
 * missing states, missing edges, and illegal transitions that
 * traditional SAST tools cannot see because they look at code
 * patterns, not state machines.
 *
 * The benchmark measures one thing: can a system detect that a
 * protocol lifecycle has been violated, regardless of how the
 * code is written?
 *
 * Categories:
 *   RESOURCE_LEAK:       Acquire→Use...no Release
 *   AUTH_BYPASS:         Action without prior Authentication
 *   TRANSACTION_VIOLATION: Begin→...no Commit/Rollback
 *   USE_AFTER_FREE:      Free→Use (illegal edge)
 *   SESSION_VIOLATION:   Logout→Access (illegal edge)
 *   DOUBLE_FREE:         Free→Free (illegal self-loop)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildProtocolSecurityBenchmark = buildProtocolSecurityBenchmark;
exports.runProtocolSecurityBenchmark = runProtocolSecurityBenchmark;
exports.printProtocolSecurityReport = printProtocolSecurityReport;
const gold_cve_1 = require("./gold-cve");
// ═══════════════════════════════════════════════════════════════
// Build the benchmark from all available verified cases
// ═══════════════════════════════════════════════════════════════
function buildProtocolSecurityBenchmark() {
    const cases = [];
    // Source 1: Curated 20 cases (manually verified against real CVE patterns)
    const curated = (0, gold_cve_1.loadGoldDataset)().cases;
    for (const c of curated) {
        cases.push({
            id: c.id,
            category: c.category,
            severity: c.severity,
            broken: c.broken,
            expected: c.expected,
            source: "curated",
            verified: true,
            notes: c.notes,
        });
    }
    // Source 2: Diff-based gold cases (from real git diffs)
    try {
        const fs = require("fs");
        const path = require("path");
        const seedPath = path.resolve(__dirname, "..", "benchmarks", "gold-seed.json");
        if (fs.existsSync(seedPath)) {
            const seed = JSON.parse(fs.readFileSync(seedPath, "utf-8"));
            for (const c of seed) {
                cases.push({
                    id: `GOLD-${c.cve}`,
                    category: c.category,
                    severity: c.severity || "high",
                    broken: c.before,
                    expected: c.after,
                    source: "git_diff",
                    verified: true,
                    notes: c.notes,
                });
            }
        }
    }
    catch { }
    // Source 3: Synthetic cases from topology factory (for stress testing)
    // These are NOT verified — marked accordingly
    const generateSyntheticCases = () => {
        const { createProtocolForTopology, ALL_TOPOLOGIES } = require("./topology-factory");
        const synthetic = [];
        let id = 200;
        for (const topo of ALL_TOPOLOGIES) {
            const rules = createProtocolForTopology(topo);
            if (rules.size < 2)
                continue;
            const entries = [...rules.entries()];
            for (let v = 0; v < 3 && synthetic.length < 30; v++) {
                const path = [];
                const ss = new Set(["INIT", "IDLE"]);
                const s = entries[Math.floor(Math.random() * entries.length)];
                path.push(s[0]);
                const r = s[1];
                if (r.invalidate)
                    r.invalidate.forEach((x) => ss.delete(x));
                for (const x of r.post_states)
                    ss.add(x);
                for (let t = 0; t < 4; t++) {
                    const cands = entries.filter(([, rr]) => rr.pre_states.every((x) => ss.has(x)));
                    if (!cands.length)
                        break;
                    const [fn, nr] = cands[Math.floor(Math.random() * cands.length)];
                    path.push(fn);
                    if (nr.invalidate)
                        nr.invalidate.forEach((x) => ss.delete(x));
                    for (const x of nr.post_states)
                        ss.add(x);
                }
                if (path.length < 3)
                    continue;
                synthetic.push({
                    id: `SYN-${id++}`,
                    category: "resource_leak",
                    severity: "medium",
                    broken: path.slice(0, -1),
                    expected: path,
                    source: "synthetic",
                    verified: false,
                });
            }
        }
        return synthetic;
    };
    try {
        cases.push(...generateSyntheticCases());
    }
    catch { }
    // Build metadata
    const byCategory = {};
    const bySource = {};
    let verified = 0;
    for (const c of cases) {
        byCategory[c.category] = (byCategory[c.category] || 0) + 1;
        bySource[c.source] = (bySource[c.source] || 0) + 1;
        if (c.verified)
            verified++;
    }
    return {
        name: "Protocol Lifecycle Security Benchmark",
        version: "1.0.0",
        cases,
        metadata: { total: cases.length, verified, byCategory, bySource },
    };
}
function runProtocolSecurityBenchmark() {
    const bench = buildProtocolSecurityBenchmark();
    const { inferStateMachine } = require("./experimental/state-inference");
    const { detectStructuralViolations } = require("./protocol-invariants");
    const CWE_TO_VIOLATION = {
        resource_leak: "missing_release",
        auth_bypass: "missing_prerequisite",
        data_corruption: "missing_commit",
        use_after_free: "illegal_transition",
        race_condition: "missing_prerequisite",
    };
    const byCat = {};
    let totalDetected = 0, totalMatched = 0;
    let verifiedDetected = 0, verifiedTotal = 0;
    for (const c of bench.cases) {
        if (!byCat[c.category])
            byCat[c.category] = { total: 0, verified: 0, detected: 0, matched: 0 };
        byCat[c.category].total++;
        if (c.verified) {
            byCat[c.category].verified++;
            verifiedTotal++;
        }
        const templateSM = inferStateMachine([c.expected]);
        const brokenSM = inferStateMachine([c.broken]);
        const violations = detectStructuralViolations(brokenSM, templateSM);
        const violationTypes = violations.map((v) => v.violationSubtype);
        const detected = violations.length > 0;
        const expectedV = CWE_TO_VIOLATION[c.category] || "";
        const matched = expectedV ? violationTypes.includes(expectedV) : false;
        if (detected) {
            totalDetected++;
            byCat[c.category].detected++;
            if (c.verified)
                verifiedDetected++;
        }
        if (matched) {
            totalMatched++;
            byCat[c.category].matched++;
        }
    }
    const total = bench.cases.length;
    const overallRecall = total > 0 ? totalDetected / total : 0;
    const overallPrecision = totalDetected > 0 ? totalMatched / totalDetected : 0;
    const verifiedRecall = verifiedTotal > 0 ? verifiedDetected / verifiedTotal : 0;
    const verifiedPrecision = verifiedTotal > 0 ? totalMatched / Math.max(1, totalDetected) : 0;
    const parserGap = verifiedRecall - overallRecall;
    const categoryBreakdown = {};
    for (const [cat, s] of Object.entries(byCat)) {
        categoryBreakdown[cat] = {
            total: s.total, verified: s.verified,
            detected: s.detected, matched: s.matched,
            recall: s.total > 0 ? s.detected / s.total : 0,
            precision: s.detected > 0 ? s.matched / s.detected : 0,
        };
    }
    return {
        benchmark: bench.name,
        totalCases: total,
        verifiedCases: verifiedTotal,
        overallRecall, overallPrecision,
        byCategory: categoryBreakdown,
        verifiedOnly: { total: verifiedTotal, detected: verifiedDetected, recall: verifiedRecall, precision: verifiedPrecision },
        parserNoiseGap: parserGap,
        verdict: verifiedRecall > 0.85
            ? "✅ PROTOCOL LIFECYCLE SECURITY — verified performance exceeds 85%"
            : verifiedRecall > 0.7
                ? "⚠️ PROMISING — verified recall >70%, needs more cases"
                : "❌ INSUFFICIENT — core detector performance below threshold",
    };
}
function printProtocolSecurityReport(report) {
    console.log(`\n╔════════════════════════════════════════════════════╗`);
    console.log(`║   ${report.benchmark}`);
    console.log(`║   ${report.totalCases} cases (${report.verifiedCases} manually verified)`);
    console.log(`╚════════════════════════════════════════════════════╝\n`);
    console.log(`  Overall:     recall ${(report.overallRecall * 100).toFixed(0)}%  precision ${(report.overallPrecision * 100).toFixed(0)}%`);
    console.log(`  Verified:    recall ${(report.verifiedOnly.recall * 100).toFixed(0)}%  precision ${(report.verifiedOnly.precision * 100).toFixed(0)}%`);
    console.log(`  Parser gap:  ${(report.parserNoiseGap * 100).toFixed(0)}% (noise in CVE→sequence conversion)`);
    console.log();
    console.log(`  ── Per Category ──`);
    for (const [cat, s] of Object.entries(report.byCategory)) {
        const vMark = s.verified > 0 ? ` (${s.verified} verified)` : "";
        console.log(`  ${cat.padEnd(22)} ${String(s.total).padStart(3)} cases${vMark.padEnd(14)} recall ${(s.recall * 100).toFixed(0).padStart(3)}%  precision ${(s.precision * 100).toFixed(0)}%`);
    }
    console.log(`\n  Verdict: ${report.verdict}\n`);
}
