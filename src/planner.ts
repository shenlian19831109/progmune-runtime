import { generate, chat, resetCallCount, estimateTokens } from "./llm";
import type { Action, ConstraintViolation, Attempt, ExecutionSession, AntibodyHit, StateTransition } from "./runtime-types";
import { generateAttemptId, generateSessionId, generatePlannerSeed } from "./runtime-types";
import { executeActionCode } from "./action-runtime";
import { validateActionSequence } from "./validator";
import { checkSemantic } from "./semantic-validator";
import { getFunctionSuccessRate } from "./feedback";
import { jaccardSimilarity, extractKeywords } from "./utils";
import { recordFailure, recordSession, saveCheckpoint, loadCheckpoint, clearCheckpoint, SVL, queryAntibodies } from "./failure-corpus";
import { recordEpisode, findSemanticTemplate } from "./memory-layer";
import { SSGRejection, FunctionProtocol, parseProtocolsFromJSON, ValidationContext, validateTransition, checkLedgerConsistency, rebuildState, hashRules, explainRejection, rejectionToJSON } from "./ssg-validator";
import { getNsInit } from "./protocol-registry";
import { createSnapshot, saveSnapshot } from "./semantic-snapshot";
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

/** 构建紧凑函数列表 — 包含能力元数据帮助 LLM 理解函数语义 */
function buildCompactFuncList(funcs: any[], allFuncs: any[]): string {
  // Known string enums with example values
  const ENUM_DEFAULTS: Record<string, string> = {
    "SVL": '"SVL-4"', "RootCause": '"F01"', "BranchReason": '"repair_attempt"',
    "RepairStrategy": '"insert"', "ConstraintType": '"protocol"',
  };
  return funcs.map((f: any) => {
    const params = (f.params || []).map((p: any) => {
      const t = (p.type || "any").replace(/\[\]$/, "");
      const def = ENUM_DEFAULTS[t];
      return def ? `${p.name}: ${def}` : `${p.name}: ${p.type}`;
    }).join(",");
    let line = `${f.name}(${params})->${f.returnType || "any"}`;
    // Add capability metadata
    const meta: string[] = [];
    if (f.purpose) meta.push(f.purpose.slice(0, 60));
    if (f.produces && f.produces.length > 0) meta.push(`→${f.produces.join(",")}`);
    if (meta.length > 0) line += `  // ${meta.join(" | ")}`;
    return line;
  }).join("\n");
}

/** Build capability chain hints from IR: producer→consumer relationships.
 *  e.g. "failureStats → formatFailureStats (FAILURE_STATS)" */
function buildChainHints(funcs: any[]): string {
  const chains: string[] = [];
  for (const f of funcs) {
    if (!f.produces) continue;
    for (const p of f.produces) {
      const consumers = funcs.filter((x: any) => x.requires?.includes(p) && x.name !== f.name);
      for (const c of consumers) {
        chains.push(`${f.name}()→${c.name}()  // ${p}`);
      }
    }
  }
  if (chains.length === 0) return "";
  return "\n推荐调用链（先调生产者，用 $变量名 传给消费者）:\n" + chains.map(c => `  ${c}`).join("\n");
}

const SYSTEM_PROMPT = `你是程序合成助手。只输出 JSON 数组，不输出解释。

格式：[{"f":"函数名","to":"变量名","a":[{"n":"参数名","t":"类型","v":值}]},{"r":"变量名"}]

规则：
- 函数名从可用列表中选择，优先选注释中 purpose 匹配需求的函数
- 0参数函数直接用 "a":[]：{"f":"getAllSessions","to":"s","a":[]}
- 参数值规则（重要！）：
  - 字符串: "v":""（空串）或 "v":"SVL-4"（已知枚举值）
  - 数字: "v":0 或 "v":1
  - 布尔: "v":false
  - 对象/数组: "v":{} as Type
  - 上一个函数返回值: "v":"$变量名"（$前缀引用）
- 返回值: {"r":"变量名"} — 必须返回，不能只调用不返回
- 链式调用：看到推荐调用链时，用 $变量名 把生产者输出传给消费者

铁律：
- 函数签名中带引号的参数（如 "SVL-4"）是字符串值，直接写在 v 中
- 禁止写 {} as SVL、{} as RootCause 等。字符串枚举用引号值
- 最后一个 action 必须是 return
- 只输出 JSON`;

