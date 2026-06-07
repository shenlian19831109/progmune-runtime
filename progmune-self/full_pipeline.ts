// @progmune-generated session=sess_1780831410766_aeokx timestamp=2026-06-07T11:23:39.548Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { extractIR } from "./extract-ir";
import { validateAction, validateActionSequence } from "./validator";
import { emitCode } from "./emitter";
import { auditDirectory } from "./audit";
import type { Action } from "./runtime-types";

export function main(projectRoot: string, action: Action, actions: Action, meta: { sessionId?: string; ruleHash?: string; irFunctionCount?: number; protocolRuleCount?: number }, dir: string, threshold: any) {
  const ir = extractIR(projectRoot);
  const validated = validateAction(action, ir);
  const seqValidated = validateActionSequence(actions);
  const code = emitCode(actions, meta);
  const audit = auditDirectory(dir, threshold);
  return { ir, validated, seqValidated, code, audit };
}
