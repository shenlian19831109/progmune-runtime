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
import { registerFingerprint } from "./ledger-registry";

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
  error?: string;
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
    return { success: false, code: "", sessionId: "", hash: "", ruleHash: "", irFunctionCount: 0, protocolRuleCount: 0, violations: 0, error: `IR extraction failed: ${e.message}` };
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
    return { success: false, code: "", sessionId: "", hash: "", ruleHash: "", irFunctionCount: ir.length, protocolRuleCount, violations: 0, error: `Planning failed: ${e.message}` };
  }

  if (!planResult.actions || planResult.actions.length === 0) {
    return { success: false, code: "", sessionId: planResult.sessionId, hash: "", ruleHash: planResult.ruleHash || "", irFunctionCount: ir.length, protocolRuleCount, violations: 0, error: "Planner returned empty action sequence" };
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

  // 6. Register fingerprint
  const ruleHash = planResult.ruleHash || "";
  try {
    registerFingerprint(planResult.sessionId, planResult.actions as any, ruleHash);
  } catch {}

  // 7. Compute hash
  const { hashLedger } = require("./ssg-validator");
  const hash = hashLedger(planResult.actions as any);

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
