import { generate, chat, resetCallCount, estimateTokens, isVerbose } from "./llm";
import type { Action, ConstraintViolation, Attempt, ExecutionSession, AntibodyHit, StateTransition } from "./runtime-types";
import { generateAttemptId, generateSessionId, generatePlannerSeed } from "./runtime-types";
import { executeActionCode } from "./action-runtime";
import { validateActionSequence } from "./validator";
import { checkSemantic } from "./semantic-validator";
import { getFunctionSuccessRate, getWeightedSuccessRate, getFailureAdjustedCredit, recordRun } from "./feedback";
import { jaccardSimilarity, extractKeywords } from "./utils";
import { recordFailure, recordSession, saveCheckpoint, loadCheckpoint, clearCheckpoint, SVL, queryAntibodies, recordEdgeRejection } from "./failure-corpus";
import { recordEpisode, findSemanticTemplate } from "./memory-layer";
import { SSGRejection, FunctionProtocol, parseProtocolsFromJSON, ValidationContext, validateTransition, checkLedgerConsistency, rebuildState, hashRules, explainRejection, rejectionToJSON, findHeldResourceStates } from "./ssg-validator";
import { getNsInit } from "./protocol-registry";
import { createSnapshot, saveSnapshot } from "./semantic-snapshot";
import { selectCapabilityChains, formatChainHint } from "./strategy-planner";
import { getTopology, rebuildTopology } from "./semantic-topology";
import { SYSTEM_PROMPT, RETRY_HINT, buildCompactFuncList, buildChainHints, buildProtocolChainHint } from "./planner-prompts";
import { loadIR } from "./ir-utils";
import * as fs from "fs";

function enrichActions(actions: Action[], ir: any[]): Action[] {
  return actions.map(a => {
    if (!a || !a.kind) return a;
    if (a.kind === "call" && a.function && a.args) {
      const def = ir.find(f => f.name === a.function);
      if (def) {
        a.args = a.args.map((arg: any, i: number) => {
          if (!arg) return { name: `p${i}`, type: 'any', value: null };
          const paramDef = def.params[i];
          if (typeof arg === 'object' && arg.value !== undefined) {
            return { name: paramDef?.name || `p${i}`, type: paramDef?.type || 'any', value: arg.value };
          }
          return { name: paramDef?.name || `p${i}`, type: paramDef?.type || 'any', value: arg };
        });
      }
    }
    if (a.kind === "if") {
      a.thenActions = enrichActions(a.thenActions || [], ir);
      a.elseActions = enrichActions(a.elseActions || [], ir);
    }
    return a;
  });
}

function determineSVL(errors: string[]): SVL {
  if (errors.some(e => e.includes("不存在"))) return "SVL-1";
  if (errors.some(e => e.includes("类型不匹配") || e.includes("参数数量"))) return "SVL-2";
  if (errors.some(e => e.includes("变量") && (e.includes("未定义") || e.includes("引用自身")))) return "SVL-3";
  if (errors.some(e => e.includes("协议") || e.includes("状态"))) return "SVL-4";
  return "SVL-1";
}

function determineConstraintType(svl: SVL): string {
  switch (svl) {
    case "SVL-1": return "symbol_existence";
    case "SVL-2": return "type_mismatch";
    case "SVL-3": return "dataflow";
    case "SVL-4": return "protocol";
  }
}

/** 构建重试 prompt：精简但包含必要的 IR 语法提示 */

/** 解析 LLM 输出的紧凑 JSON 为 Action[]。
 *  格式: [{"f":"fn","to":"var","a":[{"n":"p","t":"str","v":"x"}]}, {"r":"var"}, ...]
 *  f=function(→call), to=assignTo, a=args, r=return, if=condition
 */
function parseActionJSON(text: string): Action[] | null {
  const clean = text.replace(/```(?:json|javascript)?\s*/gi, '').replace(/```\s*/g, '').trim();
  try {
    const arr = JSON.parse(clean);
    if (!Array.isArray(arr)) return null;
    const actions: Action[] = [];
    for (const item of arr) {
      if (!item || typeof item !== 'object') return null;
      if (item.r !== undefined) {
        actions.push({ kind: "return", value: item.r });
      } else if (item.f) {
        const a: Action = {
          kind: "call",
          function: item.f,
          args: (item.a || []).map((p: any) => ({
            name: p.n || "arg",
            type: p.t || "any",
            value: p.v ?? null,
          })),
        };
        if (item.to) a.assignTo = item.to;
        actions.push(a);
      } else if (item.if) {
        const a: Action = {
          kind: "if",
          condition: item.if,
          thenActions: item.then ? parseActionJSON(JSON.stringify(item.then)) || [] : [],
          elseActions: item.else ? parseActionJSON(JSON.stringify(item.else)) || [] : [],
        };
        actions.push(a);
      } else if (item.kind) {
        // 完整 Action 格式（后向兼容）
        actions.push(item as Action);
      } else {
        return null;
      }
    }
    return actions.length > 0 ? actions : null;
  } catch { return null; }
}

/** 模糊函数名纠正：当 LLM 生成不存在的函数名时，用 Jaccard 相似度找最接近的 IR 函数 */
function correctFunctionNames(actions: Action[], ir: any[]): { actions: Action[]; corrections: string[] } {
  const corrections: string[] = [];
  const corrected = actions.map((a, i) => {
    if (a.kind !== "call" || !a.function) return a;
    // 跳过已知存在的函数和白名单
    if (ir.some((f: any) => f.name === a.function)) return a;
    if (["if", "for", "assign", "return"].includes(a.function)) return a;
    // 用 Jaccard 相似度找最佳匹配
    let bestMatch = "";
    let bestScore = 0;
    const target = a.function.toLowerCase();
    for (const fn of ir) {
      const score = jaccardSimilarity(target, fn.name.toLowerCase());
      if (score > bestScore) {
        bestScore = score;
        bestMatch = fn.name;
      }
    }
    if (bestMatch && bestScore >= 0.3) {
      corrections.push(`action[${i}]: "${a.function}" → "${bestMatch}" (相似度 ${bestScore.toFixed(2)})`);
      return { ...a, function: bestMatch };
    }
    return a;
  });
  return { actions: corrected, corrections };
}

/** 参数签名预检：确保 call action 的参数数量与 IR 函数签名一致 */
function fixParameterCounts(actions: Action[], ir: any[]): { actions: Action[]; fixes: string[] } {
  const fixes: string[] = [];
  // Find the most recent preceding call with assignTo for chain defaults
  function findPrevVar(idx: number): string | undefined {
    for (let k = idx - 1; k >= 0; k--) {
      const prev = actions[k];
      if (prev.kind === "call" && prev.assignTo) return prev.assignTo;
    }
    return undefined;
  }
  const corrected = actions.map((a, i) => {
    if (a.kind !== "call" || !a.function) return a;
    const def = ir.find((f: any) => f.name === a.function);
    if (!def || !def.params) return a;
    const expected = def.params.length;
    const actual = a.args ? a.args.length : 0;
    if (actual === expected) return a;
    if (actual < expected) {
      const padded = [...(a.args || [])];
      const prevVar = findPrevVar(i);
      for (let j = actual; j < expected; j++) {
        // Smart default: chain from previous call if available
        const defaultValue = prevVar ? `$${prevVar}` : "";
        padded.push({ name: def.params[j].name, type: def.params[j].type || "any", value: defaultValue });
      }
      fixes.push(`action[${i}] ${a.function}: 参数 ${actual}→${expected} (填充 ${expected - actual} 个缺失参数${prevVar ? ", 链自 $" + prevVar : ""})`);
      return { ...a, args: padded };
    } else {
      fixes.push(`action[${i}] ${a.function}: 参数 ${actual}→${expected} (截断 ${actual - expected} 个多余参数)`);
      return { ...a, args: a.args.slice(0, expected) };
    }
  });
  return { actions: corrected, fixes };
}

/** 构建协议链提示：为 LLM 显示协议状态机的合法调用顺序 */
/** JSON schema pre-validation: structural checks before IR-aware validation.
 *  Catches malformed actions that parseActionJSON() accepted but are semantically invalid. */
