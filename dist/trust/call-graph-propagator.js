"use strict";
/**
 * Phase 5: Cross-Function Call Graph Propagator
 *
 * Uses the project's IR (Intermediate Representation) to trace protocol
 * operations across function boundaries. When function A calls function B,
 * B's semantic domains are propagated up to enrich A's analysis window.
 *
 * This addresses the single-function window limitation:
 *   Before: analyze only direct calls in function A
 *   After:  analyze direct calls + propagated domains from callees
 *
 * Architecture:
 *   IR (call graph) → Build propagation index → Enrich semantic sequences
 *
 * For C projects without IR, heuristic-based inference is used instead
 * (see TLS_INFERRED_NO_CERT_VERIFY check in protocol-domain-validator.ts).
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
exports.buildCallGraphFromIR = buildCallGraphFromIR;
exports.propagateDomains = propagateDomains;
exports.enrichWithPropagatedDomains = enrichWithPropagatedDomains;
exports.annotateGraphWithDomains = annotateGraphWithDomains;
exports.enrichSequence = enrichSequence;
exports.inferDomainsFromFunctionName = inferDomainsFromFunctionName;
const path = __importStar(require("path"));
// ═══════════════════════════════════════════════════════════════
// IR Loading & Call Graph Construction
// ═══════════════════════════════════════════════════════════════
/**
 * Build a call graph index from the project IR.
 * The IR must have function definitions with callee information.
 */
function buildCallGraphFromIR(irPath) {
    const nodes = new Map();
    let totalEdges = 0;
    try {
        const fs = require("fs");
        const resolvedPath = irPath || path.resolve(process.cwd(), "ir.json");
        if (!fs.existsSync(resolvedPath)) {
            return { nodes, totalFunctions: 0, totalEdges: 0 };
        }
        const raw = JSON.parse(fs.readFileSync(resolvedPath, "utf-8"));
        const functions = Array.isArray(raw) ? raw : raw.functions || [];
        for (const fn of functions) {
            if (!fn.name)
                continue;
            const callees = [];
            // Extract callees from various IR formats
            if (Array.isArray(fn.calls)) {
                callees.push(...fn.calls.map((c) => (typeof c === "string" ? c : c.name || c.function)));
            }
            if (Array.isArray(fn.callees)) {
                callees.push(...fn.callees);
            }
            // Infer callees from call graph edges
            if (Array.isArray(fn.edges)) {
                callees.push(...fn.edges.map((e) => (typeof e === "string" ? e : e.to || e.target)));
            }
            totalEdges += callees.length;
            nodes.set(fn.name, {
                name: fn.name,
                file: fn.file || "",
                callees: [...new Set(callees)], // deduplicate
                domains: [], // populated later by semantic mapper
            });
        }
    }
    catch {
        // IR unavailable — return empty index
    }
    return { nodes, totalFunctions: nodes.size, totalEdges };
}
// ═══════════════════════════════════════════════════════════════
// Domain Propagation
// ═══════════════════════════════════════════════════════════════
/**
 * Propagate semantic domains from callees to caller.
 *
 * Given a function name and a call graph index, returns the set of
 * protocol domains from all reachable callees (up to maxDepth).
 *
 * This allows the Trust Engine to see protocol operations that happen
 * inside called functions, not just in the immediate call sequence.
 */
function propagateDomains(functionName, graph, maxDepth = 3) {
    if (graph.totalFunctions === 0)
        return [];
    const visited = new Set();
    const domains = new Set();
    function dfs(name, depth) {
        if (depth > maxDepth || visited.has(name))
            return;
        visited.add(name);
        const node = graph.nodes.get(name);
        if (!node)
            return;
        // Add this node's domains
        for (const d of node.domains) {
            domains.add(d);
        }
        // Recurse into callees
        for (const callee of node.callees) {
            dfs(callee, depth + 1);
        }
    }
    dfs(functionName, 0);
    return [...domains];
}
/**
 * Enrich a semantic step with propagated domains from callees.
 * Returns additional domains that should be considered present
 * in the analysis window.
 */
function enrichWithPropagatedDomains(step, graph) {
    if (graph.totalFunctions === 0)
        return [];
    return propagateDomains(step.api, graph, 3);
}
/**
 * Annotate call graph nodes with semantic domains extracted from
 * their direct call sequences.
 *
 * This should be called after the semantic mapper has processed
 * each function's call sequence.
 */
function annotateGraphWithDomains(graph, functionDomains) {
    for (const [funcName, domains] of functionDomains) {
        const node = graph.nodes.get(funcName);
        if (node) {
            node.domains = domains;
        }
    }
}
/**
 * Enrich a call sequence with cross-function context.
 *
 * For each function call in the sequence, looks up its callees in the
 * call graph and propagates their protocol domains into the analysis window.
 */
function enrichSequence(steps, graph) {
    const propagatedDomains = new Set();
    for (const step of steps) {
        const calleeDomains = enrichWithPropagatedDomains(step, graph);
        for (const d of calleeDomains) {
            propagatedDomains.add(d);
        }
    }
    return {
        directSteps: steps,
        propagatedDomains: [...propagatedDomains],
        graphAvailable: graph.totalFunctions > 0,
    };
}
// ═══════════════════════════════════════════════════════════════
// Inference for C projects (no IR available)
// ═══════════════════════════════════════════════════════════════
/**
 * Heuristic domain propagation for C projects without IR.
 * Uses function name patterns to infer what domains a called function
 * likely contains.
 */
function inferDomainsFromFunctionName(functionName) {
    const name = functionName.toLowerCase();
    const domains = [];
    // SSL/TLS connection functions internally perform handshake + cert verify
    if (name.includes("ssl_connect") ||
        name.includes("tls_connect") ||
        name.includes("do_connect") ||
        name.includes("ssl_cfilter") ||
        name.includes("ssl_setup")) {
        domains.push("tls_handshake", "tls_cert");
    }
    // SSL context creation functions
    if (name.includes("ssl_ctx_new") ||
        name.includes("ssl_new") ||
        name.includes("ssl_init")) {
        domains.push("tls_handshake");
    }
    // Certificate loading/verification functions
    if (name.includes("ssl_verify") ||
        name.includes("cert_verify") ||
        name.includes("check_cert") ||
        name.includes("x509_verify")) {
        domains.push("tls_cert");
    }
    // Connection functions that internally do TLS
    if (name.includes("_connect") && !name.includes("disconnect")) {
        domains.push("tls_handshake");
    }
    return domains;
}
