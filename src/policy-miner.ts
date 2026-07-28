/**
 * Progmune V3.1 — Policy Mining Engine
 * =====================================
 * 从代码自动发现业务规则，不再人工手写。
 *
 * 四层架构:
 *   L1: Entity Discovery  — 从 AST 发现领域对象、状态枚举
 *   L2: Flow Mining        — 从调用图恢复业务流程
 *   L3: Constraint Mining  — 从代码模式发现隐含约束
 *   L4: Policy Generation  — 自动生成 protocol rules
 *
 * 输入: 一个 TypeScript 项目的路径
 * 输出: 自动生成的 Policy（状态机 + 协议规则）
 */

import { Project, Node, SyntaxKind, FunctionDeclaration, EnumDeclaration, InterfaceDeclaration, TypeAliasDeclaration, ClassDeclaration, MethodDeclaration, SourceFile } from "ts-morph";
import * as path from "path";
import * as fs from "fs";

// ══════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════

interface DiscoveredEntity {
  name: string;                    // e.g. "Order"
  kind: "entity" | "enum" | "service" | "controller";
  file: string;
  states?: string[];               // e.g. ["CREATED","PAID","QUEUED","SHIPPED"]
  transitions?: DiscoveredTransition[];
}

interface DiscoveredTransition {
  from: string;
  to: string;
  function: string;               // The function that performs this transition
  file: string;
  lineNumber: number;
  confidence: number;             // 0-1, based on how often this transition appears
}

interface CallEdge {
  caller: string;
  callee: string;
  callerFile: string;
  calleeFile: string;
  count: number;                  // How many times this call appears in the code
}

interface MinedWorkflow {
  name: string;                    // e.g. "Order Lifecycle"
  entity: string;                  // e.g. "Order"
  steps: string[];                 // Ordered sequence of state transitions
  confidence: number;              // 0-1
  source: "call_graph" | "control_flow" | "enum_ordering" | "naming_convention";
}

interface GeneratedPolicy {
  namespace: string;
  states: Record<string, string>;
  rules: Record<string, {
    namespace: string;
    pre_states: string[];
    post_states: string[];
    invalidate?: string[];
    description: string;
    confidence: number;           // How confident the miner is in this rule
    source: string;               // Where this rule came from
  }>;
}

// ══════════════════════════════════════════════
// L1: ENTITY DISCOVERY
// ══════════════════════════════════════════════

/**
 * Scan the project for domain entities, state enums, and their transitions.
 * Uses heuristics based on TypeScript naming conventions and type structures.
 */
