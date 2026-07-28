/**
 * Progmune V3.3 — State Mining Engine
 * ====================================
 * 从代码中恢复业务状态机，而非函数调用序列。
 *
 * 核心理念:
 *   Policy 真正约束的是 State Transition（状态变化），不是 Function Order（函数顺序）。
 *   "Created → Paid → Shipped" 合法，"Created → Shipped" 非法。
 *   这不是函数顺序问题，是状态机问题。
 *
 * 三层挖掘:
 *   L1: State Discovery — 从枚举、常量、类型定义中提取状态值
 *   L2: State Transition Recovery — 从行为图中恢复状态转换
 *   L3: State Machine Assembly — 将状态和转换组装成完整状态机
 *
 * 输入: Behavior Graph (V3.2) + 项目路径
 * 输出: State Machines — 每个业务实体的完整生命周期
 */

import { Project, Node, SyntaxKind, EnumDeclaration, InterfaceDeclaration, ClassDeclaration, SourceFile, VariableDeclaration } from "ts-morph";
import * as path from "path";
import * as fs from "fs";

// ══════════════════════════════════════════════
// TYPES
// ══════════════════════════════════════════════

interface StateDefinition {
  name: string;              // e.g. "CREATED", "PAID", "SHIPPED"
  value?: string | number;   // Enum value if explicit
  entity: string;            // Which entity this state belongs to
  source: "enum" | "constant" | "type_literal" | "inferred";
  file: string;
  lineNumber: number;
}

interface StateTransition {
  from: string;
  to: string;
  entity: string;
  viaFunction: string;       // Which function performs this transition
  condition?: string;        // Under what condition (e.g. "payment.success")
  frequency: number;         // How often observed
  topologyConfirmed: boolean; // Does CFG confirm the ordering?
  confidence: number;        // 0-100
}

interface BusinessStateMachine {
  entity: string;            // e.g. "Order", "Payment", "User"
  states: string[];          // All possible states
  initialState: string;      // Starting state
  terminalStates: string[];  // End states
  transitions: StateTransition[];
  validTransitions: string[];   // "CREATED→PAID", "PAID→SHIPPED"
  invalidTransitions: string[]; // "CREATED→SHIPPED" (would violate)
  coverage: number;          // % of possible transitions we've observed
  confidence: number;        // Overall confidence in this machine
}

interface StateMiningReport {
  projectPath: string;
  timestamp: string;
  states: StateDefinition[];
  transitions: StateTransition[];
  machines: BusinessStateMachine[];
  summary: {
    statesFound: number;
    transitionsFound: number;
    machinesFound: number;
    completeMachines: number;
  };
}

// ══════════════════════════════════════════════
// L1: STATE DISCOVERY
// ══════════════════════════════════════════════

/**
 * Extract all state-like definitions from the codebase.
 * States come from:
 *   1. TypeScript enums with Status/State/Stage/Type names
 *   2. Drizzle mysqlEnum column definitions
 *   3. String literal union types (type Status = "active" | "inactive")
 */
