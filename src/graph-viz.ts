/**
 * Capability Graph Visualization
 *
 * Renders the capability network as a Mermaid diagram + DOT graph.
 * The graph has become the most valuable engineering asset —
 * this module makes it visible.
 */

import * as fs from "fs";
import * as path from "path";
import { selectCapabilityChains } from "./strategy-planner";

interface VizOptions {
  /** Max nodes to include (large graphs truncated) */
  maxNodes?: number;
  /** Show data-flow edges (produces→requires) */
  showDataFlow?: boolean;
  /** Show topology edges (similarity) */
  showTopology?: boolean;
  /** Min edge weight to display */
  minEdgeWeight?: number;
  /** Focus on a specific intent's chain */
  intent?: string;
}

/**
 * Generate a Mermaid flowchart of the capability graph.
 */
export function generateMermaid(ir: any[], opts: VizOptions = {}): string {
  const maxNodes = opts.maxNodes || 50;
  const showDataFlow = opts.showDataFlow !== false;
  const showTopology = opts.showTopology !== false;
  const minWeight = opts.minEdgeWeight || 0.2;

  const lines: string[] = ["```mermaid", "graph LR"];

  // Collect nodes
  const exported = ir.filter((f: any) => f.exported).slice(0, maxNodes);

  // Node styling by score/domain
  for (const f of exported) {
    const hasProduces = (f.produces || []).length > 0;
    const hasRequires = (f.requires || []).length > 0;
    const hasPurpose = !!f.purpose;

    let style = "";
    if (hasProduces && hasRequires) style = "[/";
    else if (hasProduces) style = "[(";
    else style = "[";

    const endStyle = hasProduces && hasRequires ? "/]" : hasProduces ? ")]" : "]";

    // Tag-based coloring
    const tags = (f.tags || []).join(",");
    const tooltip = (f.purpose || f.name).slice(0, 40).replace(/"/g, "'");
    const nodeId = f.name.replace(/[^a-zA-Z0-9]/g, "_");

    lines.push(`  ${nodeId}${style}"${f.name}"${endStyle}`);
  }

  // Data-flow edges
  if (showDataFlow) {
    const nameSet = new Set(exported.map(f => f.name));
    for (const f of exported) {
      if (!f.produces) continue;
      for (const p of f.produces) {
        for (const other of exported) {
          if (other.name === f.name) continue;
          if ((other.requires || []).includes(p)) {
            lines.push(`  ${f.name.replace(/[^a-zA-Z0-9]/g, "_")} -->|"${p}"| ${other.name.replace(/[^a-zA-Z0-9]/g, "_")}`);
          }
        }
      }
    }
  }

  lines.push("```");
  return lines.join("\n");
}

/**
 * Generate a DOT graph for use with Graphviz.
 */
export function generateDOT(ir: any[], opts: VizOptions = {}): string {
  const maxNodes = opts.maxNodes || 100;
  const lines: string[] = [
    "digraph CapabilityGraph {",
    '  rankdir=LR;',
    '  node [shape=box, style=rounded];',
    '  edge [fontsize=8];',
  ];

  const exported = ir.filter((f: any) => f.exported).slice(0, maxNodes);

  for (const f of exported) {
    const label = `${f.name}\\n${(f.purpose || "").slice(0, 30)}`;
    const color = (f.produces || []).length > 0 ? "lightblue" : "lightgray";
    lines.push(`  "${f.name}" [label="${label}", fillcolor=${color}, style="filled,rounded"];`);
  }

  for (const f of exported) {
    if (!f.produces) continue;
    for (const p of f.produces) {
      for (const other of exported) {
        if (other.name === f.name) continue;
        if ((other.requires || []).includes(p)) {
          lines.push(`  "${f.name}" -> "${other.name}" [label="${p}"];`);
        }
      }
    }
  }

  lines.push("}");
  return lines.join("\n");
}

/**
 * Generate a focused visualization of a single intent's chain.
 */
export function generateChainViz(intent: string, ir: any[], maxChains: number = 1): string {
  const chains = selectCapabilityChains(intent, ir, maxChains);
  if (chains.length === 0) return `// No chains found for "${intent}"`;

  const chain = chains[0];
  const lines: string[] = [
    `## Chain: "${intent}" (score: ${chain.score.toFixed(1)})`,
    "",
    "```mermaid",
    "graph LR",
  ];

  for (let i = 0; i < chain.nodes.length; i++) {
    const node = chain.nodes[i];
    const nodeId = node.name.replace(/[^a-zA-Z0-9]/g, "_");
    const meta = [
      `★${node.score.toFixed(1)}`,
      ...(node.produces || []).slice(0, 2),
    ].join("<br/>");
    lines.push(`  ${nodeId}["${node.name}<br/><small>${meta}</small>"]`);

    if (i > 0) {
      const prev = chain.nodes[i - 1];
      // Show data-flow if exists
      const flow = (prev.produces || []).filter(p => (node.requires || []).includes(p));
      const label = flow.length > 0 ? flow[0] : "→";
      lines.push(`  ${prev.name.replace(/[^a-zA-Z0-9]/g, "_")} -->|"${label}"| ${nodeId}`);
    }
  }

  lines.push("```");
  return lines.join("\n");
}

/**
 * Generate a summary report of the capability graph.
 */
export function generateGraphReport(ir: any[]): string {
  const fns = ir.length;
  const exported = ir.filter((f: any) => f.exported).length;
  const withProduces = ir.filter((f: any) => (f.produces || []).length > 0).length;
  const withRequires = ir.filter((f: any) => (f.requires || []).length > 0).length;
  const withPurpose = ir.filter((f: any) => f.purpose).length;

  // Count data-flow edges
  let edges = 0;
  for (const f of ir) {
    if (!f.produces) continue;
    for (const p of f.produces) {
      for (const other of ir) {
        if (other.name === f.name) continue;
        if ((other.requires || []).includes(p)) edges++;
      }
    }
  }

  // Top domains by tag
  const tagCounts = new Map<string, number>();
  for (const f of ir) {
    for (const t of (f.tags || [])) {
      tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
    }
  }
  const topTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const lines: string[] = [
    "# Capability Graph Report",
    "",
    "## Overview",
    `- Total functions: **${fns}**`,
    `- Exported: **${exported}**`,
    `- With produces: **${withProduces}** (${Math.round(withProduces / fns * 100)}%)`,
    `- With requires: **${withRequires}** (${Math.round(withRequires / fns * 100)}%)`,
    `- With purpose: **${withPurpose}** (${Math.round(withPurpose / fns * 100)}%)`,
    `- Data-flow edges: **${edges}**`,
    "",
    "## Top Domains",
    "| Tag | Functions |",
    "|-----|----------|",
    ...topTags.map(([tag, count]) => `| ${tag} | ${count} |`),
    "",
    "## Coverage Trend",
    `- v2.1.4: requires ~26%, produces ~26%, purpose ~30%`,
    `- v2.5.x: requires **46%**, produces **62%**, purpose **100%**`,
    `- Target (v2.6): requires **80%+**, produces **80%+**`,
  ];

  return lines.join("\n");
}

/** CLI: generate report + DOT file */
if (require.main === module) {
  const ir = JSON.parse(fs.readFileSync("ir.json", "utf-8")).functions || [];
  const report = generateGraphReport(ir);
  console.log(report);

  const dot = generateDOT(ir, { maxNodes: 100 });
  fs.writeFileSync("capability_graph.dot", dot);
  console.log(`\nDOT file written to capability_graph.dot`);
  console.log(`Render: dot -Tpng capability_graph.dot -o capability_graph.png`);

  // Generate sample chain visualizations
  const chains = [
    "generate benchmark report",
    "validate actions and extract IR",
    "list all sessions and find failure patterns",
  ];
  for (const intent of chains) {
    const viz = generateChainViz(intent, ir);
    console.log(`\n${viz}`);
  }
}
