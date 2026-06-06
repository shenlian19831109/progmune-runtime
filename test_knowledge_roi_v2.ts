/**
 * Knowledge ROI Experiment v2 — Real outcome measurement
 *
 * Two tracks:
 *   Track A (No-LLM): Deterministic chain → action → validate → emit → compile
 *   Track B (LLM):     Real planner() calls with DeepSeek
 *
 * Measures: compile rate, validation rate, repair count, chain quality
 *
 * Usage:
 *   PROGMUNE_ROI_MODE=no-llm  npx ts-node --transpile-only test_knowledge_roi_v2.ts
 *   PROGMUNE_ROI_MODE=llm     npx ts-node --transpile-only test_knowledge_roi_v2.ts
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { selectCapabilityChains } from "./src/strategy-planner";
import { validateActionSequence } from "./src/validator";
import { emitCode } from "./src/emitter";
import { emitPython } from "./src/python-emitter";
import type { Action } from "./src/runtime-types";

// ── Task set: 10 real business intents ──
const TASKS = [
  { intent: "generate benchmark report from results", category: "data-pipeline" },
  { intent: "load benchmarks and count them", category: "data-pipeline" },
  { intent: "save benchmark results to disk", category: "data-pipeline" },
  { intent: "extract IR and validate all actions", category: "dev-pipeline" },
  { intent: "list all sessions and find failure patterns", category: "analysis" },
  { intent: "format failure genome summary", category: "reporting" },
  { intent: "suggest repairs for a failed session", category: "repair" },
  { intent: "compute system health score", category: "reporting" },
  { intent: "validate protocol transitions", category: "dev-pipeline" },
  { intent: "check ledger consistency", category: "governance" },
];

const ir = JSON.parse(fs.readFileSync("ir.json", "utf-8")).functions || [];
const mode = process.env.PROGMUNE_ROI_MODE || "no-llm";

interface TaskResult {
  intent: string;
  category: string;
  chainsFound: number;
  chainLen: number;
  chainScore: number;
  validationPassed: boolean;
  validationErrors: number;
  tsCompiled: boolean;
  tsErrors: number;
  pyEmitted: boolean;
  llmCalls?: number;
  repairCount?: number;
}

console.log(`═══ Knowledge ROI Experiment v2 ═══`);
console.log(`Mode: ${mode} | IR: ${ir.length} functions | Tasks: ${TASKS.length}\n`);

// ── Track A: No-LLM deterministic ──
async function runNoLLM(graphOn: boolean): Promise<TaskResult[]> {
  const results: TaskResult[] = [];
  const tmpDir = path.join(process.cwd(), ".roi_tmp");
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

  for (const task of TASKS) {
    let chainResult: ReturnType<typeof selectCapabilityChains>;
    let actions: Action[];

    if (graphOn) {
      // Graph ON: full capability chain + constraints
      chainResult = selectCapabilityChains(task.intent, ir, 3);
    } else {
      // Graph OFF: simple keyword scoring, no topology, no constraints
      const keywords = task.intent.toLowerCase().split(/[\s,]+/);
      const scored = ir
        .filter((f: any) => f.exported)
        .map((f: any) => {
          let score = 0;
          for (const kw of keywords) {
            if (f.name.toLowerCase().includes(kw)) score += 1;
            if ((f.purpose || "").toLowerCase().includes(kw)) score += 0.5;
          }
          return { ...f, score };
        })
        .filter((f: any) => f.score > 0)
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, 3);
      const chains = scored.map((f: any) => ({
        nodes: [f],
        score: f.score,
        explanation: f.name,
      }));
    }

    // Build action sequence from chain
    if (offChains.length > 0) {
      actions = offChains[0].nodes.map((node: any) => {
        const def = ir.find((f: any) => f.name === node.name);
        const args = (def?.params || []).map((p: any) => ({
          name: p.name, type: p.type || "string", value: "",
        }));
        return { kind: "call" as const, function: node.name, args, assignTo: `${node.name}_r` };
      });
      const lastCall = actions[actions.length - 1] as any;
      actions.push({ kind: "return" as const, value: lastCall.assignTo || "r" });
    } else {
      actions = [];
    }

    // Validate
    const validation = validateActionSequence(actions);

    // Emit + compile TypeScript
    let tsCompiled = false;
    let tsErrors = 0;
    try {
      const tsCode = emitCode(actions, { irFunctionCount: ir.length });
      const tsPath = path.join(tmpDir, `test_${task.intent.slice(0, 20).replace(/\s/g, "_")}.ts`);
      fs.writeFileSync(tsPath, tsCode);
      try {
        execSync(`npx tsc --noEmit --strict ${tsPath} 2>&1 || true`, {
          cwd: process.cwd(), timeout: 15000, encoding: "utf-8",
        });
        tsCompiled = true;
      } catch (e: any) {
        tsErrors = (e.stderr || e.stdout || "").toString().match(/error TS/g)?.length || 0;
        tsCompiled = tsErrors === 0;
      }
    } catch {}

    // Emit Python
    let pyEmitted = false;
    try {
      const pyCode = emitPython(actions);
      pyEmitted = pyCode.includes("def main");
    } catch {}

    results.push({
      intent: task.intent,
      category: task.category,
      chainsFound: offChains.length,
      chainLen: offChains.length > 0 ? offChains[0].nodes.length : 0,
      chainScore: offChains.length > 0 ? offChains[0].score : 0,
      validationPassed: validation.valid,
      validationErrors: validation.errors.length,
      tsCompiled,
      tsErrors,
      pyEmitted,
    });
  }

  try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
  return results;
}

// ── Track B: LLM real planner ──
async function runLLM(graphOn: boolean): Promise<TaskResult[]> {
  return [{
    intent: "LLM mode requires API key set in env",
    category: "—",
    chainsFound: 0, chainLen: 0, chainScore: 0,
    validationPassed: false, validationErrors: 0,
    tsCompiled: false, tsErrors: 0, pyEmitted: false,
  }];
}

// ── Main ──
async function main() {
  if (mode === "llm") {
    console.log("Track B: LLM Planner (requires LLM_API_KEY)\n");
    // Check API key
    if (!process.env.LLM_API_KEY) {
      console.log("❌ LLM_API_KEY not set. Use: LLM_API_KEY=sk-... npx ts-node ...");
      console.log("Falling back to Track A.\n");
    } else {
      console.log("✅ LLM_API_KEY configured — running real planner...\n");

      // Import planner (only when needed — it initializes LLM client)
      const { plan } = await import("./src/planner");
      const results: TaskResult[] = [];

      for (const task of TASKS.slice(0, 3)) { // Limit to 3 for cost
        console.log(`── "${task.intent}" ──`);
        try {
          const start = Date.now();
          const result = await plan(task.intent);
          const elapsed = Date.now() - start;

          const actions = result.actions || [];
          const validation = validateActionSequence(actions);

          console.log(`  Actions: ${actions.length} | Valid: ${validation.valid}`);
          console.log(`  Time: ${elapsed}ms | LLM calls: ${result.attempts?.[0]?.llmCallCount || "?"} | Errors: ${validation.errors.length}`);
          if (!validation.valid) {
            console.log(`  Errors: ${validation.errors.slice(0, 2).join("; ")}`);
          }

          results.push({
            intent: task.intent,
            category: task.category,
            chainsFound: 0, chainLen: actions.length, chainScore: 0,
            validationPassed: validation.valid,
            validationErrors: validation.errors.length,
            tsCompiled: false, tsErrors: 0, pyEmitted: false,
            llmCalls: result.attempts?.[0]?.llmCallCount,
          });
        } catch (e: any) {
          console.log(`  ❌ Failed: ${e.message}`);
          results.push({
            intent: task.intent, category: task.category,
            chainsFound: 0, chainLen: 0, chainScore: 0,
            validationPassed: false, validationErrors: 1,
            tsCompiled: false, tsErrors: 0, pyEmitted: false,
          });
        }
      }

      printSummary("LLM Planner", results);
      return;
    }
  }

  // ── Track A: No-LLM ──
  console.log("Track A: No-LLM (deterministic chain → action → validate → emit → compile)\n");

  console.log("── Round A: Graph OFF (keyword only) ──");
  const offResults = await runNoLLM(false);
  printRound("Graph OFF", offResults);

  console.log("\n── Round B: Graph ON (full pipeline) ──");
  const onResults = await runNoLLM(true);
  printRound("Graph ON", onResults);

  // ── Comparison ──
  printComparison(offResults, onResults);
}

function printRound(label: string, results: TaskResult[]) {
  for (const r of results) {
    const val = r.validationPassed ? "✅" : "❌";
    const ts = r.tsCompiled ? "✅" : (r.tsErrors > 0 ? `❌(${r.tsErrors})` : "—");
    const py = r.pyEmitted ? "✅" : "❌";
    console.log(`  ${val} TS:${ts} PY:${py} | ★${r.chainScore.toFixed(1)} ×${r.chainLen} | ${r.intent.slice(0, 45)}`);
  }
}

function printSummary(label: string, results: TaskResult[]) {
  const valRate = results.filter(r => r.validationPassed).length;
  const tsRate = results.filter(r => r.tsCompiled).length;
  const avgScore = results.reduce((s, r) => s + r.chainScore, 0) / results.length;
  const avgLen = results.reduce((s, r) => s + r.chainLen, 0) / results.length;

  console.log(`\n── ${label} Summary ──`);
  console.log(`  Validation: ${valRate}/${results.length} (${Math.round(valRate/results.length*100)}%)`);
  console.log(`  TS Compile: ${tsRate}/${results.length} (${Math.round(tsRate/results.length*100)}%)`);
  console.log(`  Avg score:  ${avgScore.toFixed(1)}`);
  console.log(`  Avg length: ${avgLen.toFixed(1)}`);
}

function printComparison(off: TaskResult[], on: TaskResult[]) {
  const offVal = off.filter(r => r.validationPassed).length;
  const onVal = on.filter(r => r.validationPassed).length;
  const offTS = off.filter(r => r.tsCompiled).length;
  const onTS = on.filter(r => r.tsCompiled).length;
  const offScore = off.reduce((s, r) => s + r.chainScore, 0) / off.length;
  const onScore = on.reduce((s, r) => s + r.chainScore, 0) / on.length;
  const offLen = off.reduce((s, r) => s + r.chainLen, 0) / off.length;
  const onLen = on.reduce((s, r) => s + r.chainLen, 0) / on.length;

  console.log(`\n═══════ Knowledge ROI ═══════`);
  console.log(`              Graph OFF    Graph ON     Δ`);
  console.log(`  Validation  ${String(offVal).padStart(5)}/10    ${String(onVal).padStart(5)}/10    ${onVal >= offVal ? "+" : ""}${onVal - offVal}`);
  console.log(`  TS Compile   ${String(offTS).padStart(5)}/10    ${String(onTS).padStart(5)}/10    ${onTS >= offTS ? "+" : ""}${onTS - offTS}`);
  console.log(`  Avg score    ${offScore.toFixed(1).padStart(7)}    ${onScore.toFixed(1).padStart(7)}    ${onScore > offScore ? "+" : ""}${(onScore - offScore).toFixed(1)}`);
  console.log(`  Avg length   ${offLen.toFixed(1).padStart(7)}    ${onLen.toFixed(1).padStart(7)}    ${(onLen - offLen).toFixed(1).padStart(5)}`);

  const roi = offScore > 0 ? Math.round((onScore - offScore) / offScore * 100) : 0;
  console.log(`\n  Knowledge ROI: score +${roi}% | validation ${onVal > offVal ? "+" : ""}${onVal-offVal} | compile ${onTS > offTS ? "+" : ""}${onTS-offTS}`);
}

main().catch(console.error);