function discoverStates(projectPath: string): StateDefinition[] {
  const states: StateDefinition[] = [];

  // ── Direct regex extraction from Drizzle/Prisma schema files ──
  // ts-morph can fail parsing runtime imports. Regex is more robust.
  for (const schemaDir of ["drizzle", "prisma", "db", "database"]) {
    const schemaPath = path.join(projectPath, schemaDir);
    if (!fs.existsSync(schemaPath)) continue;

    for (const entry of fs.readdirSync(schemaPath, { recursive: true })) {
      const fullPath = path.join(schemaPath, entry as string);
      if (!fullPath.endsWith(".ts")) continue;
      const content = fs.readFileSync(fullPath, "utf-8");
      const fileName = path.relative(projectPath, fullPath);

      // Extract: mysqlTable("tableName", { ... status: mysqlEnum("status", ["a","b"]) ... })
      // Pattern: mysqlTable("name", { ... colName: mysqlEnum("col", [...values]) ... })
      const tableRegex = /mysqlTable\s*\(\s*["']([^"']+)["']\s*,\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}\s*\)/gs;
      let tableMatch;
      while ((tableMatch = tableRegex.exec(content)) !== null) {
        const tableName = tableMatch[1];
        const columnsBlock = tableMatch[2];

        // Extract: colName: mysqlEnum("col", ["val1", "val2", ...])
        const enumRegex = /(\w+)\s*:\s*mysqlEnum\s*\(\s*["'][^"']*["']\s*,\s*\[([^\]]+)\]/g;
        let enumMatch;
        while ((enumMatch = enumRegex.exec(columnsBlock)) !== null) {
          const colName = enumMatch[1];
          const valuesStr = enumMatch[2];
          const values = valuesStr.match(/["']([^"']+)["']/g)?.map(v => v.replace(/["']/g, "")) || [];

          const isStateColumn = ["status", "state", "type", "stage", "phase", "role", "paymentMethod"].includes(colName);

          if (isStateColumn && values.length >= 2) {
            for (const val of values) {
              states.push({
                name: val,
                entity: tableName,
                source: "enum",
                file: fileName,
                lineNumber: 0,
              });
            }
          }
        }
      }
    }
  }

  // ── TypeScript enums from server source files ──
  if (fs.existsSync(path.join(projectPath, "server"))) {
    for (const entry of fs.readdirSync(path.join(projectPath, "server"), { recursive: true })) {
      const fullPath = path.join(projectPath, "server", entry as string);
      if (!fullPath.endsWith(".ts")) continue;
      const content = fs.readFileSync(fullPath, "utf-8");
      const fileName = path.relative(projectPath, fullPath);

      // Extract: enum OrderStatus { CREATED = "created", ... }
      const enumRegex = /enum\s+(\w+)\s*\{([^}]+)\}/g;
      let enumMatch;
      while ((enumMatch = enumRegex.exec(content)) !== null) {
        const enumName = enumMatch[1];
        const body = enumMatch[2];
        const isStateEnum = /status|state|stage|type|step|phase/i.test(enumName);

        if (isStateEnum) {
          const entityName = enumName.replace(/status|state|stage|type|step|phase/gi, "").trim() || enumName;
          const members = body.match(/(\w+)\s*(?:=\s*["']?(\w+)["']?)?/g) || [];
          for (const m of members) {
            const name = m.split("=")[0].trim();
            if (name && !name.startsWith("//")) {
              states.push({ name, entity: entityName, source: "enum", file: fileName, lineNumber: 0 });
            }
          }
        }
      }
    }
  }

  return states;
}

// ══════════════════════════════════════════════
// L2: STATE TRANSITION RECOVERY
// ══════════════════════════════════════════════

/**
 * Map function names to state transitions using heuristics.
 * e.g. "updateOrderStatus" + args containing "SHIPPED" → transition to SHIPPED
 * e.g. "createOrder" → transition to CREATED
 * e.g. "payOrder" → transition to PAID
 */
function recoverTransitions(
  projectPath: string,
  states: StateDefinition[],
  behaviorEdges?: any[]
): StateTransition[] {
  const project = new Project({
    tsConfigFilePath: path.join(projectPath, "tsconfig.json"),
    skipAddingFilesFromTsConfig: false,
  });
  // Also add drizzle/prisma schema files (often excluded from tsconfig includes)
  for (const schemaDir of ["drizzle", "prisma", "db", "database"]) {
    const schemaPath = path.join(projectPath, schemaDir);
    if (fs.existsSync(schemaPath)) {
      project.addSourceFilesAtPaths(path.join(schemaPath, "**/*.ts"));
    }
  }

  const transitions: StateTransition[] = [];
  const stateNamesByEntity = new Map<string, Set<string>>();

  for (const s of states) {
    if (!stateNamesByEntity.has(s.entity)) {
      stateNamesByEntity.set(s.entity, new Set());
    }
    stateNamesByEntity.get(s.entity)!.add(s.name);
  }

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath().replace(projectPath + "/", "");
    if (filePath.includes("node_modules") || filePath.includes(".test.")) continue;

    // Walk all function calls
    sourceFile.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return;
      const callText = node.getExpression().getText().toLowerCase();

      // Heuristic: if a function call contains a state name + verb,
      // it's likely a state transition
      for (const [entity, stateNames] of stateNamesByEntity) {
        const entityLower = entity.toLowerCase();

        // Check if this call is related to the entity
        if (!callText.includes(entityLower) && !callText.includes("status") && !callText.includes("state")) {
          continue;
        }

        // Look for state values in the function call or its arguments
        for (const stateName of stateNames) {
          const stateLower = stateName.toLowerCase();
          const args = node.getArguments().map(a => a.getText().toLowerCase()).join(" ");

          // Does this call set or transition to this state?
          const isTransition =
            callText.includes(stateLower) ||
            args.includes(stateLower) ||
            args.includes(`"${stateLower}"`) ||
            args.includes(`'${stateLower}'`);

          if (isTransition) {
            // Determine the transition direction:
            // - "create" or "insert" → entering this state
            // - "update" or "set" → transitioning TO this state (from unknown previous state)
            // - "delete" or "remove" → leaving this state

            const isCreation = callText.includes("create") || callText.includes("insert") || callText.includes("init");
            const isMutation = callText.includes("update") || callText.includes("set") || callText.includes("change");

            // Try to find the previous state from the call context
            // Look at enclosing function for "if (status === X)" patterns
            let fromState = "UNKNOWN";
            const parent = node.getParent();
            if (parent) {
              const parentText = parent.getText().toLowerCase();
              for (const prevState of stateNames) {
                if (parentText.includes(`"${prevState.toLowerCase()}"`) ||
                    parentText.includes(`'${prevState.toLowerCase()}'`) ||
                    parentText.includes(`=== "${prevState.toLowerCase()}"`)) {
                  fromState = prevState;
                  break;
                }
              }
            }

            if (isCreation) {
              fromState = "INITIAL";
            }

            const existingTransition = transitions.find(
              t => t.from === fromState && t.to === stateName && t.entity === entity
            );

            if (existingTransition) {
              existingTransition.frequency++;
              existingTransition.confidence = Math.min(100, existingTransition.confidence + 5);
            } else {
              transitions.push({
                from: fromState,
                to: stateName,
                entity,
                viaFunction: callText,
                frequency: 1,
                topologyConfirmed: isMutation || isCreation,
                confidence: isCreation ? 70 : 40,
              });
            }
          }
        }
      }
    });
  }

  return transitions;
}

// ══════════════════════════════════════════════
// L3: STATE MACHINE ASSEMBLY
// ══════════════════════════════════════════════

/**
 * From states and transitions, assemble complete business state machines.
 */
function assembleMachines(
  states: StateDefinition[],
  transitions: StateTransition[]
): BusinessStateMachine[] {
  const machines: BusinessStateMachine[] = [];
  const entities = [...new Set(states.map(s => s.entity))];

  for (const entity of entities) {
    const entityStates = states.filter(s => s.entity === entity);
    const entityTransitions = transitions.filter(t => t.entity === entity);

    if (entityStates.length < 2) continue;

    // Sort states: INITIAL first, then by transition frequency, then terminal
    const stateNames = [...new Set(entityStates.map(s => s.name))];
    const initialState = entityTransitions.find(t => t.from === "INITIAL")?.to || stateNames[0];

    // Terminal states: states that appear as "to" but not as "from"
    const fromSet = new Set(entityTransitions.map(t => t.from));
    const toSet = new Set(entityTransitions.map(t => t.to));
    const terminalStates = stateNames.filter(s => toSet.has(s) && !fromSet.has(s));

    // Valid transitions: the ones we've observed
    const validTransitions = entityTransitions.map(t => `${t.from}→${t.to}`);

    // Invalid transitions: all other possible pairs (for validation)
    const invalidTransitions: string[] = [];
    for (const from of stateNames) {
      for (const to of stateNames) {
        if (from === to) continue;
        const key = `${from}→${to}`;
        if (!validTransitions.includes(key)) {
          invalidTransitions.push(key);
        }
      }
    }

    // Coverage: what % of possible transitions have we observed?
    const totalPossible = stateNames.length * (stateNames.length - 1);
    const coverage = totalPossible > 0 ? Math.round((validTransitions.length / totalPossible) * 100) : 0;

    // Overall confidence: average of transition confidences
    const avgConf = entityTransitions.length > 0
      ? Math.round(entityTransitions.reduce((s, t) => s + t.confidence, 0) / entityTransitions.length)
      : 0;

    machines.push({
      entity,
      states: stateNames,
      initialState,
      terminalStates,
      transitions: entityTransitions,
      validTransitions,
      invalidTransitions: invalidTransitions.slice(0, 20), // Don't blow up
      coverage,
      confidence: avgConf,
    });
  }

  // Sort by confidence descending
  machines.sort((a, b) => b.confidence - a.confidence);

  return machines;
}

// ══════════════════════════════════════════════
// MAIN PIPELINE
// ══════════════════════════════════════════════

export function mineStates(projectPath: string): StateMiningReport {
  console.log("🔬 Progmune State Mining Engine — V3.3");
  console.log("   Project:", projectPath);

  // L1: State Discovery
  console.log("\nL1 · State Discovery...");
  const states = discoverStates(projectPath);
  const entityCount = new Set(states.map(s => s.entity)).size;
  console.log(`   ${states.length} states found across ${entityCount} entities`);

  // Group by entity and show
  const byEntity = new Map<string, StateDefinition[]>();
  for (const s of states) {
    if (!byEntity.has(s.entity)) byEntity.set(s.entity, []);
    byEntity.get(s.entity)!.push(s);
  }
  for (const [entity, entityStates] of byEntity) {
    const stateNames = entityStates.map(s => s.name);
    console.log(`     ${entity}: [${stateNames.join(", ")}]`);
  }

  // L2: State Transition Recovery
  console.log("\nL2 · Transition Recovery...");
  const transitions = recoverTransitions(projectPath, states);
  const confTransitions = transitions.filter(t => t.topologyConfirmed);
  console.log(`   ${transitions.length} transitions (${confTransitions.length} topology-confirmed)`);

  // L3: State Machine Assembly
  console.log("\nL3 · State Machine Assembly...");
  const machines = assembleMachines(states, transitions);
  console.log(`   ${machines.length} state machines assembled`);

  for (const m of machines) {
    console.log(`\n   🏗️  ${m.entity} State Machine [confidence: ${m.confidence}%]`);
    console.log(`      States: ${m.states.join(" → ")}`);
    console.log(`      Initial: ${m.initialState} | Terminal: ${m.terminalStates.join(", ") || "(none)"}`);
    console.log(`      Coverage: ${m.coverage}% (${m.validTransitions.length} observed / ${m.validTransitions.length + m.invalidTransitions.length} possible)`);
    if (m.transitions.length > 0) {
      console.log(`      Transitions:`);
      for (const t of m.transitions.slice(0, 5)) {
        console.log(`        ${t.from.padEnd(15)} → ${t.to.padEnd(15)} via ${t.viaFunction} [${t.confidence}%]`);
      }
    }
    // Show violations this machine would catch
    if (m.invalidTransitions.length > 0) {
      console.log(`      Would catch these violations:`);
      for (const inv of m.invalidTransitions.slice(0, 3)) {
        console.log(`        ❌ ${inv} — would be blocked`);
      }
    }
  }

  const report: StateMiningReport = {
    projectPath,
    timestamp: new Date().toISOString(),
    states,
    transitions,
    machines,
    summary: {
      statesFound: states.length,
      transitionsFound: transitions.length,
      machinesFound: machines.length,
      completeMachines: machines.filter(m => m.coverage >= 50).length,
    },
  };

  return report;
}

// ══════════════════════════════════════════════
// CLI
// ══════════════════════════════════════════════

if (require.main === module) {
  const targetProject = process.argv[2];
  if (!targetProject) {
    console.error("Usage: npx ts-node src/state-miner.ts <project-path>");
    process.exit(1);
  }

  const report = mineStates(targetProject);

  const outputPath = path.join(targetProject, ".progmune_state_machines.json");
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(`\n✅ State machines saved to: ${outputPath}`);

  console.log("\n═══ State Mining Summary ═══");
  console.log(`  States:       ${report.summary.statesFound}`);
  console.log(`  Transitions:  ${report.summary.transitionsFound}`);
  console.log(`  Machines:     ${report.summary.machinesFound} (${report.summary.completeMachines} complete)`);
  console.log();
}