const RETRY_HINT = `输出格式：紧凑 JSON 数组 [{"f":"函数名","to":"变量名","a":[...]}]`;

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
  const corrected = actions.map((a, i) => {
    if (a.kind !== "call" || !a.function) return a;
    const def = ir.find((f: any) => f.name === a.function);
    if (!def || !def.params) return a;
    const expected = def.params.length;
    const actual = a.args ? a.args.length : 0;
    if (actual === expected) return a;
    if (actual < expected) {
      // 参数太少：填充缺失参数
      const padded = [...(a.args || [])];
      for (let j = actual; j < expected; j++) {
        padded.push({ name: def.params[j].name, type: def.params[j].type || "any", value: "" });
      }
      fixes.push(`action[${i}] ${a.function}: 参数 ${actual}→${expected} (填充 ${expected - actual} 个缺失参数)`);
      return { ...a, args: padded };
    } else {
      // 参数太多：截断多余参数
      fixes.push(`action[${i}] ${a.function}: 参数 ${actual}→${expected} (截断 ${actual - expected} 个多余参数)`);
      return { ...a, args: a.args.slice(0, expected) };
    }
  });
  return { actions: corrected, fixes };
}

/** 构建协议链提示：为 LLM 显示协议状态机的合法调用顺序 */
function buildProtocolChainHint(protocols: FunctionProtocol[]): string {
  if (protocols.length === 0) return "";
  // 按命名空间分组
  const byNs = new Map<string, FunctionProtocol[]>();
  for (const p of protocols) {
    const ns = p.protocol.namespace || "_global";
    if (!byNs.has(ns)) byNs.set(ns, []);
    byNs.get(ns)!.push(p);
  }
  const lines: string[] = ["\n⚠️ 协议约束（必须严格遵循调用顺序）:"];
  for (const [ns, fns] of byNs) {
    if (ns === "_global" || fns.length <= 1) continue;
    lines.push(`  [${ns}] 合法调用链: ${fns.map(p => p.function).join(" → ")}`);
    for (const p of fns) {
      const pre = p.protocol.pre_states?.join(",") || "(无)";
      const post = p.protocol.post_states?.join(",") || "(无)";
      lines.push(`    ${p.function}: 前置状态=[${pre}] → 后置状态=[${post}]`);
    }
  }
  return lines.join("\n");
}

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
  } catch {}

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
function validateProtocolWithTransitions(
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
  namespaceInitialStates: Map<string, string>
): Action[] | null {
  if (!rejection.fixPath || rejection.fixPath.length === 0) return null;

  // 找到被拦截函数在序列中的位置
  const blockedIdx = actions.findIndex(a => a.kind === "call" && a.function === rejection.blocked);
  if (blockedIdx === -1) return null;

  // 为修复路径中的每个函数创建合成 Action
  const repairActions: Action[] = [];
  for (const fnName of rejection.fixPath) {
    const def = ir.find((f: any) => f.name === fnName);
    if (!def) return null;

    const args = (def.params || []).map((p: any, i: number) => ({
      name: p.name || `p${i}`,
      type: p.type || 'any',
      value: "",
    }));

    const assignTo = def.returnType && def.returnType !== 'void' && def.returnType !== 'undefined'
      ? `${fnName}_result` : undefined;

    const action: Action = { kind: 'call', function: fnName, args };
    if (assignTo) action.assignTo = assignTo;
    repairActions.push(action);
  }

  // 在被拦截函数前插入修复函数
  const repaired = [
    ...actions.slice(0, blockedIdx),
    ...repairActions,
    ...actions.slice(blockedIdx),
  ];

  // 重新验证
  const recheck = validateProtocolWithTransitions(repaired, protocols, namespaceInitialStates);
  if (recheck.valid) {
    console.error(`🔧 SSG 确定性修复: 自动插入 ${rejection.fixPath.join(' → ')} 以解决协议违规`);
    return repaired;
  }

  // 单步修复不够，尝试递归修复
  if (recheck.rejection && recheck.rejection.fixPath && recheck.rejection.fixPath.length > 0) {
    const nested = attemptSSGRepair(repaired, recheck.rejection, ir, protocols, namespaceInitialStates);
    if (nested) return nested;
  }

  return null;
}