export function discoverEntities(projectPath: string): DiscoveredEntity[] {
  const project = new Project({
    tsConfigFilePath: path.join(projectPath, "tsconfig.json"),
    skipAddingFilesFromTsConfig: false,
  });

  const entities: DiscoveredEntity[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    // Skip test files and node_modules
    if (sourceFile.getFilePath().includes("node_modules")) continue;
    if (sourceFile.getFilePath().includes(".test.")) continue;

    // ── Find Enums (likely state machines) ──
    for (const enumDecl of sourceFile.getEnums()) {
      const members = enumDecl.getMembers().map(m => m.getName());
      const name = enumDecl.getName();

      // Heuristic: enums with "Status" or "State" in name are state machines
      if (name.includes("Status") || name.includes("State") || name.includes("Stage") || name.includes("Step")) {
        const entity = entities.find(e => e.name === name) || {
          name,
          kind: "enum" as const,
          file: sourceFile.getFilePath().replace(projectPath + "/", ""),
          states: [],
          transitions: [],
        };

        // Extract states from enum members
        entity.states = members;

        // Infer transitions from enum ordering (if enum values are sequential)
        for (let i = 0; i < members.length - 1; i++) {
          entity.transitions = entity.transitions || [];
          const existingTransition = entity.transitions.find(
            t => t.from === members[i] && t.to === members[i + 1]
          );
          if (!existingTransition) {
            entity.transitions.push({
              from: members[i],
              to: members[i + 1],
              function: `transition_${members[i]}_to_${members[i + 1]}`.toLowerCase(),
              file: sourceFile.getFilePath().replace(projectPath + "/", ""),
              lineNumber: enumDecl.getStartLineNumber(),
              confidence: 0.5, // Enum ordering is a weak signal — needs flow mining to confirm
            });
          }
        }

        if (!entities.find(e => e.name === name)) {
          entities.push(entity);
        }
      }
    }

    // ── Find Interfaces/Types (likely domain entities) ──
    for (const interfaceDecl of sourceFile.getInterfaces()) {
      const name = interfaceDecl.getName();
      // Heuristic: interfaces with status/state/id fields are domain entities
      const properties = interfaceDecl.getProperties();
      const hasId = properties.some(p => p.getName() === "id");
      const hasStatus = properties.some(p =>
        p.getName().includes("status") || p.getName().includes("state")
      );

      if (hasId && hasStatus) {
        const entity: DiscoveredEntity = {
          name,
          kind: "entity",
          file: sourceFile.getFilePath().replace(projectPath + "/", ""),
          states: [],
          transitions: [],
        };

        // Try to find the corresponding status enum
        const statusProp = properties.find(p =>
          p.getName().includes("status") || p.getName().includes("state")
        );
        if (statusProp) {
          const typeName = statusProp.getType().getText();
          const matchingEnum = entities.find(e => e.kind === "enum" && typeName.includes(e.name));
          if (matchingEnum && matchingEnum.states) {
            entity.states = matchingEnum.states;
            entity.transitions = matchingEnum.transitions;
          }
        }

        if (!entities.find(e => e.name === name)) {
          entities.push(entity);
        }
      }
    }

    // ── Find Drizzle Table Definitions ──
    for (const varDecl of sourceFile.getVariableDeclarations()) {
      const initializer = varDecl.getInitializer();
      if (!initializer) continue;

      // Detect: mysqlTable("tableName", { columns })
      // or: pgTable("tableName", { columns }) or sqliteTable(...)
      if (Node.isCallExpression(initializer)) {
        const callExpr = initializer;
        const fnName = callExpr.getExpression().getText();
        if (fnName === "mysqlTable" || fnName === "pgTable" || fnName === "sqliteTable") {
          const args = callExpr.getArguments();
          if (args.length >= 2) {
            const tableName = args[0].getText().replace(/['"]/g, "");
            const columnsObj = args[1];

            // Extract column definitions looking for enums with state-like values
            const states: string[] = [];
            if (Node.isObjectLiteralExpression(columnsObj)) {
              for (const prop of columnsObj.getProperties()) {
                if (Node.isPropertyAssignment(prop)) {
                  const propInitializer = prop.getInitializer();
                  if (propInitializer && Node.isCallExpression(propInitializer)) {
                    const colFn = propInitializer.getExpression().getText();
                    // mysqlEnum("colName", ["val1", "val2", ...])
                    if (colFn === "mysqlEnum" || colFn === "pgEnum") {
                      const enumArgs = propInitializer.getArguments();
                      if (enumArgs.length >= 2 && Node.isArrayLiteralExpression(enumArgs[1])) {
                        const enumValues = enumArgs[1].getElements().map(e => e.getText().replace(/['"]/g, ""));
                        const colName = prop.getName();
                        if (colName === "status" || colName === "state" || colName === "role" || colName === "type" || colName === "stage") {
                          states.push(...enumValues);
                        }
                      }
                    }
                  }
                }
              }
            }

            const entity: DiscoveredEntity = {
              name: tableName,
              kind: "entity",
              file: sourceFile.getFilePath().replace(projectPath + "/", ""),
              states: states.length > 0 ? states : undefined,
              transitions: states.length >= 2 ? states.slice(0, -1).map((s, i) => ({
                from: s,
                to: states[i + 1],
                function: `transition_${tableName}_${s}_to_${states[i + 1]}`.toLowerCase(),
                file: sourceFile.getFilePath().replace(projectPath + "/", ""),
                lineNumber: varDecl.getStartLineNumber(),
                confidence: 0.4,
              })) : undefined,
            };

            if (!entities.find(e => e.name === tableName)) {
              entities.push(entity);
            }
          }
        }
      }
    }

    // ── Find Classes (likely services) ──
    for (const classDecl of sourceFile.getClasses()) {
      const name = classDecl.getName();
      if (!name) continue;
      // Heuristic: classes with "Service" or "Controller" or "Router" in name
      if (name.includes("Service") || name.includes("Controller") || name.includes("Router") || name.includes("Manager")) {
        const methods = classDecl.getMethods().map(m => m.getName());
        const entity: DiscoveredEntity = {
          name,
          kind: name.includes("Controller") || name.includes("Router") ? "controller" : "service",
          file: sourceFile.getFilePath().replace(projectPath + "/", ""),
          states: methods, // Method names as potential state transitions
          transitions: [],
        };

        if (!entities.find(e => e.name === name)) {
          entities.push(entity);
        }
      }
    }
  }

  return entities;
}

// ══════════════════════════════════════════════
// L2: FLOW MINING (Call Graph Analysis)
// ══════════════════════════════════════════════

/**
 * Build a call graph from the project.
 * Each edge represents "caller calls callee" with a count of occurrences.
 */
export function buildCallGraph(projectPath: string): CallEdge[] {
  const project = new Project({
    tsConfigFilePath: path.join(projectPath, "tsconfig.json"),
    skipAddingFilesFromTsConfig: false,
  });

  const edges: Map<string, CallEdge> = new Map();

  for (const sourceFile of project.getSourceFiles()) {
    if (sourceFile.getFilePath().includes("node_modules")) continue;
    if (sourceFile.getFilePath().includes(".test.")) continue;

    const filePath = sourceFile.getFilePath().replace(projectPath + "/", "");

    // Walk all function calls in the file
    sourceFile.forEachDescendant((node) => {
      if (Node.isCallExpression(node)) {
        const expression = node.getExpression();
        const calleeName = expression.getText();

        // Find the enclosing function
        let parent = node.getParent();
        while (parent && !Node.isFunctionDeclaration(parent) && !Node.isMethodDeclaration(parent) && !Node.isArrowFunction(parent)) {
          parent = parent.getParent();
        }

        const callerName = parent
          ? (Node.isMethodDeclaration(parent)
            ? (parent.getParent() as any)?.getName?.() + "." + parent.getName()
            : (parent as any).getName?.() || "(anonymous)")
          : "(anonymous)";

        const key = `${callerName}→${calleeName}`;
        if (edges.has(key)) {
          edges.get(key)!.count++;
        } else {
          edges.set(key, {
            caller: callerName,
            callee: calleeName,
            callerFile: filePath,
            calleeFile: "", // Would need resolution to find
            count: 1,
          });
        }
      }
    });
  }

  return Array.from(edges.values())
    .filter(e => e.count >= 2) // Filter noise — only keep edges that appear multiple times
    .sort((a, b) => b.count - a.count);
}

// ══════════════════════════════════════════════
// L3: WORKFLOW DISCOVERY
// ══════════════════════════════════════════════

/**
 * From the call graph and entities, discover business workflows.
 * A workflow is a sequence of state transitions that form a coherent business process.
 */
export function discoverWorkflows(
  entities: DiscoveredEntity[],
  callGraph: CallEdge[]
): MinedWorkflow[] {
  const workflows: MinedWorkflow[] = [];

  // ── Phase 1: Service method ordering (name-based heuristics) ──
  const SERVICE_LIFECYCLE_PATTERNS: Record<string, string[]> = {
    // Payment flow pattern
    "payment": ["create", "initiate", "verify", "process", "confirm", "query", "close", "refund"],
    // General CRUD pattern
    "crud": ["create", "read", "update", "delete"],
    // Auth flow pattern
    "auth": ["decode", "verify", "get", "issue", "refresh", "revoke"],
  };

  for (const entity of entities) {
    if (entity.kind !== "service") continue;
    if (!entity.states || entity.states.length < 2) continue;

    const methods = entity.states as string[];
    const entityNameLower = entity.name.toLowerCase();

    // Detect which lifecycle pattern this service follows
    let pattern: string[] | null = null;
    if (entityNameLower.includes("payment") || entityNameLower.includes("pay")) {
      pattern = SERVICE_LIFECYCLE_PATTERNS["payment"];
    } else if (entityNameLower.includes("auth") || entityNameLower.includes("oauth")) {
      pattern = SERVICE_LIFECYCLE_PATTERNS["auth"];
    }

    if (pattern) {
      // Order methods by their position in the lifecycle pattern
      const ordered = pattern
        .map(prefix => methods.find(m => m.toLowerCase().includes(prefix)))
        .filter((m): m is string => !!m);

      if (ordered.length >= 2) {
        workflows.push({
          name: `${entity.name} Lifecycle`,
          entity: entity.name,
          steps: ordered,
          confidence: 0.65,
          source: "naming_convention",
        });
      }
    }

    // Also add raw method ordering as a fallback workflow
    if (methods.length >= 3 && !workflows.find(w => w.entity === entity.name)) {
      workflows.push({
        name: `${entity.name} Method Sequence`,
        entity: entity.name,
        steps: methods.slice(0, 8),
        confidence: 0.3,
        source: "naming_convention",
      });
    }
  }

  // ── Phase 2: Entity state transitions (existing logic) ──
  for (const entity of entities) {
    if (entity.kind !== "entity" && entity.kind !== "enum") continue;
    if (!entity.states || entity.states.length < 2) continue;

    const entityName = entity.name.replace(/Status|State|Stage|Step/g, "").toLowerCase();
    const relevantEdges = callGraph.filter(e => {
      const combined = (e.caller + e.callee).toLowerCase();
      return combined.includes(entityName);
    });

    const confirmedTransitions = (entity.transitions || []).filter(t => {
      return relevantEdges.some(e => {
        const edgeText = (e.caller + e.callee).toLowerCase();
        return edgeText.includes(t.from.toLowerCase()) && edgeText.includes(t.to.toLowerCase());
      });
    });

    if (confirmedTransitions.length >= 2) {
      const steps: string[] = [];
      for (const t of confirmedTransitions) {
        if (!steps.includes(t.from)) steps.push(t.from);
        if (!steps.includes(t.to)) steps.push(t.to);
      }

      if (!workflows.find(w => w.entity === entity.name)) {
        workflows.push({
          name: `${entity.name} Lifecycle`,
          entity: entity.name,
          steps,
          confidence: confirmedTransitions.length / (entity.transitions?.length || 1),
          source: "call_graph",
        });
      }
    } else if (entity.transitions && entity.transitions.length >= 2) {
      const steps: string[] = [];
      for (const t of entity.transitions) {
        if (!steps.includes(t.from)) steps.push(t.from);
        if (!steps.includes(t.to)) steps.push(t.to);
      }

      if (!workflows.find(w => w.entity === entity.name)) {
        workflows.push({
          name: `${entity.name} Lifecycle (enum-inferred)`,
          entity: entity.name,
          steps,
          confidence: 0.3,
          source: "enum_ordering",
        });
      }
    }
  }

  return workflows;
}

// ══════════════════════════════════════════════
// L4: POLICY GENERATION
// ══════════════════════════════════════════════

/**
 * Generate protocol rules from discovered workflows.
 * This is the output: policy that the engine can enforce.
 */
export function generatePolicy(
  entities: DiscoveredEntity[],
  workflows: MinedWorkflow[]
): GeneratedPolicy {
  const policy: GeneratedPolicy = {
    namespace: "auto_mined",
    states: {},
    rules: {},
  };

  for (const wf of workflows) {
    const ns = wf.entity.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase();

    // Generate state definitions
    for (const step of wf.steps) {
      policy.states[step] = `${wf.name}: ${step}`;
    }

    // Generate transition rules (each step must precede the next)
    for (let i = 0; i < wf.steps.length - 1; i++) {
      const from = wf.steps[i];
      const to = wf.steps[i + 1];
      const ruleName = `auto_${ns}_${from}_to_${to}`.toLowerCase();

      policy.rules[ruleName] = {
        namespace: ns,
        pre_states: [from],
        post_states: [to],
        invalidate: [from],
        description: `[AUTO-MINED] ${from} → ${to} (confidence: ${(wf.confidence * 100).toFixed(0)}%)`,
        confidence: wf.confidence,
        source: wf.source,
      };
    }
  }

  return policy;
}

// ══════════════════════════════════════════════
// MAIN PIPELINE
// ══════════════════════════════════════════════

export interface MiningReport {
  projectPath: string;
  timestamp: string;
  entities: DiscoveredEntity[];
  callGraph: CallEdge[];
  workflows: MinedWorkflow[];
  generatedPolicy: GeneratedPolicy;
  summary: {
    entitiesFound: number;
    callEdgesFound: number;
    workflowsFound: number;
    rulesGenerated: number;
    highConfidenceRules: number;
  };
}

/**
 * Run the full Policy Mining pipeline on a project.
 * L1 → L2 → L3 → L4, fully automated.
 */
export function mineProject(projectPath: string): MiningReport {
  console.log("⛏️  Progmune Policy Mining Engine — V3.1");
  console.log("   Project:", projectPath);
  console.log();

  // L1: Entity Discovery
  console.log("L1 · Entity Discovery...");
  const entities = discoverEntities(projectPath);
  const entityNames = entities.filter(e => e.kind === "entity" || e.kind === "enum").map(e => e.name);
  console.log(`   Found ${entities.length} entities: ${entityNames.join(", ") || "(none)"}`);

  // L2: Call Graph
  console.log("\nL2 · Flow Mining...");
  const callGraph = buildCallGraph(projectPath);
  console.log(`   Found ${callGraph.length} call edges (≥2 occurrences)`);
  if (callGraph.length > 0) {
    const top5 = callGraph.slice(0, 5);
    for (const e of top5) {
      console.log(`     ${e.caller} → ${e.callee} (×${e.count})`);
    }
  }

  // L3: Workflow Discovery
  console.log("\nL3 · Workflow Discovery...");
  const workflows = discoverWorkflows(entities, callGraph);
  console.log(`   Found ${workflows.length} workflows`);
  for (const wf of workflows) {
    console.log(`     ${wf.name} [${wf.source}] confidence=${(wf.confidence * 100).toFixed(0)}%`);
    console.log(`       ${wf.steps.join(" → ")}`);
  }

  // L4: Policy Generation
  console.log("\nL4 · Policy Generation...");
  const generatedPolicy = generatePolicy(entities, workflows);
  const ruleCount = Object.keys(generatedPolicy.rules).length;
  const highConf = Object.values(generatedPolicy.rules).filter(r => r.confidence >= 0.5).length;
  console.log(`   Generated ${ruleCount} rules (${highConf} high confidence)`);

  const report: MiningReport = {
    projectPath,
    timestamp: new Date().toISOString(),
    entities,
    callGraph,
    workflows,
    generatedPolicy,
    summary: {
      entitiesFound: entities.length,
      callEdgesFound: callGraph.length,
      workflowsFound: workflows.length,
      rulesGenerated: ruleCount,
      highConfidenceRules: highConf,
    },
  };

  return report;
}

// ══════════════════════════════════════════════
// CLI ENTRY POINT
// ══════════════════════════════════════════════

if (require.main === module) {
  const targetProject = process.argv[2];
  if (!targetProject) {
    console.error("Usage: npx ts-node src/policy-miner.ts <project-path>");
    process.exit(1);
  }

  const report = mineProject(targetProject);

  // Write output
  const outputPath = path.join(targetProject, ".progmune_mined_policy.json");
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`\n✅ Mined policy saved to: ${outputPath}`);

  // Summary
  console.log("\n═══ Mining Summary ═══");
  console.log(`  Entities:     ${report.summary.entitiesFound}`);
  console.log(`  Call Edges:   ${report.summary.callEdgesFound}`);
  console.log(`  Workflows:    ${report.summary.workflowsFound}`);
  console.log(`  Rules:        ${report.summary.rulesGenerated} (${report.summary.highConfidenceRules} high confidence)`);
  console.log();
}
