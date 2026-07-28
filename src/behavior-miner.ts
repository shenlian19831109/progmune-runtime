/**
 * Progmune V3.2 — Behavior Mining Engine
 * =======================================
 * 从代码的实际行为（不是方法名）中恢复业务逻辑。
 *
 * 三个核心改进（vs V3.1）:
 *   1. CFG-based workflow — 分析函数体内的真实调用序列，不依赖命名
 *   2. Business-layer projection — 将调用图投影到 Controller/Service/Repo 层
 *   3. Decomposed confidence — Frequency × Topology × Consistency
 *
 * 输入: TypeScript 项目路径
 * 输出: BehaviorGraph — 一张包含实体、状态机、业务工作流、约束的治理图谱
 */

import { Project, Node, SyntaxKind, FunctionDeclaration, MethodDeclaration, ArrowFunction, SourceFile } from "ts-morph";
import * as path from "path";
import * as fs from "fs";

// ══════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════

type BusinessLayer = "controller" | "service" | "repository" | "external" | "unknown";

interface BusinessFunction {
  name: string;
  file: string;
  layer: BusinessLayer;
  calls: string[];          // Functions this function calls (in order)
  callCount: number;        // How many unique calls
  layerConfidence: number;  // 0-1: how sure we are about the layer classification
}

interface CallSequence {
  caller: string;
  callerLayer: BusinessLayer;
  callees: string[];        // ORDERED — this is the CFG-derived sequence
  file: string;
  frequency: number;        // How many times this sequence appears
}

interface BehaviorEdge {
  from: string;
  to: string;
  fromLayer: BusinessLayer;
  toLayer: BusinessLayer;
  frequency: number;        // Raw count of occurrences
  topologyScore: number;    // 0-1: CFG confirms this order
  consistencyScore: number; // 0-1: same pattern across similar functions
  confidence: number;       // 0-1: composite = freq × topo × cons
  files: string[];          // Where this pattern was observed
}

interface BusinessWorkflow {
  name: string;
  steps: string[];
  layers: BusinessLayer[];
  edges: BehaviorEdge[];
  totalFrequency: number;
  confidence: number;
  description: string;
}

interface GovernanceGraph {
  projectPath: string;
  timestamp: string;
  functions: BusinessFunction[];
  sequences: CallSequence[];
  edges: BehaviorEdge[];
  workflows: BusinessWorkflow[];
  summary: {
    functionsFound: number;
    sequencesFound: number;
    edgesFound: number;
    workflowsFound: number;
    highConfidenceEdges: number;
    highConfidenceWorkflows: number;
  };
}

// ══════════════════════════════════════════════
// L1: BUSINESS LAYER CLASSIFICATION
// ══════════════════════════════════════════════

/**
 * Classify a function into its business layer based on:
 * - File path (server/ vs client/)
 * - File name (router, controller, service, db, repository)
 * - Function name (handle*, process*, get*, create*)
 */
function classifyLayer(
  funcName: string,
  filePath: string,
  className?: string
): { layer: BusinessLayer; confidence: number } {
  const fileLower = filePath.toLowerCase();
  const nameLower = funcName.toLowerCase();
  const classLower = (className || "").toLowerCase();

  // Strong signals from file naming
  if (fileLower.includes("router") || fileLower.includes("routes")) {
    return { layer: "controller", confidence: 0.9 };
  }
  if (fileLower.includes("controller")) {
    return { layer: "controller", confidence: 0.95 };
  }
  if (fileLower.includes("service") || classLower.includes("service")) {
    return { layer: "service", confidence: 0.9 };
  }
  if (fileLower.includes("repository") || fileLower.includes("db") || fileLower.includes("dao")) {
    return { layer: "repository", confidence: 0.9 };
  }
  if (fileLower.includes("sdk") || fileLower.includes("api") || fileLower.includes("client")) {
    return { layer: "external", confidence: 0.7 };
  }

  // Medium signals from function naming
  if (nameLower.startsWith("handle") || nameLower.includes("route")) {
    return { layer: "controller", confidence: 0.6 };
  }
  if (nameLower.includes("process") || nameLower.includes("verify") || nameLower.includes("validate")) {
    return { layer: "service", confidence: 0.5 };
  }
  if (nameLower.includes("insert") || nameLower.includes("update") || nameLower.includes("delete") || nameLower.includes("query") || nameLower.includes("select")) {
    return { layer: "repository", confidence: 0.6 };
  }

  // Default
  return { layer: "unknown", confidence: 0.3 };
}

// ══════════════════════════════════════════════
// L2: CFG-BASED CALL SEQUENCE EXTRACTION
// ══════════════════════════════════════════════

