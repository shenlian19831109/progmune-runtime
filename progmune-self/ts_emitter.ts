// @progmune-generated session=sess_1780829179564_hyu9z timestamp=2026-06-07T10:46:24.440Z
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