function validateActionSchema(actions: Action[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const assignedVars = new Set<string>();
  const validVarName = /^[a-zA-Z_]\w*$/;

  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    const pos = `action[${i}]`;

    if (!a.kind) {
      errors.push(`${pos}: missing "kind" field`);
      continue;
    }

    switch (a.kind) {
      case "call": {
        if (!a.function || typeof a.function !== "string") {
          errors.push(`${pos}: call action requires "function" (string)`);
        }
        if (!Array.isArray(a.args)) {
          errors.push(`${pos}: call action requires "args" (array)`);
        } else {
          for (let j = 0; j < a.args.length; j++) {
            const arg = a.args[j];
            if (!arg || typeof arg !== "object") {
              errors.push(`${pos}: args[${j}] must be an object`);
            } else if (arg.name === undefined && arg.type === undefined && arg.value === undefined) {
              errors.push(`${pos}: args[${j}] missing name/type/value`);
            }
          }
        }
        if (a.assignTo !== undefined) {
          if (typeof a.assignTo !== "string" || !validVarName.test(a.assignTo)) {
            errors.push(`${pos}: assignTo "${a.assignTo}" is not a valid variable name`);
          } else if (assignedVars.has(a.assignTo)) {
            errors.push(`${pos}: duplicate assignTo "${a.assignTo}" (previously assigned at another action)`);
          } else {
            assignedVars.add(a.assignTo);
          }
        }
        break;
      }
      case "return": {
        if (a.value === undefined) {
          errors.push(`${pos}: return action requires "value"`);
        }
        if (i < actions.length - 1) {
          errors.push(`${pos}: return should be the last action (actions after return are unreachable)`);
        }
        break;
      }
      case "assign": {
        if (!a.target || typeof a.target !== "string" || !validVarName.test(a.target)) {
          errors.push(`${pos}: assign requires valid "target" variable name`);
        } else if (assignedVars.has(a.target)) {
          errors.push(`${pos}: duplicate assign target "${a.target}"`);
        } else {
          assignedVars.add(a.target);
        }
        if (a.value === undefined) {
          errors.push(`${pos}: assign action requires "value"`);
        }
        break;
      }
      case "if": {
        if (!a.condition || typeof a.condition !== "string") {
          errors.push(`${pos}: if action requires "condition" (string)`);
        }
        if (!Array.isArray(a.thenActions)) {
          errors.push(`${pos}: if action requires "thenActions" (array)`);
        } else {
          const thenCheck = validateActionSchema(a.thenActions);
          errors.push(...thenCheck.errors.map(e => `${pos}.thenActions: ${e}`));
        }
        if (a.elseActions && !Array.isArray(a.elseActions)) {
          errors.push(`${pos}: elseActions must be an array if present`);
        } else if (a.elseActions) {
          const elseCheck = validateActionSchema(a.elseActions);
          errors.push(...elseCheck.errors.map(e => `${pos}.elseActions: ${e}`));
        }
        break;
      }
      case "for": {
        if (!a.variable || typeof a.variable !== "string" || !validVarName.test(a.variable)) {
          errors.push(`${pos}: for action requires valid "variable" name`);
        }
        if (!a.iterable || typeof a.iterable !== "string") {
          errors.push(`${pos}: for action requires "iterable" (string)`);
        }
        if (!Array.isArray(a.bodyActions)) {
          errors.push(`${pos}: for action requires "bodyActions" (array)`);
        } else {
          const bodyCheck = validateActionSchema(a.bodyActions);
          errors.push(...bodyCheck.errors.map(e => `${pos}.bodyActions: ${e}`));
        }
        break;
      }
      default: {
        errors.push(`${pos}: unknown action kind "${(a as any).kind}"`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/** 构建重试 prompt：精简但包含必要的 IR 语法提示 */

/** 加载 IR 中所有带 protocol 的函数为协议规则，同时从 protocols.json 加载命名空间初始状态 */
function loadProtocols(ir: any[]): { protocols: FunctionProtocol[]; namespaceInitialStates: Map<string, string> } {
  const irProtocols = ir
    .filter((f: any) => f.protocol)
    .map((f: any) => ({ function: f.name, protocol: f.protocol }));

  // Phase 6C: use ProtocolRegistry for nsInit (single source of truth)
  const namespaceInitialStates = getNsInit();

  // Parse protocol rules from JSON (rules themselves still need the JSON for definitions)
  let jsonProtocols: FunctionProtocol[] = [];
  try {
    const protoDef = JSON.parse(fs.readFileSync("protocols.json", "utf-8"));
    jsonProtocols = parseProtocolsFromJSON(protoDef);
  } catch { /* topology rebuild — optional */ }

  // Merge: IR @protocol takes priority, but inherits JSON namespace
  const merged = new Map<string, FunctionProtocol>();
  for (const p of jsonProtocols) merged.set(p.function, p);
  for (const p of irProtocols) {
    const existing = merged.get(p.function);
    if (existing && existing.protocol.namespace && !p.protocol.namespace) {
      p.protocol.namespace = existing.protocol.namespace;
    }
    merged.set(p.function, p);
  }

  return { protocols: [...merged.values()], namespaceInitialStates };
}

/** 验证动作序列的协议合法性，使用 Semantic Ledger (Phase 3) 纯函数 */
export function validateProtocolWithTransitions(
  actions: Action[],
  protocols: FunctionProtocol[],
  namespaceInitialStates: Map<string, string>
): { valid: boolean; rejection?: SSGRejection; index?: number; trace?: { function: string; statesBefore: Record<string, string[]>; statesAfter: Record<string, string[]> }[]; transitions: StateTransition[]; ledgerConsistent?: boolean; ruleHash: string } {
  const rules = new Map<string, import("./ssg-validator").StateAnnotation>();
  for (const p of protocols) rules.set(p.function, p.protocol);

  const ruleHash = hashRules(rules);

  const ctx: ValidationContext = {
    ledger: [],
    currentState: rebuildState([], namespaceInitialStates),
  };
  const transitions: StateTransition[] = [];

  for (let i = 0; i < actions.length; i++) {
    const a = actions[i];
    if (a.kind === "call" && a.function) {
      const { valid, transition, rejection } = validateTransition(
        ctx, a.function, i, rules, namespaceInitialStates, ruleHash
      );
      transitions.push(transition);

      if (!valid) {
        const trace = transitions.map(t => ({
          function: t.function,
          statesBefore: t.statesBefore,
          statesAfter: t.statesAfter,
        }));
        return { valid: false, rejection: rejection!, index: i, trace, transitions, ruleHash };
      }

      // Incremental update — O(1) per step
      ctx.ledger = transitions;
      ctx.currentState = transition.statesAfter;
    }
  }

  // End-of-sequence check: held resources must be released (resource leak).
  // 共享判定见 ssg-validator.findHeldResourceStates：资源生命周期命名空间 +
  // pre/invalidate 交集（获取/释放语义）。会话/认证流合法地以活跃会话结束，
  // 不在检查范围（SESSION_ACTIVE 不是泄漏）。
  const heldStates = findHeldResourceStates(rules);
  // 只检查"本序列中获取"的持有状态——继承自命名空间初始状态的
  // （如 db 初始即 DB_CONNECTED）不算泄漏。
  const acquiredStates = new Set<string>();
  for (const t of transitions) {
    for (const ns of Object.keys(t.statesAfter || {})) {
      const after = t.statesAfter[ns] || [];
      const before = t.statesBefore?.[ns] || [];
      for (const s of after) {
        if (!before.includes(s)) acquiredStates.add(`${ns}::${s}`);
      }
    }
  }
  for (const hs of heldStates) {
    const cur = ctx.currentState[hs.namespace] || [];
    if (!acquiredStates.has(`${hs.namespace}::${hs.state}`)) continue;
    if (cur.includes(hs.state)) {
      const trace = transitions.map(t => ({
        function: t.function,
        statesBefore: t.statesBefore,
        statesAfter: t.statesAfter,
      }));
      return {
        valid: false,
        rejection: {
          blocked: "(end-of-sequence)",
          currentState: cur,
          requiredState: [],
          missingFunctions: [hs.releaseFn],
          fixPath: [hs.releaseFn],
          namespace: hs.namespace,
          endState: true,
        },
        index: actions.length,
        trace,
        transitions,
        ruleHash,
      };
    }
  }

  // Invariant check on full ledger
  const consistency = checkLedgerConsistency(transitions, namespaceInitialStates);
  if (!consistency.consistent) {
    console.error(`[Invariant] Ledger consistency violations: ${consistency.violations.length}`);
    for (const v of consistency.violations) {
      console.error(`  [${v.invariant}] index=${v.index}: ${v.detail}`);
    }
  }

  return { valid: true, transitions, ledgerConsistent: consistency.consistent, ruleHash };
}

/** SSG 确定性修复：当协议违规有已知修复路径时，自动插入缺失函数 */
function attemptSSGRepair(
  actions: Action[],
  rejection: SSGRejection,
  ir: any[],
  protocols: FunctionProtocol[],
  namespaceInitialStates: Map<string, string>,
  depth = 0
): Action[] | null {
  if (depth > 5) {
    console.error(`[修复] 递归深度超限 (${depth})，放弃确定性修复`);
    return null;
  }
  if (!rejection.fixPath || rejection.fixPath.length === 0) return null;

  // 名称归一化：内置规则可能是下划线风格（generate_jwt），项目 IR 是
  // camelCase（generateJwt）——修复动作必须使用 IR 中的真实函数名。
  const normalizeName = (n: string) => n.replace(/[_-]/g, "").toLowerCase();
  const resolveIR = (fnName: string) =>
    ir.find((f: any) => f.name === fnName)
    || ir.find((f: any) => normalizeName(f.name) === normalizeName(fnName));

  // 为修复路径中的每个函数创建合成 Action
  const repairActions: Action[] = [];
  for (const fnName of rejection.fixPath) {
    const def = resolveIR(fnName);
    if (!def) return null;
    const realName = def.name;

    const args = (def.params || []).map((p: any, i: number) => ({
      name: p.name || `p${i}`,
      type: p.type || 'any',
      value: "",
    }));

    const assignTo = def.returnType && def.returnType !== 'void' && def.returnType !== 'undefined'
      ? `${realName}_result` : undefined;

    const action: Action = { kind: 'call', function: realName, args };
    if (assignTo) action.assignTo = assignTo;
    repairActions.push(action);
  }

  let repaired: Action[];
  if (rejection.endState) {
    // 末尾状态违规（资源未释放）：释放函数追加到序列末尾
    repaired = [...actions, ...repairActions];
  } else {
    // 找到被拦截函数在序列中的位置
    const blockedIdx = actions.findIndex(a => a.kind === "call" && a.function === rejection.blocked);
    if (blockedIdx === -1) return null;

    // 在被拦截函数前插入修复函数
    repaired = [
      ...actions.slice(0, blockedIdx),
      ...repairActions,
      ...actions.slice(blockedIdx),
    ];
  }

  // 重新验证
  const recheck = validateProtocolWithTransitions(repaired, protocols, namespaceInitialStates);
  if (recheck.valid) {
    console.error(`🔧 SSG 确定性修复: 自动插入 ${rejection.fixPath.join(' → ')} 以解决协议违规`);
    return repaired;
  }

  // 单步修复不够，尝试递归修复
  if (recheck.rejection && recheck.rejection.fixPath && recheck.rejection.fixPath.length > 0) {
    console.error(`[修复] 重验仍失败 (blocked=${recheck.rejection.blocked}, fixPath=${recheck.rejection.fixPath.join(" → ")})，递归深度 ${depth + 1}`);
    const nested = attemptSSGRepair(repaired, recheck.rejection, ir, protocols, namespaceInitialStates, depth + 1);
    if (nested) return nested;
  }

  return null;
}

export interface PlanResult {
  actions: Action[];
  sessionId: string;
  ruleHash?: string;
  /** If true, LLM generation was exhausted and a rule-based fallback was used.
   *  The generated code may be minimal or low-quality. Callers should warn users. */
  degraded: boolean;
  /** Phase 6: Repair metrics */
  repairApplied: boolean;
  repairCount: number;
  repairBranchIds: string[];
  /** True when every generation attempt (and fallback) was blocked by
   *  constraints — actions will be empty and this MUST NOT be treated as
   *  "nothing to do". */
  blocked?: boolean;
  blockedReason?: string;
}

/** @requires INTENT @produces ACTION_PLAN */
export async function plan(userIntent: string, llmSeeds?: string[]): Promise<PlanResult> {
  resetCallCount();
  // IR 读取走 loadIR 的解析顺序（显式路径 → PROGMUNE_PROJECT_DIR → CWD → 包目录回退）
  const ir = loadIR();

  // P1: Build Semantic Topology (once per plan call, cached)
  try { rebuildTopology(ir); } catch { /* topology rebuild — optional */ }

  // Helper: wrap actions into PlanResult
  let repairMetrics = { applied: false, count: 0, branchIds: [] as string[] };

  const wrapResult = (actions: Action[], repair?: { applied: boolean; count: number; branchIds: string[] }, degraded = false, blocked?: boolean, blockedReason?: string): PlanResult => ({
    actions,
    sessionId: session?.sessionId || "",
    ruleHash: session?.ruleHash,
    degraded,
    repairApplied: repair?.applied ?? repairMetrics.applied,
    repairCount: repair?.count ?? repairMetrics.count,
    repairBranchIds: repair?.branchIds ?? repairMetrics.branchIds,
    blocked,
    blockedReason,
  });

  // 初始化执行会话和快照（需在抗体快速通道前创建，以便记录 antibody hits）
  const sessionId = generateSessionId();
  const session: ExecutionSession = {
    sessionId,
    intent: userIntent,
    attempts: [],
    resolved: false,
    startedAt: Date.now(),
  };
  const snapshot = createSnapshot(ir, userIntent);
  const snapshotId = saveSnapshot(snapshot);

  // 语义模板快速通道
  const cachedTemplate = findSemanticTemplate(userIntent);
  if (cachedTemplate && cachedTemplate.successRate >= 0.8 && cachedTemplate.useCount >= 2) {
    console.error("⚡ 命中语义模板，直接复用已验证序列");
    recordEpisode({ intent: userIntent, actions: cachedTemplate.actionSequence, success: true });
    return wrapResult(cachedTemplate.actionSequence);
  }

  // 提前加载协议（后续多处使用）
  const { protocols, namespaceInitialStates } = loadProtocols(ir);

  // ── Auto Router: repo-specific tasks → Graph ON, generic tasks → OFF ──
  const explicitMode = process.env.PROGMUNE_GRAPH_MODE;
  let graphMode = explicitMode || "off"; // default OFF

  if (!explicitMode) {
    // Extract repo-specific terms from IR
    const repoNames = new Set<string>();
    for (const f of ir) {
      for (const word of f.name.replace(/([A-Z])/g, " $1").toLowerCase().split(/[\s_]+/))
        if (word.length > 3) repoNames.add(word);
      for (const tag of (f.tags || [])) repoNames.add(tag.toLowerCase());
    }
    const stopWords = new Set(["this","that","with","from","have","been","their","will","would","could","should","about","which","there"]);
    for (const w of stopWords) repoNames.delete(w);

    // Split intent words the same way as function names: split on whitespace + camelCase
    const intentWords = userIntent
      .replace(/([A-Z])/g, " $1")            // camelCase → "camel Case" (before toLowerCase!)
      .toLowerCase()
      .split(/[\s,，]+/)
      .filter((w: string) => w.length > 2);
    const repoHits = intentWords.filter((w: string) => repoNames.has(w)).length;
    const density = intentWords.length > 0 ? repoHits / intentWords.length : 0;

    // 0.20 threshold — lower bound for short intents (3-5 words) still triggers correctly
    if (density > 0.20) { graphMode = "on"; console.error("[AutoRouter] "+Math.round(density*100)+"% repo terms → Graph ON"); }
  }

  // ── 抗体免疫系统：查询历史失败模式，注入知识回流 ──
  const antibodies = graphMode !== "off" ? queryAntibodies(userIntent, "ACL-3") : [];
  let antibodyHint = "";
  if (antibodies.length > 0) {
    const top = antibodies[0];
    const aclLabel = top.antibodyLevel;
    console.error(`🛡️  命中抗体: ${aclLabel} | 模式: ${top.signature} | 相似度: ${(top as any)._score.toFixed(2)}`);
    console.error(`   修复路径: ${top.fixPath.join(" → ")}`);

    // L2: ACL-4 全局稳定抗体 → 快速通道，绕过 LLM
    if (aclLabel === "ACL-4" && top.fixPath.length > 0) {
      const antibodyActions: Action[] = top.fixPath.map((fnName: string) => {
        const def = ir.find((f: any) => f.name === fnName);
        const args = (def?.params || []).map((p: any, i: number) => ({
          name: p.name || `p${i}`,
          type: p.type || 'any',
          value: "",
        }));
        const action: Action = { kind: 'call', function: fnName, args };
        if (def?.returnType && def.returnType !== 'void' && def.returnType !== 'undefined') {
          action.assignTo = `${fnName}_result`;
        }
        return action;
      });

      const antibodyHit: AntibodyHit = {
        level: aclLabel,
        signature: top.signature,
        fixPath: top.fixPath,
        similarityScore: (top as any)._score,
        action: "fast_path",
        llmCallsSaved: 1,
        estimatedTokensSaved: Math.ceil(estimateTokens(SYSTEM_PROMPT + userIntent) * 1.2),
      };

      // 验证抗体序列
      const antibodyRuleHash = (() => {
        const rules = new Map<string, import("./ssg-validator").StateAnnotation>();
        for (const p of protocols) rules.set(p.function, p.protocol);
        return hashRules(rules);
      })();
      if (protocols.length > 0) {
        const validation = validateProtocolWithTransitions(antibodyActions, protocols, namespaceInitialStates);
        if (validation.valid) {
          console.error(`⚡ ACL-4 抗体快速通道: 0 LLM 调用，节省 ~${Math.ceil(estimateTokens(SYSTEM_PROMPT + userIntent) * 1.2)} tokens (est.)`);
          const antibodyAttempt: Attempt = {
            id: generateAttemptId(),
            sessionId: session.sessionId,
            attemptNumber: 1,
            inputIntent: userIntent,
            plannerSeed: generatePlannerSeed("antibody-acl4", "immune"),
            constraintSnapshotId: snapshotId,
            generatedActions: antibodyActions,
            transitions: validation.transitions,
            violations: [],
            outcome: "success",
            timestamp: Date.now(),
            llmCallCount: 0,
            durationMs: 0,
            antibodyHit,
            ruleHash: validation.ruleHash,
          };
          session.attempts.push(antibodyAttempt);
          session.successfulAttempt = antibodyAttempt;
          session.ruleHash = validation.ruleHash;
          session.resolved = true;
          session.snapshotId = snapshotId;
          session.endedAt = Date.now();
          recordSession(session);
          recordEpisode({ intent: userIntent, actions: antibodyActions, success: true });
          return wrapResult(antibodyActions);
        }
      } else {
        // 无协议规则，直接信任抗体
        console.error(`⚡ ACL-4 抗体快速通道: 0 LLM 调用（无协议约束），节省 ~${Math.ceil(estimateTokens(SYSTEM_PROMPT + userIntent) * 1.2)} tokens (est.)`);
        const antibodyAttempt: Attempt = {
          id: generateAttemptId(),
          sessionId: session.sessionId,
          attemptNumber: 1,
          inputIntent: userIntent,
          plannerSeed: generatePlannerSeed("antibody-acl4", "immune"),
          constraintSnapshotId: snapshotId,
          generatedActions: antibodyActions,
          transitions: [],
          violations: [],
          outcome: "success",
          timestamp: Date.now(),
          llmCallCount: 0,
          durationMs: 0,
          antibodyHit,
          ruleHash: antibodyRuleHash,
        };
        session.attempts.push(antibodyAttempt);
        session.successfulAttempt = antibodyAttempt;
        session.ruleHash = antibodyRuleHash;
        session.resolved = true;
        session.snapshotId = snapshotId;
        session.endedAt = Date.now();
        recordSession(session);
        recordEpisode({ intent: userIntent, actions: antibodyActions, success: true });
        return wrapResult(antibodyActions);
      }
    }

    // L1: ACL-3 抗体注入提示 — 知识回流到 Planner
    const hints: string[] = [];
    for (let i = 0; i < Math.min(antibodies.length, 3); i++) {
      const ab = antibodies[i];
      const level = ab.antibodyLevel;
      const sig = ab.signature;
      const count = ab.occurrenceCount;
      const fix = ab.fixPath.join(" → ");
      // 为每种违规类型生成具体的避错指南
      const avoidance = sig.includes("F07") ? "确保在调用 .map/.filter 前检查对象是否为数组，使用 (obj || [])"
        : sig.includes("SVL-1") ? "只使用可用函数列表中的函数名，禁止编造"
        : sig.includes("SVL-2") ? `检查函数参数类型是否与 IR 签名一致`
        : sig.includes("SVL-4") ? `严格遵循 SSG 协议状态顺序：${fix}`
        : `避免此模式：${sig}`;
      hints.push(`${i + 1}. [${level}] ${sig}（累计 ${count} 次）→ ${avoidance}`);
    }
    antibodyHint = `\n\n⚠️ 免疫系统警告（来自 ${antibodies.length} 条历史抗体记录）：\n${hints.join("\n")}\n请避免上述已知错误模式。`;
    console.error(`💉 L1 抗体注入: ${antibodies.length} 条抗体 → ${hints.length} 条注入提示`);
  }

  const keywords = extractKeywords(userIntent);
  const intentLower = userIntent.toLowerCase();
  const scored = ir.map((f: any) => {
    let score = 0;
    // Name match (existing)
    for (const kw of keywords) {
      score += jaccardSimilarity(f.name.toLowerCase(), kw);
      if (f.name.toLowerCase().includes(kw)) score += 0.5;
    }
    // Capability Graph: purpose match
    if (f.purpose) {
      const purposeLower = f.purpose.toLowerCase();
      for (const kw of keywords) {
        if (purposeLower.includes(kw)) score += 1.0; // strong signal
      }
      // Full intent overlap with purpose
      const intentWords = intentLower.split(/[\s,，]+/);
      for (const w of intentWords) {
        if (w.length > 2 && purposeLower.includes(w)) score += 0.3;
      }
    }
    // Capability Graph: semantic requires/produces matching
    if (f.produces) {
      for (const p of f.produces) {
        const pText = p.toLowerCase().replace(/_/g, " ");
        // Exact match
        if (intentLower.includes(pText)) { score += 1.5; continue; }
        // Semantic: word overlap
        const pWords = pText.split(/\s+/);
        const matchCount = pWords.filter((w: string) => intentLower.includes(w)).length;
        if (matchCount > 0) score += matchCount * 0.5;
      }
    }
    if (f.requires) {
      for (const r of f.requires) {
        const rText = r.toLowerCase().replace(/_/g, " ");
        if (intentLower.includes(rText)) { score += 0.5; continue; }
        const rWords = rText.split(/\s+/);
        const matchCount = rWords.filter((w: string) => intentLower.includes(w)).length;
        if (matchCount > 0) score += matchCount * 0.2;
      }
    }
    // Semantic Capability: useWhen scenario matching
    if (f.useWhen) {
      for (const scenario of f.useWhen) {
        const scenarioWords = scenario.toLowerCase().split(/[\s,]+/);
        const matchCount = scenarioWords.filter((w: string) => w.length > 3 && intentLower.includes(w)).length;
        if (matchCount >= 2) score += 3.0; // strong signal: intent matches use case
        else if (matchCount === 1) score += 1.0;
      }
    }
    // Capability Graph: tag match
    if (f.tags) {
      for (const tag of f.tags) {
        if (intentLower.includes(tag.toLowerCase())) score += 0.8;
      }
    }
    // Dynamic Credit: multiply by actual success rate (0.1-1.0)
    const successRate = getFailureAdjustedCredit(f.name);
    const creditFactor = 0.3 + successRate * 0.7; // range: 0.3 (always fail) to 1.0 (always succeed)
    if (f.exported && !f.external) score *= creditFactor;
    return { ...f, score };
  });
  scored.sort((a: any, b: any) => b.score - a.score);
  const topFuncs = scored.slice(0, 15);

  // Strategy Layer: select capability chain (local, 0 LLM calls)
  const chainResult = graphMode !== "off" ? selectCapabilityChains(userIntent, ir, 3, llmSeeds) : { chains: [], needsLLM: false };
  const chains = chainResult.chains;
  const strategyHint = graphMode !== "off" ? formatChainHint(chains) : "";

  // Action Layer: filter functions to those in selected chains
  let chainFuncs = topFuncs;
  if (chains.length > 0) {
    const chainNames = new Set<string>();
    for (const c of chains.slice(0, 2)) {
      for (const n of c.nodes) chainNames.add(n.name);
    }
    // Prioritize chain functions: keep them first, add others as fallback
    const inChain = topFuncs.filter((f: any) => chainNames.has(f.name));
    const outChain = topFuncs.filter((f: any) => !chainNames.has(f.name));
    chainFuncs = [...inChain, ...outChain].slice(0, 15);
  }

  const compactFuncList = buildCompactFuncList(chainFuncs, ir);
  // Graph recommendations: only inject when explicitly enabled (default: off)
  // Graph validation (SVL, protocol, dataflow) always runs regardless
  const chainHints = graphMode === "on" ? buildChainHints(topFuncs) : "";

  // Known string-enum types: tell LLM these are strings, not objects
  const STRING_ENUMS: Record<string, string> = {
    "SVL": '"SVL-1"|"SVL-2"|"SVL-3"|"SVL-4"',
    "RootCause": '"F01"|"F02"|...|"F10"',
    "BranchReason": '"root"|"repair_attempt"|"alternative"',
    "RepairStrategy": '"insert"|"replace"|"reorder"',
  };
  const typeHints = Object.keys(STRING_ENUMS).length > 0
    ? `\n类型速查：${Object.entries(STRING_ENUMS).map(([k,v]) => `${k}=${v}`).join("，")}。这些类型传字符串值。`
    : "";

  const userIntentPart = userIntent.match(/(?:实现|implement|编写|创建)\s*(\w+)\s*(?:函数|function)?/i);
  const forbiddenFuncs: string[] = [];
  if (userIntentPart) {
    const targetName = userIntentPart[1];
    if (ir.find((f: any) => f.name.toLowerCase() === targetName.toLowerCase())) {
      forbiddenFuncs.push(targetName);
    }
  }

  const protocolChainHint = buildProtocolChainHint(protocols);

  const userPrompt = `可用函数：
${compactFuncList}${protocolChainHint}${chainHints}${typeHints}${strategyHint}

需求：${userIntent}${antibodyHint}

${RETRY_HINT}
只输出 JSON。`;

  const estimatedTokens = estimateTokens(SYSTEM_PROMPT + userPrompt);
  console.error(`💰 估算 prompt token: ${estimatedTokens}`);

  // ── 执行持久化：检查是否有未完成的 checkpoint ──
  const cp = loadCheckpoint(userIntent);
  let startRetry = 0;
  let finalActions: Action[] = [];
  let currentPrompt = userPrompt;
  let useSystem = true;

  if (cp) {
    console.error(`📌 恢复 checkpoint: 已完成 ${cp.attemptIndex} 次尝试，从第 ${cp.attemptIndex + 1} 次继续`);
    startRetry = cp.attemptIndex;
    currentPrompt = cp.currentPrompt;
    useSystem = cp.useSystem;
    // 从 checkpoint 恢复已有的 session.attempts
    if (cp.sessionAttempts) {
      session.attempts = cp.sessionAttempts;
    }
  }

  const sessionRuleHash = (() => {
    const rules = new Map<string, import("./ssg-validator").StateAnnotation>();
    for (const p of protocols) rules.set(p.function, p.protocol);
    return hashRules(rules);
  })();
  session.ruleHash = sessionRuleHash;

  function getMaskedFuncList(): string {
    if (protocols.length === 0) return compactFuncList;
    const rules = new Map<string, import("./ssg-validator").StateAnnotation>();
    for (const p of protocols) rules.set(p.function, p.protocol);
    const ctx: ValidationContext = { ledger: [], currentState: rebuildState([], namespaceInitialStates) };
    const legalFuncs = topFuncs.filter((f: any) => {
      const proto = protocols.find((p: any) => p.function === f.name);
      if (!proto) return true;
      const { valid } = validateTransition(ctx, f.name, 0, rules, namespaceInitialStates);
      return valid;
    });
    if (legalFuncs.length === topFuncs.length) return compactFuncList;
    return buildCompactFuncList(legalFuncs, ir);
  }

  const maxRetries = 3;

  for (let r = startRetry; r < maxRetries; r++) {
    let text: string;
    try {
      text = useSystem
        ? await chat(SYSTEM_PROMPT, currentPrompt)
        : await generate(`你是程序合成助手。\n\n${currentPrompt}`);
    } catch (e: any) {
      // 铁律：失败原因必须可见（不许静默绕过）——LLM 异常记录后继续重试/降级
      console.error(`⚠️ LLM 调用失败 (attempt ${r + 1}/${maxRetries}): ${e?.message || e}`);
      continue;
    }
    if (!text) continue;

    text = text.replace(/```(?:json|javascript)?\s*/gi, '').replace(/```\s*/g, '').trim();
    if (isVerbose()) {
      console.error(`\n📝 [VERBOSE] LLM raw output (attempt ${r + 1}/${maxRetries}):\n${text.slice(0, 3000)}${text.length > 3000 ? `\n... [${text.length - 3000} more chars]` : ""}\n`);
    } else {
      console.error("📝 LLM 输出:\n", text);
    }

    // 优先尝试 JSON 解析，失败则回退到 DSL 执行
    let rawActions = parseActionJSON(text);
    if (!rawActions || !Array.isArray(rawActions)) {
      console.error("⚠️ JSON 解析失败，尝试 DSL 回退...");
      rawActions = executeActionCode(text);
    }
    if (!rawActions || !Array.isArray(rawActions) || rawActions.length === 0) {
      console.error("⚠️ 解析失败，重试...");
      currentPrompt = `可用函数：\n${compactFuncList}${protocolChainHint}\n\n需求：${userIntent}${antibodyHint}\n\n上一次输出无效。请严格输出 JSON 数组。\n${RETRY_HINT}\n只输出 JSON。`;
      useSystem = false;
      continue;
    }

    // 🔧 SVL-1 修复: 模糊函数名纠正 — 把 LLM 编造的函数名映射到真实 IR 函数
    const nameCorrection = correctFunctionNames(rawActions, ir);
    if (nameCorrection.corrections.length > 0) {
      console.error("🔧 [SVL-1 自动修复] 函数名纠正:");
      for (const c of nameCorrection.corrections) console.error(`   ${c}`);
      rawActions = nameCorrection.actions;
    }

    // 🔧 SVL-2 修复: 参数签名预检 — 自动调整 args 数量匹配 IR 签名
    const paramFix = fixParameterCounts(rawActions, ir);
    if (paramFix.fixes.length > 0) {
      console.error("🔧 [SVL-2 自动修复] 参数数量修正:");
      for (const f of paramFix.fixes) console.error(`   ${f}`);
      rawActions = paramFix.actions;
    }

    // P2: JSON schema pre-validation — catch structural errors early
    const schemaCheck = validateActionSchema(rawActions);
    if (!schemaCheck.valid) {
      console.error("⚠️ JSON schema 校验失败:", schemaCheck.errors.join("; "));
      currentPrompt = `可用函数：\n${compactFuncList}${protocolChainHint}\n\n需求：${userIntent}${antibodyHint}\n\n输出格式错误：${schemaCheck.errors.join("；")}。请修正 JSON 结构。\n${RETRY_HINT}\n只输出 JSON。`;
      useSystem = false;
      const schemaViolation: ConstraintViolation = {
        svl: 1,
        violatedConstraint: "schema",
        actionIndex: 0,
        description: schemaCheck.errors.join("; "),
      };
      const schemaAttempt: Attempt = {
        id: generateAttemptId(),
        sessionId: session.sessionId,
        attemptNumber: r + 1,
        inputIntent: userIntent,
        plannerSeed: generatePlannerSeed(currentPrompt, process.env.LLM_MODEL || "deepseek-chat"),
        constraintSnapshotId: snapshotId,
        generatedActions: rawActions,
        transitions: [],
        violations: [schemaViolation],
        outcome: "constraint_violation",
        timestamp: Date.now(),
        llmCallCount: 0,
        durationMs: 0,
        ruleHash: sessionRuleHash,
      };
      session.attempts.push(schemaAttempt);
      recordEpisode({ intent: userIntent, actions: rawActions, success: false, svlViolated: "SVL-1" });
      saveCheckpoint(userIntent, { attemptIndex: r + 1, sessionAttempts: session.attempts, currentPrompt, useSystem });
      continue;
    }

    // 解析 $变量名 引用为实际变量名
    rawActions = rawActions.map(a => {
      if (a.kind === "call" && a.args) {
        a.args = a.args.map(arg => {
          if (typeof arg.value === 'string' && arg.value.startsWith('$')) {
            return { ...arg, value: arg.value.slice(1) };
          }
          return arg;
        });
      }
      return a;
    });

    const enriched = enrichActions(rawActions, ir);
    const filtered = enriched.filter(a => !forbiddenFuncs.includes(a.kind === "call" ? a.function : ''));
    let ssgTransitions: StateTransition[] = [];

    if (isVerbose()) {
      console.error(`🔬 [VERBOSE] Parsed ${rawActions.length} actions → ${enriched.length} enriched → ${filtered.length} after filtering`);
      for (let ai = 0; ai < filtered.length; ai++) {
        const a = filtered[ai];
        if (a.kind === "call") {
          console.error(`  [${ai}] call ${a.function}(${(a.args || []).map((x: any) => `${x.name}=${JSON.stringify(x.value)}`).join(", ")})`);
        } else {
          console.error(`  [${ai}] ${a.kind}`);
        }
      }
    }

    // 0) Hard Constraint Pre-check: local scan before full validation
    //    Saves LLM tokens by detecting obvious violations first
    const preCheckRules = new Map<string, import("./ssg-validator").StateAnnotation>();
    for (const p of protocols) preCheckRules.set(p.function, p.protocol);

    // Protocol pre-check: state must accumulate across the sequence
    const preCheckCtx: ValidationContext = { ledger: [], currentState: rebuildState([], namespaceInitialStates) };
    const preCheckErrors: string[] = [];
    for (let ai = 0; ai < filtered.length; ai++) {
      const a = filtered[ai];
      if (a.kind !== "call" || !a.function) continue;
      const def = ir.find((f: any) => f.name === a.function);
      if (!def) {
        preCheckErrors.push(`${a.function}: 函数不存在于 IR`);
        continue;
      }
      if (def.params && a.args && a.args.length !== def.params.length) {
        preCheckErrors.push(`${a.function}: 参数数量错误 (期望${def.params.length}, 实际${a.args.length})`);
      }
      // Protocol pre-check: verify function is callable in ACCUMULATED namespace state
      if (def.protocol && preCheckRules.size > 0) {
        const { valid, transition, rejection } = validateTransition(preCheckCtx, a.function, ai, preCheckRules, namespaceInitialStates);
        if (!valid && rejection) {
          preCheckErrors.push(`${a.function}: 协议违规 — 需要先调用 ${rejection.fixPath?.join(" → ") || "?"}`);
        }
        // Update accumulated state: validateTransition computes statesAfter but doesn't mutate ctx
        if (transition.valid) {
          preCheckCtx.currentState = transition.statesAfter;
        }
      }
    }

    // Strategy hint: warn if LLM missed all recommended nodes, record negative feedback
    if (chains.length > 0 && chains[0].nodes.length >= 2) {
      const topChain = chains[0];
      const recommendedFuncs = topChain.nodes.map(n => n.name);
      const chosenFuncs = filtered.filter(a => a.kind === "call").map(a => (a as any).function);
      const hasAny = recommendedFuncs.some(fn => chosenFuncs.includes(fn));
      if (!hasAny && recommendedFuncs.length >= 3) {
        console.error(`⚠️ 策略提示: LLM 未使用推荐链中的任何函数 (推荐: ${topChain.explanation})`);
        // Record negative feedback on recommended edges
        for (let i = 0; i < topChain.nodes.length - 1; i++) {
          recordEdgeRejection(topChain.nodes[i].name, topChain.nodes[i + 1].name);
        }
      }
    }

    // 1) 基础序列校验
    // 预检查的协议违规（"需要先调用 X"）不属于符号/类型错误——
    // 它们由下方 SSG 块以 SVL-4 处理（含确定性修复）。
    // 只有符号/类型类错误走本回退分支，避免把 SVL-4 误标为 SVL-1。
    const preCheckSymbolErrors = preCheckErrors.filter(e =>
      e.includes("函数不存在") || e.includes("参数数量"));
    const seqResult = validateActionSequence(filtered);
    if (!seqResult.valid || preCheckSymbolErrors.length > 0) {
      const errorsFlat = [...preCheckSymbolErrors, ...seqResult.errors.flat()];
      console.error("⚠️ 序列校验失败:", errorsFlat.join(", "));

      // Use structured violations directly from validator
      const violations: ConstraintViolation[] = seqResult.violations.length > 0
        ? seqResult.violations
        : preCheckSymbolErrors.length > 0
        ? [{ svl: 1 as const, violatedConstraint: "symbol_existence", actionIndex: 0, description: preCheckSymbolErrors.join("; ") }]
        : [{ svl: 1 as const, violatedConstraint: "symbol_existence", actionIndex: 0, description: errorsFlat.join("; ") }];

      const primarySvl = `SVL-${violations[0].svl}` as SVL;

      const attempt: Attempt = {
        id: generateAttemptId(),
        sessionId: session.sessionId,
        attemptNumber: r + 1,
        inputIntent: userIntent,
        plannerSeed: generatePlannerSeed(currentPrompt, process.env.LLM_MODEL || "deepseek-chat"),
        constraintSnapshotId: snapshotId,
        generatedActions: filtered,
        transitions: [],
        violations,
        outcome: "constraint_violation",
        timestamp: Date.now(),
        llmCallCount: 0,
        durationMs: 0,
        ruleHash: sessionRuleHash,
      };
      session.attempts.push(attempt);

      recordFailure({
        intent: userIntent,
        projectFunctions: ir.map((f: any) => f.name),
        violatedSVL: primarySvl,
        constraintType: violations[0].violatedConstraint,
        actionSequence: filtered,
        errorDetail: errorsFlat.join("; "),
        ssgMissingFunctions: violations[0].missingStates,
        plannerAttempt: r + 1,
        plannerRetryTotal: maxRetries,
      });
      recordEpisode({ intent: userIntent, actions: filtered, success: false, svlViolated: primarySvl });
      // Build targeted retry prompt based on pre-check results
      const specificErrors = preCheckSymbolErrors.length > 0
        ? `精确错误:\n${preCheckSymbolErrors.map(e => `  - ${e}`).join("\n")}`
        : `错误：${errorsFlat.join("；")}`;
      currentPrompt = `可用函数：\n${compactFuncList}${protocolChainHint}\n\n需求：${userIntent}${antibodyHint}\n\n${specificErrors}\n请修正上述问题。\n${RETRY_HINT}\n只输出 JSON。`;
      useSystem = false;
      saveCheckpoint(userIntent, { attemptIndex: r + 1, sessionAttempts: session.attempts, currentPrompt, useSystem });
      continue;
    }

    // 2) 协议状态机校验 (SSG)
    if (protocols.length > 0) {
      const protoResult = validateProtocolWithTransitions(filtered, protocols, namespaceInitialStates);
      if (!protoResult.valid && protoResult.rejection) {
        const rej = protoResult.rejection;
        // P3：fixPath / missingFunctions 归一化到 IR 真实函数名——
        // 内置规则是下划线风格（generate_jwt），项目 IR 是 camelCase
        // （generateJwt）。提示与记录使用项目里真实存在的名字。
        const normIRName = (n: string) =>
          ir.find((f: any) => f.name === n)
          || ir.find((f: any) => f.name.replace(/[_-]/g, "").toLowerCase() === n.replace(/[_-]/g, "").toLowerCase());
        rej.fixPath = (rej.fixPath || []).map(n => normIRName(n)?.name || n);
        rej.missingFunctions = (rej.missingFunctions || []).map(n => normIRName(n)?.name || n);
        const explain = explainRejection(rej);
        console.error(explain);

        const violation: ConstraintViolation = {
          svl: 4,
          violatedConstraint: "protocol",
          actionIndex: protoResult.index || 0,
          currentStates: rej.currentState,
          requiredStates: rej.requiredState,
          missingStates: rej.missingFunctions,
          fixPath: rej.fixPath,
          namespace: rej.namespace,
          description: JSON.stringify(rejectionToJSON(rej)),
        };

        const attempt: Attempt = {
          id: generateAttemptId(),
          sessionId: session.sessionId,
          attemptNumber: r + 1,
          inputIntent: userIntent,
          plannerSeed: generatePlannerSeed(currentPrompt, process.env.LLM_MODEL || "deepseek-chat"),
          constraintSnapshotId: snapshotId,
          generatedActions: filtered,
          transitions: protoResult.transitions,
          violations: [violation],
          outcome: "constraint_violation",
          timestamp: Date.now(),
          llmCallCount: 0,
          durationMs: 0,
          ruleHash: sessionRuleHash,
        };
        session.attempts.push(attempt);

        recordFailure({
          intent: userIntent,
          projectFunctions: ir.map((f: any) => f.name),
          violatedSVL: "SVL-4",
          constraintType: "protocol",
          actionSequence: filtered,
          errorDetail: JSON.stringify(rejectionToJSON(rej)),
          ssgState: rej.currentState,
          ssgTrace: protoResult.trace,
          ssgFixPath: rej.fixPath,
          ssgMissingFunctions: rej.missingFunctions,
          plannerAttempt: r + 1,
          plannerRetryTotal: maxRetries,
        });
        recordEpisode({ intent: userIntent, actions: filtered, success: false, svlViolated: "SVL-4" });

        // 尝试确定性修复：用 SSG 的 fixPath 自动插入缺失函数
        const repaired = attemptSSGRepair(filtered, rej, ir, protocols, namespaceInitialStates);
        if (repaired) {
          console.error("🔧 SSG 修复成功，跳过 LLM 重试");

          // Phase 6: Repair → Branch — 保留原始序列作为证据
          const { createRootBranch, createBranch } = require("./branch-ledger");
          const rootBranch = createRootBranch(filtered);
          rootBranch.outcome = "violation";
          const repairBranch = createBranch(rootBranch, "repair_attempt", repaired as any);
          repairBranch.outcome = "success";
          session.branchTree = [rootBranch, repairBranch];
          session.rootBranchId = rootBranch.id;

          repairMetrics = {
            applied: true,
            count: rej.fixPath?.length || 0,
            branchIds: [rootBranch.id, repairBranch.id],
          };

          // Phase 7: Record repair event for analytics
          try {
            const repairDir = ".progmune_corpus/repairs";
            if (!fs.existsSync(repairDir)) fs.mkdirSync(repairDir, { recursive: true });
            const repairRecord = {
              sessionId: session.sessionId,
              timestamp: Date.now(),
              violation: "SVL-4",
              constraint: "protocol",
              blockedFunction: rej.blocked,
              namespace: rej.namespace,
              missingStates: rej.missingFunctions,
              fixPath: rej.fixPath,
              originalPlan: filtered.map((a: any) => a.kind === "call" ? a.function : a.kind),
              repairPlan: (repaired as Action[]).map((a: any) => a.kind === "call" ? a.function : a.kind),
              success: true,
            };
            fs.writeFileSync(
              `${repairDir}/repair_${session.sessionId}.json`,
              JSON.stringify(repairRecord, null, 2),
              "utf-8"
            );
          } catch { /* topology rebuild — optional */ }

          finalActions = repaired;
          break;
        }

        const maskedFuncList = getMaskedFuncList();
        currentPrompt = `当前协议状态只允许以下函数：\n${maskedFuncList}${protocolChainHint}\n\n需求：${userIntent}${antibodyHint}\n\n协议违规：${explain.replace(/\n/g, '；')}。请修正。\n${RETRY_HINT}\n只输出 JSON。`;
        useSystem = false;
        saveCheckpoint(userIntent, { attemptIndex: r + 1, sessionAttempts: session.attempts, currentPrompt, useSystem });
        continue;
      }

      // SSG passed — capture transitions
      ssgTransitions = protoResult.transitions;
      if (isVerbose()) {
        console.error(`✅ [VERBOSE] Protocol (SSG) validation passed — ${ssgTransitions.length} transitions recorded`);
        for (const t of ssgTransitions.slice(0, 5)) {
          const ns = t.namespace || "_global";
          const before = t.statesBefore?.[ns] || [];
          const after = t.statesAfter?.[ns] || [];
          console.error(`  ${t.function}: [${before.join(",") || "·"}] → [${after.join(",") || "·"}] (ns=${ns})`);
        }
      }
    }

    // 3) 语义合约校验
    const semResult = checkSemantic(userIntent, filtered);
    if (isVerbose() && semResult.valid) {
      console.error(`✅ [VERBOSE] Semantic contract validation passed`);
    }
    if (!semResult.valid) {
      console.error("⚠️ 语义校验失败:", semResult.errors.join(", "));

      const violation: ConstraintViolation = {
        svl: 4,
        violatedConstraint: "semantic_contract",
        actionIndex: 0,
        description: semResult.errors.join("; "),
      };

      const attempt: Attempt = {
        id: generateAttemptId(),
        sessionId: session.sessionId,
        attemptNumber: r + 1,
        inputIntent: userIntent,
        plannerSeed: generatePlannerSeed(currentPrompt, process.env.LLM_MODEL || "deepseek-chat"),
        constraintSnapshotId: snapshotId,
        generatedActions: filtered,
        transitions: ssgTransitions,
        violations: [violation],
        outcome: "constraint_violation",
        timestamp: Date.now(),
        llmCallCount: 0,
        durationMs: 0,
        ruleHash: sessionRuleHash,
      };
      session.attempts.push(attempt);

      recordFailure({
        intent: userIntent,
        projectFunctions: ir.map((f: any) => f.name),
        violatedSVL: "SVL-4",
        constraintType: "protocol",
        actionSequence: filtered,
        errorDetail: semResult.errors.join("; "),
        plannerAttempt: r + 1,
        plannerRetryTotal: maxRetries,
      });
      recordEpisode({ intent: userIntent, actions: filtered, success: false, svlViolated: "SVL-4" });
      currentPrompt = `可用函数：\n${compactFuncList}${protocolChainHint}\n\n需求：${userIntent}${antibodyHint}\n\n语义错误：${semResult.errors.join("；")}。请修正。\n${RETRY_HINT}\n只输出 JSON。`;
      useSystem = false;
      saveCheckpoint(userIntent, { attemptIndex: r + 1, sessionAttempts: session.attempts, currentPrompt, useSystem });
      continue;
    }

    // Phase 8: Refinement — detect empty args, ask LLM to fill meaningful values
    const emptyArgs: { idx: number; fn: string; param: string; type: string }[] = [];
    for (let ai = 0; ai < filtered.length; ai++) {
      const a = filtered[ai];
      if (a.kind === "call" && a.args) {
        for (const arg of a.args) {
          const v = typeof arg === "object" ? arg.value : arg;
          const isEmpty = (val: any) => val === "" || val === 0 || val === false || val === null || (Array.isArray(val) && val.length === 0);
          if (isEmpty(v)) {
            emptyArgs.push({ idx: ai, fn: a.function || "?", param: arg.name || "?", type: arg.type || "?" });
          }
        }
      }
    }
    // Only refine empty args if validation also failed — don't break good chains
    if (emptyArgs.length > 0 && r < maxRetries - 1 && (!seqResult.valid || preCheckErrors.length > 0)) {
      const argDetails = emptyArgs.map(e => `  ${e.fn}() 参数 "${e.param}" (${e.type}) 是空值`).join("\n");
      console.error(`🔍 检测到 ${emptyArgs.length} 个空参数，启动精炼...`);
      currentPrompt = `可用函数：\n${compactFuncList}${protocolChainHint}\n\n需求：${userIntent}${antibodyHint}\n\n上一次生成的 JSON 中以下参数为空值：\n${argDetails}\n\n请为这些参数填入有意义的示例值（字符串用描述性值，数字用合理数值，对象用 {} as Type）。\n${RETRY_HINT}\n只输出 JSON。`;
      useSystem = false;
      continue;
    }

    // 4D Scoring Self-Verification: compare LLM choices against scores
    const chosenFuncs = filtered.filter(a => a.kind === "call").map(a => (a as any).function);
    const scoredFuncs = new Map(topFuncs.map((f: any) => [f.name, f.score || 0]));
    let scoreViolations = 0;
    for (const fn of chosenFuncs) {
      const actualScore: number = (scoredFuncs.get(fn) as number) || 0;
      const allScores = [...scoredFuncs.values()].filter((s): s is number => typeof s === "number" && s > 0);
    const maxScore = allScores.length > 0 ? Math.max(...allScores) : 0;
    if (maxScore > 0 && actualScore < maxScore * 0.3 && maxScore > 1) {
      scoreViolations++;
      const better = [...scoredFuncs.entries()]
        .filter(([_, s]) => typeof s === "number" && s > actualScore * 2)
        .sort((a, b) => (b[1] as number) - (a[1] as number))
        .slice(0, 3).map(([n, s]) => `${n}(${(s as number).toFixed(1)})`).join(", ");
        console.error(`⚠️ 评分偏低: ${fn}(${actualScore.toFixed(1)}) 被选中, 但更高分函数可用: ${better}`);
      }
    }
    if (scoreViolations > 0) {
      console.error(`📊 评分自省: ${scoreViolations}/${chosenFuncs.length} 个函数评分偏低 (阈值: 最高分30%)`);
    }

    // 校验通过：构建成功 Attempt
    const successAntibodyHit: AntibodyHit | undefined = antibodyHint
      ? {
          level: antibodies[0]?.antibodyLevel || "ACL-3",
          signature: antibodies[0]?.signature || "",
          fixPath: antibodies[0]?.fixPath || [],
          similarityScore: (antibodies[0] as any)?._score || 0,
          action: "injected_hint",
          llmCallsSaved: 0,
          estimatedTokensSaved: 0,
        }
      : undefined;

    const successAttempt: Attempt = {
      id: generateAttemptId(),
      sessionId: session.sessionId,
      attemptNumber: r + 1,
      inputIntent: userIntent,
      plannerSeed: generatePlannerSeed(currentPrompt, process.env.LLM_MODEL || "deepseek-chat"),
      constraintSnapshotId: snapshotId,
      generatedActions: filtered,
      transitions: ssgTransitions,
      violations: [],
      outcome: "success",
      timestamp: Date.now(),
      llmCallCount: 1,
      durationMs: 0,
      antibodyHit: successAntibodyHit,
      ruleHash: sessionRuleHash,
    };
    session.attempts.push(successAttempt);
    session.successfulAttempt = successAttempt;

    finalActions = filtered;
    break;
  }

  if (finalActions.length > 0) {
    recordEpisode({ intent: userIntent, actions: finalActions, success: true });
    session.resolved = true;
    session.snapshotId = snapshotId;
    session.endedAt = Date.now();
    recordSession(session); // Phase 5 will update recordSession to accept ExecutionSession
    clearCheckpoint(userIntent);
  } else {
    // LLM 3 次重试失败，尝试本地规则回退
    console.error("[降级] LLM 规划失败，尝试本地规则回退");
    const fallback = generateFallbackPlan(userIntent, ir);
    if (fallback.length > 0) {
      console.error(`[降级] 本地规则生成了 ${fallback.length} 个动作`);
      recordEpisode({ intent: userIntent, actions: fallback, success: true });

      const fallbackAttempt: Attempt = {
        id: generateAttemptId(),
        sessionId: session.sessionId,
        attemptNumber: session.attempts.length + 1,
        inputIntent: userIntent,
        plannerSeed: generatePlannerSeed("fallback", "local-rule"),
        constraintSnapshotId: snapshotId,
        generatedActions: fallback,
        transitions: [],
        violations: [],
        outcome: "success",
        timestamp: Date.now(),
        llmCallCount: 0,
        durationMs: 0,
        ruleHash: sessionRuleHash,
      };
      session.attempts.push(fallbackAttempt);
      session.successfulAttempt = fallbackAttempt;
      session.resolved = true;
      session.snapshotId = snapshotId;
      session.endedAt = Date.now();
      recordSession(session);
      clearCheckpoint(userIntent);
      console.error("[降级] 返回回退结果 — 代码质量可能不高，建议人工审核。");
      return wrapResult(fallback, undefined, true);
    }
    recordEpisode({ intent: userIntent, actions: [], success: false });
    session.resolved = false;
    session.snapshotId = snapshotId;
    session.endedAt = Date.now();
    recordSession(session);
    clearCheckpoint(userIntent);

    // 显式失败信号：所有尝试（含本地回退）都被约束拦截——
    // 调用方必须能区分"无事可做"与"被拦截"。
    const lastViolation = session.attempts.length > 0
      ? session.attempts[session.attempts.length - 1].violations[0]
      : undefined;
    const reason = lastViolation
      ? `所有生成尝试均被 SVL-${lastViolation.svl} 拦截: ${lastViolation.violatedConstraint}${lastViolation.fixPath?.length ? `（修复路径: ${lastViolation.fixPath.join(" → ")}）` : ""}`
      : "所有生成尝试均被约束拦截，本地回退亦失败";
    console.error(`[拦截] ${reason}`);
    return wrapResult([], undefined, true, true, reason);
  }

  return wrapResult(finalActions);
}

/** 本地规则回退：当 LLM 不可用时，根据意图关键词生成简单动作序列。
 *  使用实际的默认值（而非占位符），确保生成的代码至少可以编译运行。 */
function generateFallbackPlan(intent: string, ir: any[]): Action[] {
  const intentLower = intent.toLowerCase();
  const actions: Action[] = [];
  const keywords = intentLower.split(/[\s,，、]+/).filter(k => k.length > 1);
  const matchedFuncs: any[] = [];
  for (const kw of keywords) {
    for (const fn of ir) {
      if (fn.name.toLowerCase().includes(kw) && !matchedFuncs.find((f: any) => f.name === fn.name)) {
        matchedFuncs.push(fn);
      }
    }
  }
  if (matchedFuncs.length === 0) return [];

  // Sensible default values per type — no placeholder strings
  function defaultValue(typeName: string): any {
    const t = (typeName || "string").toLowerCase();
    if (t === "number") return 0;
    if (t === "boolean") return false;
    if (t.includes("[]") || t.includes("array")) return [];
    return ""; // string default
  }

  for (const fn of matchedFuncs) {
    const args = (fn.params || []).map((p: any, i: number) => ({
      name: p.name || `p${i}`,
      type: p.type || "string",
      value: defaultValue(p.type || "string"),
    }));
    const assignTo = fn.returnType && fn.returnType !== "void" && fn.returnType !== "undefined"
      ? `${fn.name}_result` : undefined;
    if (assignTo) {
      actions.push({ kind: "call", function: fn.name, args, assignTo } as Action);
    } else {
      actions.push({ kind: "call", function: fn.name, args } as Action);
    }
  }
  return actions;
}