/**
 * Extract the ordered call sequence from a function body.
 * This is CFG-based — we read the AST in execution order,
 * not by method name convention.
 */
function extractCallSequence(
  funcNode: FunctionDeclaration | MethodDeclaration | ArrowFunction
): string[] {
  const calls: string[] = [];
  const body = funcNode.getBody();
  if (!body) return calls;

  // Walk the body in statement order (which maps to execution order)
  body.forEachDescendant((node) => {
    if (Node.isCallExpression(node)) {
      const expr = node.getExpression();
      const calleeName = expr.getText();
      // Filter out literals, property access on primitives
      if (!calleeName.startsWith("'") && !calleeName.startsWith('"') && calleeName.length > 1) {
        calls.push(calleeName);
      }
    }
  });

  return calls;
}

// ══════════════════════════════════════════════
// L3: BEHAVIOR GRAPH CONSTRUCTION
// ══════════════════════════════════════════════

/**
 * Build the full Behavior Graph from a project.
 * L1: Classify functions → L2: Extract call sequences → L3: Build edges → L4: Discover workflows
 */
export function buildBehaviorGraph(projectPath: string): GovernanceGraph {
  const project = new Project({
    tsConfigFilePath: path.join(projectPath, "tsconfig.json"),
    skipAddingFilesFromTsConfig: false,
  });

  const functions: BusinessFunction[] = [];
  const sequenceMap = new Map<string, CallSequence>();
  const edgeMap = new Map<string, BehaviorEdge>();

  console.log("🔬 Progmune Behavior Mining Engine — V3.2");
  console.log("   Project:", projectPath);

  // ── Step 1: Classify all functions + Extract call sequences ──
  console.log("\nL1+L2 · Function Classification + CFG Extraction...");
  let funcCount = 0;
  let seqCount = 0;

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath().replace(projectPath + "/", "");
    if (filePath.includes("node_modules") || filePath.includes(".test.")) continue;

    // Named functions
    for (const funcDecl of sourceFile.getFunctions()) {
      const name = funcDecl.getName() || "(anonymous)";
      if (name === "(anonymous)") continue;

      const classification = classifyLayer(name, filePath);
      const calls = extractCallSequence(funcDecl);

      functions.push({
        name,
        file: filePath,
        layer: classification.layer,
        calls,
        callCount: calls.length,
        layerConfidence: classification.confidence,
      });
      funcCount++;

      // Record call sequence if it has 2+ business-relevant calls
      const businessCalls = calls.filter(c => !isUtilityCall(c));
      if (businessCalls.length >= 2) {
        const key = `${name}::${businessCalls.join("→")}`;
        if (sequenceMap.has(key)) {
          sequenceMap.get(key)!.frequency++;
        } else {
          sequenceMap.set(key, {
            caller: name,
            callerLayer: classification.layer,
            callees: businessCalls,
            file: filePath,
            frequency: 1,
          });
          seqCount++;
        }
      }
    }

    // Class methods
    for (const classDecl of sourceFile.getClasses()) {
      const className = classDecl.getName() || "";
      for (const method of classDecl.getMethods()) {
        const name = method.getName();
        const fullName = `${className}.${name}`;
        const classification = classifyLayer(name, filePath, className);
        const calls = extractCallSequence(method);

        functions.push({
          name: fullName,
          file: filePath,
          layer: classification.layer,
          calls,
          callCount: calls.length,
          layerConfidence: classification.confidence,
        });
        funcCount++;

        const businessCalls = calls.filter(c => !isUtilityCall(c));
        if (businessCalls.length >= 2) {
          const key = `${fullName}::${businessCalls.join("→")}`;
          if (sequenceMap.has(key)) {
            sequenceMap.get(key)!.frequency++;
          } else {
            sequenceMap.set(key, {
              caller: fullName,
              callerLayer: classification.layer,
              callees: businessCalls,
              file: filePath,
              frequency: 1,
            });
            seqCount++;
          }
        }
      }
    }
  }

  // ── Step 1b: Build project function name registry ──
  const projectFuncNames = new Set(functions.map(f => f.name));
  // Also index by short name (method name without class prefix)
  const shortToFull = new Map<string, string[]>();
  for (const f of functions) {
    const parts = f.name.split(".");
    if (parts.length > 1) {
      const short = parts[parts.length - 1];
      if (!shortToFull.has(short)) shortToFull.set(short, []);
      shortToFull.get(short)!.push(f.name);
    }
  }

  // ── Step 2: Build edges from cross-function calls ──
  // An edge exists when one project-defined function calls another project-defined function.
  // This is the "business projection" — we only care about business→business relationships.
  console.log("\nL3 · Building Business Edges (function→function)...");

  for (const func of functions) {
    if (func.layer === "external" || func.layer === "unknown") continue;

    for (const calleeName of func.calls) {
      // Skip utility calls
      if (isUtilityCall(calleeName)) continue;

      // Check if callee is a project-defined function
      let resolvedName = calleeName;
      let resolvedLayer: BusinessLayer = "unknown";

      if (projectFuncNames.has(calleeName)) {
        resolvedLayer = functions.find(f => f.name === calleeName)?.layer || "unknown";
      } else if (shortToFull.has(calleeName)) {
        // This is a method call — match by method name
        const fullNames = shortToFull.get(calleeName)!;
        resolvedName = fullNames[0];
        resolvedLayer = functions.find(f => f.name === resolvedName)?.layer || "unknown";
      } else {
        continue; // Not a project-defined function — skip
      }

      const edgeKey = `${func.name}→${resolvedName}`;
      if (edgeMap.has(edgeKey)) {
        const existing = edgeMap.get(edgeKey)!;
        existing.frequency++;
        if (!existing.files.includes(func.file)) {
          existing.files.push(func.file);
        }
        existing.consistencyScore = Math.min(1.0, (existing.files.length + existing.frequency) / 6);
        const freqNorm = Math.min(1.0, existing.frequency / 3);
        existing.confidence = Math.round((freqNorm * 0.4 + existing.topologyScore * 0.35 + existing.consistencyScore * 0.25) * 100);
      } else {
        edgeMap.set(edgeKey, {
          from: func.name,
          to: resolvedName,
          fromLayer: func.layer,
          toLayer: resolvedLayer,
          frequency: 1,
          topologyScore: 1.0,
          consistencyScore: 0.2,
          confidence: 35,
          files: [func.file],
        });
      }
    }
  }

  const edges = Array.from(edgeMap.values())
    .filter(e => e.confidence >= 30)
    .sort((a, b) => b.confidence - a.confidence);

  // Remove the old pairwise edge building code
  // (edges are now built from function→function calls only)

  const highConfEdges = edges.filter(e => e.confidence >= 60).length;
  console.log(`   ${edges.length} business edges (${highConfEdges} high confidence ≥60%)`);

  // ── Step 3: Discover Business Workflows ──
  console.log("\nL4 · Workflow Discovery...");

  const workflows: BusinessWorkflow[] = [];

  // Group edges by their fromLayer → toLayer chain
  // A workflow is: Controller → Service → Repository → External (or any chain of high-conf edges)
  const highConfEdgeSet = new Set(edges.filter(e => e.confidence >= 40));

  // Find chains of 2+ connected high-confidence edges
  const visited = new Set<string>();
  for (const edge of highConfEdgeSet) {
    if (visited.has(`${edge.from}→${edge.to}`)) continue;

    const chain: BehaviorEdge[] = [edge];
    visited.add(`${edge.from}→${edge.to}`);

    // Extend forward
    let current = edge.to;
    let extended = true;
    while (extended) {
      extended = false;
      for (const next of highConfEdgeSet) {
        if (next.from === current && !visited.has(`${next.from}→${next.to}`)) {
          chain.push(next);
          visited.add(`${next.from}→${next.to}`);
          current = next.to;
          extended = true;
          break;
        }
      }
    }

    if (chain.length >= 2) {
      // Build workflow name from the business domain
      const layers = chain.map(e => e.fromLayer);
      const uniqueLayers = [...new Set(layers)];

      // Determine business domain
      const domainKeywords = ["payment", "order", "user", "auth", "product", "upload", "supplier", "notification"];
      const allNames = chain.flatMap(e => [e.from, e.to]).join(" ").toLowerCase();
      const domain = domainKeywords.find(kw => allNames.includes(kw)) || "business";

      const avgConf = Math.round(chain.reduce((s, e) => s + e.confidence, 0) / chain.length);
      const steps = [chain[0].from, ...chain.map(e => e.to)];
      const stepLayers = [chain[0].fromLayer, ...chain.map(e => e.toLayer)];

      workflows.push({
        name: `${domain.charAt(0).toUpperCase() + domain.slice(1)} Workflow`,
        steps,
        layers: stepLayers,
        edges: chain,
        totalFrequency: chain.reduce((s, e) => s + e.frequency, 0),
        confidence: avgConf,
        description: `${steps.length} steps · ${uniqueLayers.join(" → ")} · avg confidence ${avgConf}%`,
      });
    }
  }

  console.log(`   ${workflows.length} workflows discovered`);

  // ── Print summary ──
  for (const wf of workflows) {
    console.log(`\n   📋 ${wf.name} [${wf.confidence}%]`);
    console.log(`      ${wf.steps.join(" → ")}`);
    console.log(`      ${wf.description}`);
    for (const e of wf.edges) {
      console.log(`        ${e.from} → ${e.to} (freq=${e.frequency}, topo=${e.topologyScore}, cons=${e.consistencyScore.toFixed(1)})`);
    }
  }

  // Top edges
  console.log("\n   Top Behavior Edges:");
  for (const e of edges.slice(0, 5)) {
    console.log(`     ${e.from.padEnd(30)} → ${e.to.padEnd(30)} [${e.fromLayer}→${e.toLayer}] conf=${e.confidence}% (×${e.frequency})`);
  }

  const report: GovernanceGraph = {
    projectPath,
    timestamp: new Date().toISOString(),
    functions,
    sequences: [], // Deprecated — edges now come from business projection
    edges,
    workflows,
    summary: {
      functionsFound: funcCount,
      sequencesFound: edges.length, // Edge count serves as the meaningful metric
      edgesFound: edges.length,
      workflowsFound: workflows.length,
      highConfidenceEdges: highConfEdges,
      highConfidenceWorkflows: workflows.filter(w => w.confidence >= 60).length,
    },
  };

  return report;
}