export interface PlanResult {
  actions: Action[];
  sessionId: string;
  ruleHash?: string;
  /** Phase 6: Repair metrics */
  repairApplied: boolean;
  repairCount: number;
  repairBranchIds: string[];
}

/** @requires INTENT @produces ACTION_PLAN */
export async function plan(userIntent: string): Promise<PlanResult> {
  resetCallCount();
  const irRaw = JSON.parse(fs.readFileSync("ir.json", "utf-8"));
  // Support both old (array) and new ({typeMap, functions}) formats
  const ir = Array.isArray(irRaw) ? irRaw : (irRaw.functions || []);

  // Helper: wrap actions into PlanResult
  let repairMetrics = { applied: false, count: 0, branchIds: [] as string[] };

  const wrapResult = (actions: Action[], repair?: { applied: boolean; count: number; branchIds: string[] }): PlanResult => ({
    actions,
    sessionId: session?.sessionId || "",
    ruleHash: session?.ruleHash,
    repairApplied: repair?.applied ?? repairMetrics.applied,
    repairCount: repair?.count ?? repairMetrics.count,
    repairBranchIds: repair?.branchIds ?? repairMetrics.branchIds,
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

  // 抗体免疫快速通道：查询高置信度抗体（ACL-3+），匹配则约束或跳过 LLM
  const antibodies = queryAntibodies(userIntent, "ACL-3");
  let antibodyHint = "";
  if (antibodies.length > 0) {
    const top = antibodies[0];
    const aclLabel = top.antibodyLevel;
    console.error(`🛡️  命中抗体: ${aclLabel} | 模式: ${top.signature} | 相似度: ${(top as any)._score.toFixed(2)}`);
    console.error(`   修复路径: ${top.fixPath.join(" → ")}`);

    // ACL-4: 全局稳定抗体 → 直接构建动作序列，跳过 LLM
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

    // ACL-3: 注入修复路径作为提示约束
    antibodyHint = `\n已知正确调用顺序: ${top.fixPath.join(" → ")}。请遵循此顺序。`;
    console.error(`💉 ACL-3 抗体注入提示: ${top.fixPath.join(" → ")}`);
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
    // Capability Graph: requires/produces capability matching
    if (f.produces) {
      for (const p of f.produces) {
        if (intentLower.includes(p.toLowerCase().replace(/_/g, " "))) score += 1.5;
      }
    }
    if (f.requires) {
      for (const r of f.requires) {
        if (intentLower.includes(r.toLowerCase().replace(/_/g, " "))) score += 0.5;
      }
    }
    // Capability Graph: tag match
    if (f.tags) {
      for (const tag of f.tags) {
        if (intentLower.includes(tag.toLowerCase())) score += 0.8;
      }
    }
    return { ...f, score };
  });
  scored.sort((a: any, b: any) => b.score - a.score);
  const topFuncs = scored.slice(0, 15);

  const compactFuncList = buildCompactFuncList(topFuncs, ir);
  const chainHints = buildChainHints(topFuncs);

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
${compactFuncList}${protocolChainHint}${chainHints}${typeHints}

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
    } catch (e) { continue; }
    if (!text) continue;

    text = text.replace(/```(?:json|javascript)?\s*/gi, '').replace(/```\s*/g, '').trim();
    console.error("📝 LLM 输出:\n", text);

    // 优先尝试 JSON 解析，失败则回退到 DSL 执行
    let rawActions = parseActionJSON(text);
    if (!rawActions || !Array.isArray(rawActions)) {
      console.error("⚠️ JSON 解析失败，尝试 DSL 回退...");
      rawActions = executeActionCode(text);
    }
    if (!rawActions || !Array.isArray(rawActions) || rawActions.length === 0) {
      console.error("⚠️ 解析失败，重试...");
      currentPrompt = `可用函数：\n${compactFuncList}${protocolChainHint}\n\n需求：${userIntent}\n\n上一次输出无效。请严格输出 JSON 数组。\n${RETRY_HINT}\n只输出 JSON。`;
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
      currentPrompt = `可用函数：\n${compactFuncList}${protocolChainHint}\n\n需求：${userIntent}\n\n输出格式错误：${schemaCheck.errors.join("；")}。请修正 JSON 结构。\n${RETRY_HINT}\n只输出 JSON。`;
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

    // 1) 基础序列校验
    const seqResult = validateActionSequence(filtered);
    if (!seqResult.valid) {
      const errorsFlat = seqResult.errors.flat();
      console.error("⚠️ 序列校验失败:", errorsFlat.join(", "));

      // Use structured violations directly from validator
      const violations: ConstraintViolation[] = seqResult.violations.length > 0
        ? seqResult.violations
        : [{
            svl: 1 as const,
            violatedConstraint: "symbol_existence",
            actionIndex: 0,
            description: errorsFlat.join("; "),
          }];

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
      currentPrompt = `可用函数：\n${compactFuncList}${protocolChainHint}\n\n需求：${userIntent}\n\n错误：${errorsFlat.join("；")}。请修正。\n${RETRY_HINT}\n只输出 JSON。`;
      useSystem = false;
      saveCheckpoint(userIntent, { attemptIndex: r + 1, sessionAttempts: session.attempts, currentPrompt, useSystem });
      continue;
    }

    // 2) 协议状态机校验 (SSG)
    if (protocols.length > 0) {
      const protoResult = validateProtocolWithTransitions(filtered, protocols, namespaceInitialStates);
      if (!protoResult.valid && protoResult.rejection) {
        const rej = protoResult.rejection;
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
          } catch {}

          finalActions = repaired;
          break;
        }

        const maskedFuncList = getMaskedFuncList();
        currentPrompt = `当前协议状态只允许以下函数：\n${maskedFuncList}${protocolChainHint}\n\n需求：${userIntent}\n\n协议违规：${explain.replace(/\n/g, '；')}。请修正。\n${RETRY_HINT}\n只输出 JSON。`;
        useSystem = false;
        saveCheckpoint(userIntent, { attemptIndex: r + 1, sessionAttempts: session.attempts, currentPrompt, useSystem });
        continue;
      }

      // SSG passed — capture transitions
      ssgTransitions = protoResult.transitions;
    }

    // 3) 语义合约校验
    const semResult = checkSemantic(userIntent, filtered);
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
      currentPrompt = `可用函数：\n${compactFuncList}${protocolChainHint}\n\n需求：${userIntent}\n\n语义错误：${semResult.errors.join("；")}。请修正。\n${RETRY_HINT}\n只输出 JSON。`;
      useSystem = false;
      saveCheckpoint(userIntent, { attemptIndex: r + 1, sessionAttempts: session.attempts, currentPrompt, useSystem });
      continue;
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
      return wrapResult(fallback);
    }
    recordEpisode({ intent: userIntent, actions: [], success: false });
    session.resolved = false;
    session.snapshotId = snapshotId;
    session.endedAt = Date.now();
    recordSession(session);
    clearCheckpoint(userIntent);
  }

  return wrapResult(finalActions);
}

/** 本地规则回退：当 LLM 不可用时，根据意图关键词生成简单动作序列 */
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
  for (const fn of matchedFuncs) {
    const args = (fn.params || []).map((p: any, i: number) => ({
      name: p.name || `p${i}`,
      type: p.type || 'any',
      value: `{{${p.name || `p${i}`}}}`
    }));
    const assignTo = fn.returnType && fn.returnType !== 'void' && fn.returnType !== 'undefined'
      ? `${fn.name}_result` : undefined;
    if (assignTo) {
      actions.push({ kind: 'call', function: fn.name, args, assignTo } as Action);
    } else {
      actions.push({ kind: 'call', function: fn.name, args } as Action);
    }
  }
  return actions;
}
