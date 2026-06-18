"use strict";
/**
 * P8.3: Python Protocol Extractor
 *
 * Extracts protocol state machines from Python IR by analyzing call
 * sequences and decorator-based protocol annotations. Bridges the
 * gap between Python IR (tools/extract_ir.py) and the Progmune
 * protocol discovery pipeline (P6).
 *
 * Two modes:
 *   1. Annotation-based: reads @progmune decorators from IR
 *   2. Sequence-based: infers protocol from call co-occurrence patterns
 *
 * Both modes produce SSG-compatible StateAnnotation maps.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractProtocolFromAnnotations = extractProtocolFromAnnotations;
exports.extractCallSequencesFromIR = extractCallSequencesFromIR;
exports.inferProtocolFromSequences = inferProtocolFromSequences;
exports.discoverPythonProtocols = discoverPythonProtocols;
exports.printPythonDiscoveryResult = printPythonDiscoveryResult;
const auto_protocol_synthesizer_1 = require("./auto-protocol-synthesizer");
// ═══════════════════════════════════════════════════════════════
// Annotation-based extraction
// ═══════════════════════════════════════════════════════════════
/**
 * Extract protocol rules from Python IR using @progmune decorators.
 *
 * Each Python function with a @progmune decorator becomes a protocol
 * rule with pre_states, post_states, and optional invalidate states.
 */
function extractProtocolFromAnnotations(ir) {
    const rules = new Map();
    for (const fn of ir) {
        const proto = fn.protocol;
        if (!proto)
            continue;
        const pre_states = Array.isArray(proto.pre_states) ? proto.pre_states : [];
        const post_states = Array.isArray(proto.post_states) ? proto.post_states : [];
        const invRaw = proto.invalidate;
        const invalidate = Array.isArray(invRaw) && invRaw.length > 0
            ? invRaw : undefined;
        rules.set(fn.name, {
            pre_states,
            post_states,
            invalidate,
            namespace: proto.namespace || "python",
        });
    }
    return rules;
}
// ═══════════════════════════════════════════════════════════════
// Sequence-based inference
// ═══════════════════════════════════════════════════════════════
/**
 * Extract call sequences from Python IR.
 *
 * Builds ordered sequences of function calls by analyzing the call
 * graph. For each function that calls others, the called functions
 * form a sequence in source order (approximated by IR order).
 */
function extractCallSequencesFromIR(ir) {
    const sequences = [];
    // Method 1: Functions that call other functions form natural sequences
    for (const fn of ir) {
        const calls = fn.calls || [];
        if (calls.length >= 2) {
            sequences.push([...calls]);
        }
    }
    // Method 2: Build sequences from cross-function call patterns
    // If fnA calls fnB and fnB calls fnC, we get [fnB, fnC]
    const fnMap = new Map();
    for (const fn of ir)
        fnMap.set(fn.name, fn);
    // Build adjacency: which functions are called by which
    const calledBy = new Map();
    for (const fn of ir) {
        for (const call of (fn.calls || [])) {
            if (!calledBy.has(call))
                calledBy.set(call, []);
            calledBy.get(call).push(fn.name);
        }
    }
    // Method 3: Topological sort of call graph
    // Functions with no callers = entry points → follow call chain
    const entryPoints = ir.filter(fn => !calledBy.has(fn.name) || calledBy.get(fn.name).length === 0);
    for (const entry of entryPoints) {
        const seq = [entry.name];
        const visited = new Set([entry.name]);
        let current = entry;
        // Follow calls until we hit a function that calls nothing new
        for (let depth = 0; depth < 10; depth++) {
            const next = (current.calls || []).find(c => !visited.has(c) && fnMap.has(c));
            if (!next)
                break;
            seq.push(next);
            visited.add(next);
            current = fnMap.get(next);
        }
        if (seq.length >= 2)
            sequences.push(seq);
    }
    return sequences;
}
/**
 * Infer protocol rules from call sequences using the auto-protocol-synthesizer.
 */
function inferProtocolFromSequences(sequences) {
    const synthesized = (0, auto_protocol_synthesizer_1.synthesizeProtocols)(sequences);
    const rules = new Map();
    for (const proto of synthesized) {
        for (const r of proto.rules) {
            rules.set(r.function, {
                pre_states: r.pre_states,
                post_states: r.post_states,
                invalidate: r.invalidate,
                namespace: "python_inferred",
            });
        }
    }
    return rules;
}
/**
 * Run the full Python protocol discovery pipeline on a set of IR functions.
 *
 * 1. Extract protocol annotations from @progmune decorators
 * 2. Extract call sequences from the call graph
 * 3. Infer additional protocols from call sequences
 * 4. Merge annotation and inferred rules
 */
function discoverPythonProtocols(ir) {
    // 1. Annotation-based
    const annotationRules = extractProtocolFromAnnotations(ir);
    const annotationCount = annotationRules.size;
    // 2. Sequence extraction
    const callSequences = extractCallSequencesFromIR(ir);
    const sequenceCount = callSequences.length;
    // 3. Inference-based
    const inferredRules = inferProtocolFromSequences(callSequences);
    const inferredCount = inferredRules.size;
    // 4. Merge (annotation rules take precedence)
    const combinedRules = new Map(inferredRules);
    for (const [fn, rule] of annotationRules) {
        combinedRules.set(fn, rule);
    }
    return {
        annotationRules,
        annotationCount,
        callSequences,
        sequenceCount,
        inferredRules,
        inferredCount,
        combinedRules,
    };
}
function printPythonDiscoveryResult(result) {
    console.log("\n─── Python Protocol Discovery ───");
    console.log(`  Annotation rules:  ${result.annotationCount}`);
    console.log(`  Call sequences:    ${result.sequenceCount}`);
    console.log(`  Inferred rules:    ${result.inferredCount}`);
    console.log(`  Combined rules:    ${result.combinedRules.size}`);
    console.log();
    if (result.annotationCount > 0) {
        console.log("  ── Annotation-based protocols ──");
        for (const [fn, rule] of result.annotationRules) {
            const inv = rule.invalidate ? ` [inv: ${rule.invalidate.join(",")}]` : "";
            console.log(`    ${fn}: [${rule.pre_states.join(",")}] → [${rule.post_states.join(",")}]${inv} (${rule.namespace})`);
        }
        console.log();
    }
    if (result.sequenceCount > 0) {
        console.log("  ── Top call sequences ──");
        for (const seq of result.callSequences.slice(0, 10)) {
            console.log(`    ${seq.join(" → ")}`);
        }
        console.log();
    }
    if (result.inferredCount > 0) {
        console.log("  ── Inferred protocols ──");
        for (const [fn, rule] of result.inferredRules) {
            const inv = rule.invalidate ? ` [inv: ${rule.invalidate.join(",")}]` : "";
            console.log(`    ${fn}: [${rule.pre_states.join(",")}] → [${rule.post_states.join(",")}]${inv}`);
        }
        console.log();
    }
}