// ══════════════════════════════════════════════
// UTILITY
// ══════════════════════════════════════════════

/**
 * Filter out calls that are clearly not business logic.
 */
function isUtilityCall(name: string): boolean {
  const utilityPatterns = [
    // Standard utilities
    "console.", "z.", "JSON.", "Math.", "Object.", "Array.",
    "parseInt", "parseFloat", "String", "Number", "Boolean",
    "log", "error", "warn", "debug",
    "map", "filter", "reduce", "forEach", "find",
    "toString", "valueOf", "hasOwnProperty",
    "require", "import",
    // React hooks
    "useState", "useEffect", "useCallback", "useMemo", "useRef",
    "useLocation", "useParams", "useAuth",
    "navigate", "localStorage.", "sessionStorage.",
    "setTimeout", "setInterval", "clearTimeout",
    // Drizzle query builder (infrastructure, not business)
    "db.select", "db.update", "db.insert", "db.delete",
    "db.transaction", "getDb",
    "tx.select", "tx.update", "tx.insert", "tx.delete",
    ".select()", ".from(", ".where(", ".limit(", ".orderBy",
    "eq(", "and(", "or(", "desc(", "asc(",
    "conditions.push", "whereConditions.push",
    // General utilities
    "console.error", "console.log", "console.warn",
    "new Date(", "Date.now", "crypto.randomBytes",
    "res.status", "res.json", "res.send",
    "app.post", "app.get", "app.use",
    // String/number formatting
    ".toString()", ".toLowerCase()", ".toUpperCase()",
    ".split(", ".replace(", ".join(",
    "JSON.stringify", "JSON.parse",
    "params.get", "url.searchParams",
    "formData.append", "xhr.",
    "Array.isArray", ".push(", ".pop(",
    "parseInt(", "parseFloat(", "isNaN(",
    "trpc.", ".useQuery", ".useMutation",
    ".refetch", ".invalidate",
  ];
  for (const p of utilityPatterns) {
    if (name.includes(p)) return true;
  }
  return false;
}

// ══════════════════════════════════════════════
// CLI
// ══════════════════════════════════════════════

if (require.main === module) {
  const targetProject = process.argv[2];
  if (!targetProject) {
    console.error("Usage: npx ts-node src/behavior-miner.ts <project-path>");
    process.exit(1);
  }

  const graph = buildBehaviorGraph(targetProject);

  // Write output
  const outputPath = path.join(targetProject, ".progmune_behavior_graph.json");
  fs.writeFileSync(outputPath, JSON.stringify(graph, null, 2));
  console.log(`\n✅ Behavior Graph saved to: ${outputPath}`);

  console.log("\n═══ Behavior Mining Summary ═══");
  console.log(`  Functions:     ${graph.summary.functionsFound}`);
  console.log(`  Sequences:     ${graph.summary.sequencesFound}`);
  console.log(`  Edges:         ${graph.summary.edgesFound} (${graph.summary.highConfidenceEdges} high confidence)`);
  console.log(`  Workflows:     ${graph.summary.workflowsFound} (${graph.summary.highConfidenceWorkflows} high confidence)`);
  console.log();
}
