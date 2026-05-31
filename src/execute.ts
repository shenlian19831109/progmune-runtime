/**
 * Phase 5: Semantic Execution Kernel
 *
 * Single entry point: intent → validated code → file written → audit verified.
 * Wires together: IR extraction → Planner → EmitCode → Fingerprint.
 *
 * This is what progmune_execute MCP tool calls internally.
 */

import * as fs from "fs";
import * as path from "path";
import { plan } from "./planner";
import type { PlanResult } from "./planner";
import { extractIR } from "./extract-ir";
import { emitCode } from "./emitter";
export interface ExecuteResult {
  success: boolean;
  code: string;
  sessionId: string;
  filePath?: string;
  hash: string;
  ruleHash: string;
  irFunctionCount: number;
  protocolRuleCount: number;
  violations: number;
  /** Phase 6: Repair metrics — true if SSG deterministic repair was applied */
  repairApplied: boolean;
  /** Phase 6: Number of repair actions inserted */
  repairCount: number;
  /** Phase 6: Branch IDs created by repair */
  repairBranchIds: string[];
  /** Phase 7: Branch evaluation winner (if multiple branches) */
  branchWinner?: { id: string; score: number; recommendation: string };
  error?: string;
}

// ── Phase 7: Execution Metrics ──

export interface GenerationRecord {
  sessionId: string;
  timestamp: number;
  filePath: string;
  repaired: boolean;
  repairCount: number;
  irFunctionCount: number;
}

export interface ExecutionMetrics {
  generated: number;
  repaired: number;
  lastGeneration: string | null;
  history: GenerationRecord[];
}

const METRICS_FILE = ".progmune_corpus/metrics.json";

function loadMetrics(): ExecutionMetrics {
  try {
    if (fs.existsSync(METRICS_FILE)) {
      return JSON.parse(fs.readFileSync(METRICS_FILE, "utf-8"));
    }
  } catch {}
  return { generated: 0, repaired: 0, lastGeneration: null, history: [] };
}

function saveMetrics(m: ExecutionMetrics): void {
  const dir = ".progmune_corpus";
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(METRICS_FILE, JSON.stringify(m, null, 2), "utf-8");
}

/** Record a generation event. Called automatically by execute(). */
export function recordGeneration(record: GenerationRecord): void {
  const m = loadMetrics();
  m.generated++;
  if (record.repaired) m.repaired++;
  m.lastGeneration = record.filePath;
  m.history.push(record);
  // Keep last 100 entries
  if (m.history.length > 100) m.history = m.history.slice(-100);
  saveMetrics(m);
}

/** Get current execution metrics. */
export function getExecutionMetrics(): ExecutionMetrics {
  return loadMetrics();
}

/**
 * Execute the full Progmune pipeline: intent → validated code → file.
 *
 * @param intent - Natural language programming intent
 * @param projectPath - Absolute path to project root
 * @param filePath - Optional: write generated code to this file
 */
export async function execute(
  intent: string,
  projectPath: string,
  filePath?: string
): Promise<ExecuteResult> {
  // 1. IR extraction
  let ir: any[];
  try {
    ir = extractIR(projectPath);
  } catch (e: any) {
    return { success: false, code: "", sessionId: "", hash: "", ruleHash: "", irFunctionCount: 0, protocolRuleCount: 0, violations: 0, repairApplied: false, repairCount: 0, repairBranchIds: [], branchWinner: undefined, error: `IR extraction failed: ${e.message}` };
  }

  // 2. Protocol rule count
  let protocolRuleCount = 0;
  try {
    const protoPath = path.resolve(projectPath, "protocols.json");
    if (fs.existsSync(protoPath)) {
      protocolRuleCount = Object.keys(JSON.parse(fs.readFileSync(protoPath, "utf-8")).rules || {}).length;
    }
  } catch {}

  // 3. Plan (LLM + immune constraints)
  let planResult: PlanResult;
  try {
    planResult = await plan(intent);
  } catch (e: any) {
    return { success: false, code: "", sessionId: "", hash: "", ruleHash: "", irFunctionCount: ir.length, protocolRuleCount, violations: 0, repairApplied: false, repairCount: 0, repairBranchIds: [], branchWinner: undefined, error: `Planning failed: ${e.message}` };
  }

  if (!planResult.actions || planResult.actions.length === 0) {
    return { success: false, code: "", sessionId: planResult.sessionId, hash: "", ruleHash: planResult.ruleHash || "", irFunctionCount: ir.length, protocolRuleCount, violations: 0, repairApplied: false, repairCount: 0, repairBranchIds: [], branchWinner: undefined, error: "Planner returned empty action sequence" };
  }

  // 4. Emit code with generation marker
  const code = emitCode(planResult.actions, {
    sessionId: planResult.sessionId,
    ruleHash: planResult.ruleHash,
    irFunctionCount: ir.length,
    protocolRuleCount,
  });

  // 5. Write to file if requested
  if (filePath) {
    const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(projectPath, filePath);
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(resolvedPath, code, "utf-8");
  }

  // 6. Compute hash (from code content)
  const crypto = require("crypto");
  const hash = crypto.createHash("sha256").update(code).digest("hex").slice(0, 16);
  const ruleHash = planResult.ruleHash || "";

  // Phase 7: Record execution metrics
  if (filePath) {
    recordGeneration({
      sessionId: planResult.sessionId,
      timestamp: Date.now(),
      filePath: filePath,
      repaired: planResult.repairApplied,
      repairCount: planResult.repairCount,
      irFunctionCount: ir.length,
    });
  }

  // Fingerprint registration is NOT done here.
  // plan() internally calls recordSession() which writes real transitions to
  // .progmune_corpus/sessions/. The fingerprint is registered later by
  // `npm run check` → registerAllMissingFingerprints() which reads the
  // actual session file with real StateTransition[].

  return {
    success: true,
    code,
    sessionId: planResult.sessionId,
    filePath: filePath || undefined,
    hash,
    ruleHash,
    irFunctionCount: ir.length,
    protocolRuleCount,
    violations: 0,
    repairApplied: planResult.repairApplied,
    repairCount: planResult.repairCount,
    repairBranchIds: planResult.repairBranchIds,
    branchWinner: planResult.repairApplied && planResult.repairBranchIds.length >= 2
      ? (() => {
          try {
            // Load branches from the session file to evaluate
            const sessionFile = `.progmune_corpus/sessions/${planResult.sessionId}.json`;
            if (fs.existsSync(sessionFile)) {
              const session = JSON.parse(fs.readFileSync(sessionFile, "utf-8"));
              if (session.branchTree && session.branchTree.length > 0) {
                const { evaluateBranches } = require("./branch-ledger");
                const { getNsInit } = require("./protocol-registry");
                const evalResult = evaluateBranches(session.branchTree, getNsInit());
                if (evalResult.winner) {
                  return {
                    id: evalResult.winner.branchId.slice(0, 12),
                    score: evalResult.winner.score,
                    recommendation: evalResult.winner.recommendation,
                  };
                }
              }
            }
          } catch {}
          return undefined;
        })()
      : undefined,
  };
}

/** Quick audit: check whether a file has the @progmune-generated marker. */
export function verifyFileMarker(filePath: string): { marked: boolean; sessionId?: string; timestamp?: string } {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const head = content.split("\n").slice(0, 5).join("\n");
    const match = head.match(/@progmune-generated\s+session=(\S+)(?:\s+timestamp=(\S+))?/);
    if (match) {
      return { marked: true, sessionId: match[1], timestamp: match[2] };
    }
  } catch {}
  return { marked: false };
}
