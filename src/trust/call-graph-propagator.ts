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

import * as path from "path";
import type { ProtocolDomain, SemanticStep } from "./api-semantic-mapper";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface CallGraphNode {
  name: string;
  file: string;
  /** Functions this node calls */
  callees: string[];
  /** Semantic domains from this function's direct operations */
  domains: ProtocolDomain[];
}

export interface CallGraphIndex {
  /** function name → CallGraphNode */
  nodes: Map<string, CallGraphNode>;
  /** Total functions in the graph */
  totalFunctions: number;
  /** Total call edges */
  totalEdges: number;
}

// ═══════════════════════════════════════════════════════════════
// IR Loading & Call Graph Construction
// ═══════════════════════════════════════════════════════════════

/**
 * Build a call graph index from the project IR.
 * The IR must have function definitions with callee information.
 */
export function buildCallGraphFromIR(irPath?: string): CallGraphIndex {
  const nodes = new Map<string, CallGraphNode>();
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
      if (!fn.name) continue;

      const callees: string[] = [];

      // Extract callees from various IR formats
      if (Array.isArray(fn.calls)) {
        callees.push(...fn.calls.map((c: any) => (typeof c === "string" ? c : c.name || c.function)));
      }
      if (Array.isArray(fn.callees)) {
        callees.push(...fn.callees);
      }
      // Infer callees from call graph edges
      if (Array.isArray(fn.edges)) {
        callees.push(...fn.edges.map((e: any) => (typeof e === "string" ? e : e.to || e.target)));
      }

      totalEdges += callees.length;

      nodes.set(fn.name, {
        name: fn.name,
        file: fn.file || "",
        callees: [...new Set(callees)], // deduplicate
        domains: [], // populated later by semantic mapper
      });
    }
  } catch {
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
export function propagateDomains(
  functionName: string,
  graph: CallGraphIndex,
  maxDepth: number = 3
): ProtocolDomain[] {
  if (graph.totalFunctions === 0) return [];

  const visited = new Set<string>();
  const domains = new Set<ProtocolDomain>();

  function dfs(name: string, depth: number) {
    if (depth > maxDepth || visited.has(name)) return;
    visited.add(name);

    const node = graph.nodes.get(name);
    if (!node) return;

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
export function enrichWithPropagatedDomains(
  step: SemanticStep,
  graph: CallGraphIndex
): ProtocolDomain[] {
  if (graph.totalFunctions === 0) return [];
  return propagateDomains(step.api, graph, 3);
}

/**
 * Annotate call graph nodes with semantic domains extracted from
 * their direct call sequences.
 *
 * This should be called after the semantic mapper has processed
 * each function's call sequence.
 */
export function annotateGraphWithDomains(
  graph: CallGraphIndex,
  functionDomains: Map<string, ProtocolDomain[]>
): void {
  for (const [funcName, domains] of functionDomains) {
    const node = graph.nodes.get(funcName);
    if (node) {
      node.domains = domains;
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// Integration: Enrich a full sequence with call graph context
// ═══════════════════════════════════════════════════════════════

export interface EnrichedSequence {
  /** Original semantic steps */
  directSteps: SemanticStep[];
  /** Additional domains propagated from callees */
  propagatedDomains: ProtocolDomain[];
  /** Whether the call graph was available */
  graphAvailable: boolean;
}

/**
 * Enrich a call sequence with cross-function context.
 *
 * For each function call in the sequence, looks up its callees in the
 * call graph and propagates their protocol domains into the analysis window.
 */
export function enrichSequence(
  steps: SemanticStep[],
  graph: CallGraphIndex
): EnrichedSequence {
  const propagatedDomains = new Set<ProtocolDomain>();

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
export function inferDomainsFromFunctionName(
  functionName: string
): ProtocolDomain[] {
  const name = functionName.toLowerCase();
  const domains: ProtocolDomain[] = [];

  // SSL/TLS connection functions internally perform handshake + cert verify
  if (
    name.includes("ssl_connect") ||
    name.includes("tls_connect") ||
    name.includes("do_connect") ||
    name.includes("ssl_cfilter") ||
    name.includes("ssl_setup")
  ) {
    domains.push("tls_handshake", "tls_cert");
  }

  // SSL context creation functions
  if (
    name.includes("ssl_ctx_new") ||
    name.includes("ssl_new") ||
    name.includes("ssl_init")
  ) {
    domains.push("tls_handshake");
  }

  // Certificate loading/verification functions
  if (
    name.includes("ssl_verify") ||
    name.includes("cert_verify") ||
    name.includes("check_cert") ||
    name.includes("x509_verify")
  ) {
    domains.push("tls_cert");
  }

  // Connection functions that internally do TLS
  if (name.includes("_connect") && !name.includes("disconnect")) {
    domains.push("tls_handshake");
  }

  return domains;
}
