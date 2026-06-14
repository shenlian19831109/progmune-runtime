"use strict";
/**
 * P3.6: Benchmark Generator
 *
 * Auto-generates benchmark cases for uncovered protocol transitions.
 *
 * Data flow:
 *   Coverage Gaps → Transition Templates → Benchmark Cases → Expanded Suite
 *
 * This closes the second flywheel:
 *   Coverage → Gap Detection → Benchmark Gen → New Cases → More Trajectories → Better Coverage
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
exports.generateMissingBenchmarks = generateMissingBenchmarks;
exports.writeGeneratedBenchmarks = writeGeneratedBenchmarks;
exports.runCoverageDrivenGeneration = runCoverageDrivenGeneration;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const protocol_coverage_1 = require("./protocol-coverage");
const failure_corpus_1 = require("./failure-corpus");
// ═══════════════════════════════════════════════════════════════
// Template Engine
// ═══════════════════════════════════════════════════════════════
/**
 * Generate a benchmark case for a specific missing transition.
 *
 * For an uncovered transition "A → B" via rule "R":
 *   - The "broken" path omits R (or places it out of order)
 *   - The "expected" path includes R in the correct position
 */
function generateCaseForTransition(protocol, transition, violationType) {
    const rules = protocol.rules;
    const rule = rules.get(transition.rule);
    if (!rule)
        return null;
    // Build the correct path: find prerequisite rules + this rule
    const expected = [];
    // For acquire transitions: find what prerequisites reach the "from" state
    if (transition.to !== "∅") {
        // Find a path to reach "from" state
        for (const [fn, r] of rules) {
            if (r.post_states.includes(transition.from) || (transition.from === "INIT" && r.pre_states.length === 0)) {
                if (!expected.includes(fn))
                    expected.push(fn);
            }
        }
        expected.push(transition.rule);
        // Add cleanup if needed
        for (const [fn, r] of rules) {
            if (r.invalidate?.includes(transition.to)) {
                if (!expected.includes(fn))
                    expected.push(fn);
            }
        }
    }
    else {
        // Invalidation transition: broken = omit the cleanup rule
        // expected = do the setup + then the cleanup
        for (const [fn, r] of rules) {
            if (r.post_states.includes(transition.from) || (transition.from === "INIT" && r.pre_states.length === 0)) {
                if (!expected.includes(fn))
                    expected.push(fn);
            }
        }
        if (!expected.includes(transition.rule))
            expected.push(transition.rule);
    }
    if (expected.length === 0)
        return null;
    // Broken: omit the target rule
    const broken = expected.filter(fn => fn !== transition.rule);
    if (broken.length === expected.length || broken.length === 0) {
        // If removing the rule doesn't change the path, make broken = setup only (missing cleanup)
        const broken2 = expected.slice(0, Math.max(1, expected.length - 1));
        if (broken2.length === expected.length)
            return null;
        return {
            goal: `cover transition: ${transition.from} → ${transition.to} via ${transition.rule}`,
            protocol: "_global",
            broken: broken2,
            expected,
            violationType,
            targetsTransition: transition,
        };
    }
    return {
        goal: `cover transition: ${transition.from} → ${transition.to} via ${transition.rule}`,
        protocol: "_global",
        broken,
        expected,
        violationType,
        targetsTransition: transition,
    };
}
/**
 * Classify a missing transition into a violation type.
 */
function classifyViolation(transition) {
    if (transition.to === "∅")
        return "resource_leak";
    if (transition.from === "INIT")
        return "missing_prerequisite";
    // If the rule invalidates, it's a cleanup step → resource_leak
    return "missing_prerequisite";
}
// ═══════════════════════════════════════════════════════════════
// Generator
// ═══════════════════════════════════════════════════════════════
/**
 * Generate benchmark cases for all uncovered transitions.
 *
 * Returns a map of protocol → generated cases.
 */
function generateMissingBenchmarks(trajectories) {
    const trajs = trajectories || (0, failure_corpus_1.loadTrajectories)();
    const protocols = (0, protocol_coverage_1.loadDefaultProtocolDefinitions)();
    const reports = (0, protocol_coverage_1.analyzeAllCoverage)(protocols, trajs);
    const generated = {};
    for (const report of reports) {
        const proto = protocols.find(p => p.name === report.protocol);
        if (!proto)
            continue;
        const cases = [];
        for (const mt of report.transitionCoverage.missingTransitions) {
            const c = generateCaseForTransition(proto, mt, classifyViolation(mt));
            if (c)
                cases.push(c);
        }
        if (cases.length > 0) {
            generated[report.protocol] = cases;
        }
    }
    return generated;
}
/**
 * Generate and write benchmark files for uncovered transitions.
 * Does NOT overwrite existing files — writes to benchmarks/generated/.
 */
function writeGeneratedBenchmarks(generated, outputDir) {
    const outDir = outputDir || path.resolve(__dirname, "..", "benchmarks", "generated");
    if (!fs.existsSync(outDir))
        fs.mkdirSync(outDir, { recursive: true });
    const written = [];
    const timestamp = new Date().toISOString().slice(0, 10);
    for (const [protocol, cases] of Object.entries(generated)) {
        if (cases.length === 0)
            continue;
        const filename = `${protocol.toLowerCase()}_generated_${timestamp}.json`;
        const filepath = path.join(outDir, filename);
        const suite = {
            protocol,
            generatedAt: new Date().toISOString(),
            cases,
            source: "coverage-gap",
        };
        fs.writeFileSync(filepath, JSON.stringify(suite, null, 2));
        written.push(filepath);
    }
    return written;
}
/**
 * Full pipeline: analyze → generate → write → report.
 */
function runCoverageDrivenGeneration() {
    const trajs = (0, failure_corpus_1.loadTrajectories)();
    const generated = generateMissingBenchmarks(trajs);
    const totalCases = Object.values(generated).reduce((s, c) => s + c.length, 0);
    const written = writeGeneratedBenchmarks(generated);
    const protocols = Object.keys(generated).join(", ");
    return {
        existingCases: trajs.length,
        generatedCases: totalCases,
        writtenFiles: written,
        summary: totalCases > 0
            ? `Generated ${totalCases} benchmark cases for ${Object.keys(generated).length} protocols: ${protocols}`
            : "All transitions covered. No new cases needed.",
    };
}
