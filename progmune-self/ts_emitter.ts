// @progmune-generated session=sess_1780751539805_8aeog timestamp=2026-06-06T13:12:24.914Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { extractIR } from "./extract-ir";
import { validateAction, validateActionSequence } from "./validator";
import { emitCode } from "./emitter";
import type { Action } from "./runtime-types";

export function main(projectRoot: string, action: Action, actions: Action, meta: { sessionId?: string; ruleHash?: string; irFunctionCount?: number; protocolRuleCount?: number }) {
  const ir = extractIR(projectRoot);
  const validatedActions = validateAction(action, ir);
  const validationResult = validateActionSequence(actions);
  const code = emitCode(actions, meta);
  return { ir, validatedActions, validationResult, code };
}
