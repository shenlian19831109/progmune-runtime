import type { Action, ConstraintViolation } from "./runtime-types";
import type { FunctionInfo } from "./extract-ir";
import { loadIR } from "./ir-utils";
import { ok, err } from "./runtime-types";
import type { Result, ValidationError, ContextFeatures } from "./runtime-types";
import { recordTrajectory, recordSuccess } from "./failure-corpus";

const BUILTIN_WHITELIST = new Set([
  "console.log", "setTimeout", "setInterval", "clearTimeout",
  "JSON.stringify", "JSON.parse", "fetch"
]);

function normalizeType(type: string | undefined): string {
  if (!type) return "any";
  const t = type.toLowerCase().trim();
  if (t === "string") return "str";
  if (t === "number" || t === "integer") return "int";
  if (t === "boolean") return "bool";
  if (t === "dictionary" || t === "record" || t === "dict") return "dict";
  if (t === "list") return "list";
  if (t === "tuple") return "tuple";
  if (t === "set") return "set";
  if (t === "any" || t === "variable") return "any";
  return t;
}

// ========== 重写的变量流向分析：基于声明追踪的确定性检查 ==========
function checkVariableFlow(actions: Action[]): string[] {
  const errors: string[] = [];
  const declared = new Map<string, string>();

  const isLiteral = (val: any): boolean => {
    if (typeof val !== 'string') return true;
    if (/^["'`]/.test(val) || /["'`]$/.test(val)) return true;
    if (/^\d+$/.test(val)) return true;
    if (val === 'true' || val === 'false' || val === 'null' || val === 'undefined') return true;
    if (/\s/.test(val) || /[^\w]/.test(val)) return true;
    return false;
  };

  const processAction = (action: Action) => {
    if (action.kind === "call") {
      // call 动作的参数值来自结构化 {name, type, value}，都是字面量，不做变量引用检查
      if (action.assignTo) {
        declared.set(action.assignTo, "any");
      }
    } else if (action.kind === "assign") {
      if (typeof action.value === "string") {
        const val = action.value;
        if (!isLiteral(val) && /^[a-zA-Z_]\w*$/.test(val)) {
          if (!declared.has(val)) {
            errors.push(`变量 '${val}' 在赋值前未声明`);
          }
        }
      }
      if (action.target) {
        declared.set(action.target, "any");
      }
    } else if (action.kind === "return") {
      if (typeof action.value === "string") {
        const val = action.value;
        if (!isLiteral(val) && /^[a-zA-Z_]\w*$/.test(val)) {
          if (!declared.has(val)) {
            errors.push(`返回语句引用了未声明的变量 '${val}'`);
          }
        }
      }
    } else if (action.kind === "if") {
      if (typeof action.condition === "string") {
        const cond = action.condition;
        if (!isLiteral(cond) && /^[a-zA-Z_]\w*$/.test(cond)) {
          if (!declared.has(cond) && cond !== 'true' && cond !== 'false') {
            errors.push(`条件中引用了未声明的变量 '${cond}'`);
          }
        }
      }
      for (const a of (action.thenActions || [])) {
        processAction(a);
      }
      for (const a of (action.elseActions || [])) {
        processAction(a);
      }
    } else if (action.kind === "for") {
      if (action.variable) declared.set(action.variable, "any");
      for (const a of (action.bodyActions || [])) {
        processAction(a);
      }
    }
  };

  for (const action of actions) {
    processAction(action);
  }
  return errors;
}

/**
 * 校验单个动作的合法性（函数存在、类型匹配、参数数量）。
 * @protocol namespace=dev_pipeline pre_states=["IR_EXTRACTED"] post_states=["ACTION_VALIDATED"]
 */
/** @requires ACTION @produces VALIDATION_RESULT */
export function validateAction(action: Action, actionIndex?: number): { valid: boolean; errors: string[]; violations: ConstraintViolation[] } {
  const functions = loadIR();
  const errors: string[] = [];
  const violations: ConstraintViolation[] = [];
  const idx = actionIndex ?? 0;

  if (!action || !["call", "if", "for", "assign", "return"].includes(action.kind)) {
    const msg = `无效动作类型: '${action?.kind}'`;
    errors.push(msg);
    violations.push({ svl: 1, violatedConstraint: "symbol_existence", actionIndex: idx, description: msg });
    return { valid: false, errors, violations };
  }

  if (action.kind === "call") {
    const fn = functions.find((f: FunctionInfo) => f.name === action.function);
    if (!fn) {
      if (action.function && BUILTIN_WHITELIST.has(action.function)) return { valid: true, errors: [], violations: [] };
      const msg = `函数 '${action.function}' 不存在`;
      errors.push(msg);
      violations.push({ svl: 1, violatedConstraint: "symbol_existence", actionIndex: idx, missingStates: [action.function], description: msg });
      return { valid: false, errors, violations };
    }
    if (!action.args) {
      const msg = `函数 '${action.function}' 缺少参数列表`;
      errors.push(msg);
      violations.push({ svl: 2, violatedConstraint: "type_mismatch", actionIndex: idx, description: msg });
      return { valid: false, errors, violations };
    }
    if (action.args.length !== fn.params.length) {
      const msg = `参数数量不匹配: 期望 ${fn.params.length}, 实际 ${action.args.length}`;
      errors.push(msg);
      violations.push({ svl: 2, violatedConstraint: "type_mismatch", actionIndex: idx, description: msg });
    }
    action.args.forEach((arg, i) => {
      if (!arg) {
        const msg = `函数 '${action.function}' 的第${i}个参数为空`;
        errors.push(msg);
        violations.push({ svl: 2, violatedConstraint: "type_mismatch", actionIndex: idx, description: msg });
        return;
      }
      const expected = normalizeType(fn.params[i]?.type);
      const actual = normalizeType(arg.type);
      if (actual !== "any" && expected !== "any" && actual !== expected) {
        const msg = `类型不匹配: 参数 '${fn.params[i].name}' 期望 ${expected}, 实际 ${actual}`;
        errors.push(msg);
        violations.push({ svl: 2, violatedConstraint: "type_mismatch", actionIndex: idx, description: msg });
      }
    });
  } else if (action.kind === "if") {
    if (action.thenActions) {
      for (const a of action.thenActions) {
        const r = validateAction(a, idx);
        errors.push(...r.errors);
        violations.push(...r.violations);
      }
    }
    if (action.elseActions) {
      for (const a of action.elseActions) {
        const r = validateAction(a, idx);
        errors.push(...r.errors);
        violations.push(...r.violations);
      }
    }
  } else if (action.kind === "for") {
    if (action.bodyActions) {
      for (const a of action.bodyActions) {
        const r = validateAction(a, idx);
        errors.push(...r.errors);
        violations.push(...r.violations);
      }
    }
  }

  return { valid: errors.length === 0, errors, violations };
}

/**
 * 批量校验动作序列 + 变量流向分析。
 * @protocol namespace=dev_pipeline pre_states=["ACTION_VALIDATED"] post_states=["SEQUENCE_VALIDATED"] invalidate=["ACTION_VALIDATED"]
 */
/** @requires ACTIONS @produces VALIDATION_RESULT */
export function validateActionSequence(actions: Action[]): { valid: boolean; errors: string[]; violations: ConstraintViolation[] } {
  const errors: string[] = [];
  const violations: ConstraintViolation[] = [];
  for (let i = 0; i < actions.length; i++) {
    const result = validateAction(actions[i], i);
    if (!result.valid) {
      errors.push(...result.errors);
      violations.push(...result.violations);
    }
  }
  if (errors.length === 0) {
    const flowErrors = checkVariableFlow(actions);
    if (flowErrors.length > 0) {
      errors.push(...flowErrors);
      for (const msg of flowErrors) {
        violations.push({ svl: 3, violatedConstraint: "dataflow", actionIndex: 0, description: msg });
      }
    }
  }

  // ── P0: Trajectory auto-collection — record ALL outcomes ──
  const actionNames = actions.map(a => (a as any).function || (a as any).kind || "?");
  const ctx: ContextFeatures = {
    nestingDepth: 0,
    exceptionHandled: false,
    insideLoop: false,
    branchCount: 0,
    asyncContext: false,
  };

  if (violations.length > 0) {
    // Record violation trajectories
    for (const v of violations) {
      try {
        recordTrajectory({
          protocol: v.namespace || "default",
          initialState: v.currentStates || [],
          finalState: v.requiredStates || [],
          trajectory: actionNames,
          result: "violation",
          violationType: svlToViolationType(v.svl, v.description),
          violationDesc: v.description,
          failingStepIndex: v.actionIndex,
          fixPath: v.fixPath,
          context: ctx,
          successRate: 0,
          intent: v.description,
        });
      } catch { /* auto-collection must never crash validation */ }
    }
  } else {
    // Record success trajectory — positive sample for reward learning
    try {
      recordSuccess({
        protocol: "default",
        initialState: ["INIT"],
        finalState: ["COMPLETED"],
        trajectory: actionNames,
        context: ctx,
        source: "planner",
      });
    } catch { /* auto-collection must never crash validation */ }
  }

  return { valid: errors.length === 0, errors, violations };
}

/** Map SVL level to ViolationType for auto-collection. */
function svlToViolationType(svl: number, desc: string): import("./runtime-types").ViolationType {
  if (svl === 4) return "protocol_violation";
  if (svl === 1) return "undefined_variable";
  if (desc.includes("type")) return "wrong_arg_type";
  if (desc.includes("import") || desc.includes("module")) return "wrong_import_path";
  if (desc.includes("arg") || desc.includes("parameter")) return "wrong_arg_count";
  return "other";
}

/**
 * Result-typed variant of validateActionSequence.
 * Returns Ok<Action[]> on success, Err<ValidationError[]> on failure.
 * Use this for new code; the legacy {valid, errors} API remains for backward compat.
 */
export function validateActionResult(actions: Action[]): Result<Action[], ValidationError[]> {
  const legacy = validateActionSequence(actions);
  if (legacy.valid) return ok(actions);

  const mapped: ValidationError[] = legacy.errors.map((msg, i) => {
    const v = legacy.violations[i];
    return {
      message: msg,
      code: v?.violatedConstraint || "unknown",
      index: v?.actionIndex,
    };
  });
  return err(mapped);
}

// ═══════════════════════════════════════════════════════════════
// P2 V3: Validation with Counterfactual Repair
// ═══════════════════════════════════════════════════════════════

/**
 * Validate an action sequence and enrich any violations with
 * counterfactual repair alternatives (top-3).
 *
 * This is the async V3 entry point — use this instead of
 * validateActionSequence when you want repair suggestions.
 */
export async function validateWithRepair(
  actions: Action[],
  params?: {
    protocol?: string;
    targetState?: string[];
    rules?: Map<string, { pre_states: string[]; post_states: string[]; invalidate?: string[]; namespace?: string }>;
  }
): Promise<{
  valid: boolean;
  errors: string[];
  violations: ConstraintViolation[];
}> {
  // Run the sync validation first
  const result = validateActionSequence(actions);

  if (result.valid || result.violations.length === 0) return result;

  // Enrich each violation with counterfactual alternatives
  const { suggestAlternatives } = await import("./counterfactual-engine");
  const enrichedViolations = [...result.violations];

  for (let i = 0; i < enrichedViolations.length; i++) {
    const v = enrichedViolations[i];
    try {
      const alts = await suggestAlternatives({
        violation: v,
        protocol: params?.protocol || v.namespace || "default",
        currentState: v.currentStates || [],
        targetState: params?.targetState || v.requiredStates || ["COMPLETED"],
        rules: params?.rules || new Map(),
      });

      enrichedViolations[i] = {
        ...v,
        repairAlternatives: alts.map(a => ({
          rank: a.rank,
          description: a.description,
          fixPath: a.fixPath,
          source: a.source,
          score: a.score,
          historicalSuccessRate: a.historicalSuccessRate,
        })),
      };
    } catch {
      // repair suggestion failure must never invalidate the base validation
    }
  }

  return { valid: false, errors: result.errors, violations: enrichedViolations };
}
