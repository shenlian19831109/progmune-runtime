import type { StateTransition } from "./runtime-types";
import * as crypto from "crypto";

export interface StateAnnotation {
  pre_states: string[];
  post_states: string[];
  invalidate?: string[];
  namespace?: string;
  /** Real-world library API names that map to this abstract protocol function.
   *  Format: "library.function" (e.g., "bcrypt.compare", "jwt.sign", "fs.openSync").
   *  Used by the SSG bridge for exact-match call→rule inference. */
  aliases?: string[];
  /** 项目注解原语的真实函数名（注解合并时设置）。修复路径渲染时优先展示
   *  真实名字而非通用规则名（如 checkPasswordBasedAuth 而非 verify_token）；
   *  BFS 展开时项目原语优先（stable sort，无 displayName 时顺序不变）。 */
  displayName?: string;
}

export interface FunctionProtocol {
  function: string;
  protocol: StateAnnotation;
}

export interface SSGRejection {
  blocked: string;
  currentState: string[];
  requiredState: string[];
  missingFunctions: string[];
  fixPath: string[];
  namespace: string;
  /** End-of-sequence rejection (held resource not released) — the repair
   *  appends the release function instead of inserting before a blocked call. */
  endState?: boolean;
}

/** 资源生命周期命名空间：会话/认证流合法地以活跃会话结束（SESSION_ACTIVE 不是泄漏），
 *  只有资源类命名空间（文件/数据库/连接/流等）做序列末尾持有状态检查。 */
export const RESOURCE_NAMESPACE_RE = /^(file|db|database|connection|conn|socket|stream|resource|io)/i;

export interface HeldResourceState {
  state: string;
  releaseFn: string;
  namespace: string;
}

/**
 * 找出资源持有状态候选：某规则的 pre_states 与 invalidate 的交集
 * （获取/释放语义——如 FILE_OPEN 由 open_file 设置、close_file 释放），
 * 仅限资源生命周期命名空间。planner 与 trust 桥接共用（endState 检查）。
 */
export function findHeldResourceStates(
  rules: Map<string, StateAnnotation>,
): HeldResourceState[] {
  const held: HeldResourceState[] = [];
  for (const [fn, ann] of rules) {
    const ns = ann.namespace || "";
    if (!RESOURCE_NAMESPACE_RE.test(ns)) continue;
    for (const s of ann.invalidate || []) {
      if ((ann.pre_states || []).includes(s)) {
        held.push({ state: s, releaseFn: fn, namespace: ns });
      }
    }
  }
  return held;
}

export interface SSGStepResult {
  valid: boolean;
  rejection?: SSGRejection;
  statesBefore: Record<string, string[]>;
  statesAfter: Record<string, string[]>;
  acquired: string[];
  invalidated: string[];
  namespace: string;
}

export interface SSGTraceNode {
  function: string;
  valid: boolean;
  rejection?: SSGRejection;
  statesBefore: Record<string, string[]>;
  statesAfter: Record<string, string[]>;
  acquired: string[];
  invalidated: string[];
  namespace: string;
}

// ── Phase 3: Semantic Ledger types ──

/** Incremental validation context — avoids O(n²) rebuildState() calls */
export interface ValidationContext {
  ledger: StateTransition[];
  currentState: Record<string, string[]>;
}

export interface LedgerConsistencyViolation {
  index: number;
  invariant: "before-consistency" | "delta-consistency" | "delta-legality";
  expected?: Record<string, string[]>;
  actual?: Record<string, string[]>;
  detail?: string;
}

const DEFAULT_NAMESPACE = "_global";

// ── Phase 4: Invariant Violation Error ──

export interface InvariantViolationDetail {
  invariant: "before-consistency" | "delta-consistency" | "rule-hash-mismatch" | "transition-order" | "delta-legality";
  index?: number;
  namespace?: string;
  function?: string;
  expected?: Record<string, string[]>;
  actual?: Record<string, string[]>;
}

export class InvariantViolationError extends Error {
  public readonly detail: InvariantViolationDetail;

  constructor(message: string, detail: InvariantViolationDetail) {
    super(message);
    this.name = "InvariantViolationError";
    this.detail = detail;
  }
}

// ═══════════════════════════════════════════════════════════════
// Phase 3: Pure Functions — Semantic Ledger Kernel
// ═══════════════════════════════════════════════════════════════

// ── Internal helpers ──

function toSnapshot(stateMap: Map<string, Set<string>>): Record<string, string[]> {
  const snap: Record<string, string[]> = {};
  for (const [ns, states] of stateMap) {
    snap[ns] = [...states].sort();
  }
  return snap;
}

function fromSnapshot(snap: Record<string, string[]>): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const [ns, states] of Object.entries(snap)) {
    map.set(ns, new Set(states));
  }
  return map;
}

function deepEqualSnapshots(a: Record<string, string[]>, b: Record<string, string[]>): boolean {
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (keysA.length !== keysB.length) return false;
  for (let i = 0; i < keysA.length; i++) {
    if (keysA[i] !== keysB[i]) return false;
    const statesA = a[keysA[i]];
    const statesB = b[keysA[i]];
    if (statesA.length !== statesB.length) return false;
    for (let j = 0; j < statesA.length; j++) {
      if (statesA[j] !== statesB[j]) return false;
    }
  }
  return true;
}

// ── rebuildState: pure fold over ledger → per-namespace state snapshot ──

/** @requires LEDGER_DATA @produces STATE_SNAPSHOT */
export function rebuildState(
  ledger: StateTransition[],
  namespaceInitialStates: Map<string, string> = new Map([["_global", "INIT"]])
): Record<string, string[]> {
  const stateMap = fromSnapshot({});
  for (const [ns, initState] of namespaceInitialStates) {
    stateMap.set(ns, new Set<string>([initState]));
  }
  if (!stateMap.has("_global")) stateMap.set("_global", new Set<string>(["INIT"]));

  for (const t of ledger) {
    if (!t.valid) continue;
    applyTransitionDelta(stateMap, t);
  }
  return toSnapshot(stateMap);
}

// ── applyTransitionDelta: incremental primitive for O(n) loops ──

export function applyTransitionDelta(
  stateMap: Map<string, Set<string>>,
  transition: StateTransition
): void {
  const ns = transition.namespace || DEFAULT_NAMESPACE;
  const nsStates = stateMap.get(ns) || new Set<string>();
  for (const s of transition.invalidated) nsStates.delete(s);
  for (const s of transition.acquired) nsStates.add(s);
  stateMap.set(ns, nsStates);
}

// ── computeDelta: derive acquired/invalidated from before/after for one namespace ──

function computeDelta(
  beforeSnap: Record<string, string[]>,
  afterSnap: Record<string, string[]>,
  namespace: string
): { acquired: string[]; invalidated: string[] } {
  const before = beforeSnap[namespace] || [];
  const after = afterSnap[namespace] || [];
  const acquired = after.filter(s => !before.includes(s));
  const invalidated = before.filter(s => !after.includes(s));
  return { acquired, invalidated };
}

// ── findFixPathStatic: BFS state graph search (extracted from class) ──

/** @requires CURRENT_STATES @produces FIX_PATH */
export function findFixPathStatic(
  rules: Map<string, StateAnnotation>,
  namespace: string,
  current: string[],
  targetPreStates: string[]
): string[] {
  const nsFuncs: { name: string; rule: StateAnnotation }[] = [];
  for (const [fn, rule] of rules) {
    if ((rule.namespace || DEFAULT_NAMESPACE) === namespace) {
      nsFuncs.push({ name: fn, rule });
    }
  }
  // 项目注解原语优先展开（修复路径输出真实函数名而非通用规则名）；
  // stable sort：无 displayName 的规则（内置/TS/Python 惯例）相对顺序不变
  nsFuncs.sort((a, b) => {
    const pa = a.rule.displayName ? 0 : 1;
    const pb = b.rule.displayName ? 0 : 1;
    return pa - pb;
  });

  // BFS
  const startKey = [...new Set(current)].sort().join(",");
  const visited = new Set<string>();
  const queue: { states: Set<string>; path: string[] }[] = [
    { states: new Set(current), path: [] }
  ];
  visited.add(startKey);

  while (queue.length > 0) {
    const { states, path } = queue.shift()!;
    if (targetPreStates.every(s => states.has(s))) return path;

    for (const { name, rule } of nsFuncs) {
      if (!rule.pre_states.every(p => states.has(p))) continue;
      const nextStates = new Set(states);
      if (rule.invalidate) rule.invalidate.forEach(s => nextStates.delete(s));
      rule.post_states.forEach(s => nextStates.add(s));
      const nextKey = [...nextStates].sort().join(",");
      if (visited.has(nextKey)) continue;
      visited.add(nextKey);
      if (visited.size > 1000) break;
      queue.push({ states: nextStates, path: [...path, name] });
    }
  }

  // Fallback: single-hop greedy
  const path: string[] = [];
  const currentSet = new Set(current);
  for (const target of targetPreStates) {
    if (currentSet.has(target)) continue;
    for (const { name, rule } of nsFuncs) {
      if (rule.post_states.includes(target)) {
        path.push(name);
        if (rule.invalidate) rule.invalidate.forEach(s => currentSet.delete(s));
        rule.post_states.forEach(s => currentSet.add(s));
        break;
      }
    }
  }
  return path;
}

// ── validateTransition: pure function, stateless ──

/** @requires TRANSITION_CONTEXT @produces VALIDATION_RESULT */
export function validateTransition(
  ctx: ValidationContext,
  candidateFunctionName: string,
  actionIndex: number,
  rules: Map<string, StateAnnotation>,
  namespaceInitialStates: Map<string, string>,
  ruleHash?: string
): { valid: boolean; transition: StateTransition; rejection?: SSGRejection } {
  const currentState = ctx.currentState;
  const rule = rules.get(candidateFunctionName);

  if (!rule) {
    const transition: StateTransition = {
      actionIndex,
      function: candidateFunctionName,
      namespace: DEFAULT_NAMESPACE,
      acquired: [],
      invalidated: [],
      statesBefore: currentState,
      statesAfter: currentState,
      valid: true,
      ruleHash,
    };
    // Invariant-1: delta consistency for no-rule transition (trivially satisfied)
    return { valid: true, transition };
  }

  const ns = rule.namespace || DEFAULT_NAMESPACE;
  const nsStates = new Set(currentState[ns] || []);

  // Check pre-states
  if (!rule.pre_states.every((s: string) => nsStates.has(s))) {
    const fixPath = findFixPathStatic(rules, ns, [...nsStates], rule.pre_states);
    const rejection: SSGRejection = {
      blocked: candidateFunctionName,
      currentState: [...nsStates],
      requiredState: rule.pre_states,
      missingFunctions: fixPath,
      fixPath,
      namespace: ns,
    };

    const transition: StateTransition = {
      actionIndex,
      function: candidateFunctionName,
      namespace: ns,
      acquired: [],
      invalidated: [],
      statesBefore: currentState,
      statesAfter: currentState,  // no state change on rejection
      valid: false,
      ruleHash,
    };
    return { valid: false, transition, rejection };
  }

  // Valid — compute state change
  const beforeNs = [...nsStates];
  if (rule.invalidate) rule.invalidate.forEach((s: string) => nsStates.delete(s));
  rule.post_states.forEach((s: string) => nsStates.add(s));

  // Build statesAfter: copy currentState, replace this namespace
  const statesAfter: Record<string, string[]> = {};
  for (const nsKey of Object.keys(currentState)) {
    statesAfter[nsKey] = nsKey === ns
      ? [...nsStates].sort()
      : [...(currentState[nsKey] || [])];
  }
  if (!statesAfter[ns]) {
    statesAfter[ns] = [...nsStates].sort();
  }

  const afterNs = statesAfter[ns] || [];
  const acquired = afterNs.filter((s: string) => !beforeNs.includes(s));
  const invalidated = beforeNs.filter((s: string) => !afterNs.includes(s));

  const transition: StateTransition = {
    actionIndex,
    function: candidateFunctionName,
    namespace: ns,
    acquired,
    invalidated,
    statesBefore: currentState,
    statesAfter,
    valid: true,
    ruleHash,
  };

  // Invariant-1: delta consistency (skip in fast mode for performance)
  if (process.env.PROGMUNE_FAST_VALIDATE !== "true") {
  const deltaMap = fromSnapshot(currentState);
  applyTransitionDelta(deltaMap, transition);
  const computedAfter = toSnapshot(deltaMap);
  if (!deepEqualSnapshots(computedAfter, statesAfter)) {
    const detail = `[Invariant-1] Delta consistency violation in validateTransition for "${candidateFunctionName}":\n` +
      `  acquired: [${acquired.join(", ")}]  invalidated: [${invalidated.join(", ")}]\n` +
      `  expected after: ${JSON.stringify(computedAfter)}\n` +
      `  actual after:   ${JSON.stringify(statesAfter)}`;
    // P0 Strict Mode: fail fast on kernel corruption
    if (process.env.PROGMUNE_STRICT !== "false") {
      throw new InvariantViolationError(detail, {
        invariant: "delta-consistency",
        namespace: ns,
        function: candidateFunctionName,
        expected: computedAfter,
        actual: statesAfter,
      });
    }
    console.error(detail);
  }
  } // PROGMUNE_FAST_VALIDATE guard

  return { valid: true, transition };
}

// ── checkLedgerConsistency: Invariant-0 + Invariant-1 over full ledger ──

/** @requires LEDGER_DATA @produces CONSISTENCY_RESULT */
export function checkLedgerConsistency(
  ledger: StateTransition[],
  namespaceInitialStates: Map<string, string> = new Map([["_global", "INIT"]]),
  protocolRules?: Map<string, StateAnnotation>,
): { consistent: boolean; violations: LedgerConsistencyViolation[] } {
  const violations: LedgerConsistencyViolation[] = [];
  const running = fromSnapshot({});

  // Pre-scan: collect all namespaces referenced in any transition
  const allNamespaces = new Set(namespaceInitialStates.keys());
  for (const t of ledger) {
    for (const ns of Object.keys(t.statesBefore)) allNamespaces.add(ns);
    for (const ns of Object.keys(t.statesAfter)) allNamespaces.add(ns);
    allNamespaces.add(t.namespace);
  }

  // Initialize running state: init from namespaceInitialStates, empty for others
  for (const ns of allNamespaces) {
    if (namespaceInitialStates.has(ns)) {
      running.set(ns, new Set<string>([namespaceInitialStates.get(ns)!]));
    } else {
      running.set(ns, new Set<string>());
    }
  }

  // Normalize a snapshot: 只比较 ledger 中实际出现过的命名空间。
  // 历史 session 只记录其触及的命名空间（protocol-registry 包目录回退修复前，
  // 无 protocols.json 的 cwd 下 nsInit 退化为仅 _global）——用全量 nsInit
  // 重建时未记录的 ns 不应参与比较，否则旧数据 before-consistency 全量误报。
  // 更严格一步：只记录"有过非空快照"的 ns——早期 session 对 file/db 等
  // 记录空数组（键存在但无信息），空数组不携带可比较的状态信息。
  const recordedNamespaces = new Set<string>();
  for (const t of ledger) {
    for (const [ns, states] of Object.entries(t.statesBefore)) {
      if ((states || []).length > 0) recordedNamespaces.add(ns);
    }
    for (const [ns, states] of Object.entries(t.statesAfter)) {
      if ((states || []).length > 0) recordedNamespaces.add(ns);
    }
  }
  function normalizeSnap(snap: Record<string, string[]>): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const ns of recordedNamespaces) {
      out[ns] = [...(snap[ns] || [])].sort();
    }
    return out;
  }

  for (let i = 0; i < ledger.length; i++) {
    const t = ledger[i];

    // Invariant-0: statesBefore must equal rebuildState(ledger[0..i-1])
    const expectedBefore = normalizeSnap(toSnapshot(running));
    const actualBefore = normalizeSnap(t.statesBefore);
    if (!deepEqualSnapshots(expectedBefore, actualBefore)) {
      violations.push({
        index: i,
        invariant: "before-consistency",
        expected: expectedBefore,
        actual: actualBefore,
        detail: `Transition[${i}] "${t.function}": statesBefore does not match rebuilt state from previous ledger`,
      });
    }

    // Invariant-1: statesAfter must equal applyDelta(statesBefore, acquired, invalidated)
    if (t.valid) {
      const beforeMap = fromSnapshot(t.statesBefore);
      applyTransitionDelta(beforeMap, t);
      const expectedAfter = normalizeSnap(toSnapshot(beforeMap));
      const actualAfter = normalizeSnap(t.statesAfter);
      if (!deepEqualSnapshots(expectedAfter, actualAfter)) {
        violations.push({
          index: i,
          invariant: "delta-consistency",
          expected: expectedAfter,
          actual: actualAfter,
          detail: `Transition[${i}] "${t.function}": statesAfter does not match applyDelta(statesBefore, acquired, invalidated)`,
        });
      }
    }

    // Invariant-2: delta legality — acquired/invalidated must match protocol rules
    if (t.valid && protocolRules && protocolRules.size > 0) {
      const rule = protocolRules.get(t.function);
      if (rule) {
        // Check acquired states are in the function's post_states
        const beforeStates = t.statesBefore[t.namespace] || [];
        for (const a of (t.acquired || [])) {
          if (!rule.post_states.includes(a)) {
            violations.push({
              index: i,
              invariant: "delta-legality",
              detail: `Transition[${i}] "${t.function}": acquired state "${a}" is not in protocol post_states [${rule.post_states.join(", ")}]`,
            });
          }
          // Reject acquiring a state that already exists in statesBefore
          if (beforeStates.includes(a)) {
            violations.push({
              index: i,
              invariant: "delta-legality",
              detail: `Transition[${i}] "${t.function}": acquired state "${a}" already exists in statesBefore [${beforeStates.join(", ")}]`,
            });
          }
        }
        // Check invalidated states are in the function's invalidate list
        for (const inv of (t.invalidated || [])) {
          if (!(rule.invalidate || []).includes(inv)) {
            violations.push({
              index: i,
              invariant: "delta-legality",
              detail: `Transition[${i}] "${t.function}": invalidated state "${inv}" is not in protocol invalidate [${(rule.invalidate || []).join(", ")}]`,
            });
          }
        }
        // Check no missing expected invalidations (unless the function has no invalidate rule)
        if (rule.invalidate && rule.invalidate.length > 0) {
          for (const expectedInv of rule.invalidate) {
            if (!(t.invalidated || []).includes(expectedInv)) {
              violations.push({
                index: i,
                invariant: "delta-legality",
                detail: `Transition[${i}] "${t.function}": expected invalidation of "${expectedInv}" per protocol, but not present in transition`,
              });
            }
          }
        }
      }
    }

    // Advance running state
    if (t.valid) {
      applyTransitionDelta(running, t);
    }
  }

  return { consistent: violations.length === 0, violations };
}

// ── hashRules: stable hash of rule set for constraint snapshot (P1) ──

/** @requires RULES @produces RULE_HASH */
export function hashRules(rules: Map<string, StateAnnotation>): string {
  const sorted = [...rules.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, rule]) => ({
      function: name,
      pre_states: [...rule.pre_states].sort(),
      post_states: [...rule.post_states].sort(),
      invalidate: rule.invalidate ? [...rule.invalidate].sort() : undefined,
      namespace: rule.namespace || DEFAULT_NAMESPACE,
    }));
  return crypto.createHash("sha256").update(JSON.stringify(sorted)).digest("hex").slice(0, 16);
}

/** Compute a deterministic SHA256 hash of an entire ledger (P1: Tamper-evident integrity). */
/** @requires LEDGER_DATA @produces LEDGER_HASH */
export function hashLedger(ledger: StateTransition[]): string {
  const canonical = ledger.map(t => ({
    actionIndex: t.actionIndex,
    function: t.function,
    namespace: t.namespace,
    acquired: [...t.acquired].sort(),
    invalidated: [...t.invalidated].sort(),
    statesBefore: Object.fromEntries(
      Object.entries(t.statesBefore).map(([k, v]) => [k, [...v].sort()]).sort()
    ),
    statesAfter: Object.fromEntries(
      Object.entries(t.statesAfter).map(([k, v]) => [k, [...v].sort()]).sort()
    ),
    valid: t.valid,
    ruleHash: t.ruleHash || "",
  }));
  return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 16);
}

/** Result of comparing two ledgers. */
export interface LedgerDiff {
  /** Number of transitions with same index and hash in both ledgers. */
  unchanged: number;
  /** Transitions present in ledgerA but not (identically) in ledgerB. */
  onlyInA: { index: number; function: string; hashA: string }[];
  /** Transitions present in ledgerB but not (identically) in ledgerB. */
  onlyInB: { index: number; function: string; hashB: string }[];
  /** Transitions with same index but different content. */
  changed: { index: number; function: string; hashA: string; hashB: string }[];
  /** Whether the two ledgers are identical. */
  identical: boolean;
}

/** Compare two ledgers and identify structural differences. */
/** @requires TWO_LEDGERS @produces LEDGER_DIFF */
export function diffLedgers(ledgerA: StateTransition[], ledgerB: StateTransition[]): LedgerDiff {
  const hash = (t: StateTransition) =>
    crypto.createHash("sha256").update(JSON.stringify({
      i: t.actionIndex, f: t.function, n: t.namespace,
      a: [...t.acquired].sort(), x: [...t.invalidated].sort(),
      v: t.valid, r: t.ruleHash || "",
    })).digest("hex").slice(0, 12);

  const mapA = new Map<number, { t: StateTransition; h: string }>();
  const mapB = new Map<number, { t: StateTransition; h: string }>();
  for (const t of ledgerA) mapA.set(t.actionIndex, { t, h: hash(t) });
  for (const t of ledgerB) mapB.set(t.actionIndex, { t, h: hash(t) });

  const allIndices = new Set([...mapA.keys(), ...mapB.keys()]);
  const unchanged: number[] = [];
  const onlyInA: LedgerDiff["onlyInA"] = [];
  const onlyInB: LedgerDiff["onlyInB"] = [];
  const changed: LedgerDiff["changed"] = [];

  for (const idx of [...allIndices].sort((a, b) => a - b)) {
    const a = mapA.get(idx);
    const b = mapB.get(idx);
    if (a && b) {
      if (a.h === b.h) {
        unchanged.push(idx);
      } else {
        changed.push({ index: idx, function: a.t.function, hashA: a.h, hashB: b.h });
      }
    } else if (a && !b) {
      onlyInA.push({ index: idx, function: a.t.function, hashA: a.h });
    } else if (!a && b) {
      onlyInB.push({ index: idx, function: b.t.function, hashB: b.h });
    }
  }

  return {
    unchanged: unchanged.length,
    onlyInA,
    onlyInB,
    changed,
    identical: onlyInA.length === 0 && onlyInB.length === 0 && changed.length === 0,
  };
}

// ═══════════════════════════════════════════════════════════════
// Ledger Query API (P1-C) — the Semantic Ledger as a queryable database
// ═══════════════════════════════════════════════════════════════

export interface LedgerQueryResult {
  transition: StateTransition;
  index: number;
  namespace: string;
}

/** Find all transitions that acquire (produce) a given state in the ledger. */
export function findProducer(state: string, ledger: StateTransition[]): LedgerQueryResult[] {
  return ledger
    .map((t, i) => ({ transition: t, index: i, namespace: t.namespace }))
    .filter(r => r.transition.acquired.includes(state));
}

/** Find all transitions that have a given state in their pre_states (consume it). */
export function findConsumer(state: string, ledger: StateTransition[]): LedgerQueryResult[] {
  return ledger
    .map((t, i) => ({ transition: t, index: i, namespace: t.namespace }))
    .filter(r => (r.transition.statesBefore[r.namespace] || []).includes(state));
}

/** Find all invalid transitions in a ledger. */
export function findViolations(ledger: StateTransition[]): LedgerQueryResult[] {
  return ledger
    .map((t, i) => ({ transition: t, index: i, namespace: t.namespace }))
    .filter(r => !r.transition.valid);
}

/** Find a transition by its action index. */
export function findTransition(actionIndex: number, ledger: StateTransition[]): LedgerQueryResult | null {
  const idx = ledger.findIndex(t => t.actionIndex === actionIndex);
  if (idx === -1) return null;
  return { transition: ledger[idx], index: idx, namespace: ledger[idx].namespace };
}

/** List all unique states present across all namespaces in a ledger. */
export function listAllStates(ledger: StateTransition[]): { namespace: string; state: string }[] {
  const seen = new Set<string>();
  const result: { namespace: string; state: string }[] = [];
  for (const t of ledger) {
    const ns = t.namespace;
    for (const s of t.acquired) {
      const key = `${ns}:${s}`;
      if (!seen.has(key)) { seen.add(key); result.push({ namespace: ns, state: s }); }
    }
    for (const s of t.invalidated) {
      const key = `${ns}:${s}`;
      if (!seen.has(key)) { seen.add(key); result.push({ namespace: ns, state: s }); }
    }
    for (const states of Object.values(t.statesBefore)) {
      for (const s of states) {
        const key = `${ns}:${s}`;
        if (!seen.has(key)) { seen.add(key); result.push({ namespace: ns, state: s }); }
      }
    }
  }
  return result;
}


// ═══════════════════════════════════════════════════════════════
// StateMachineValidator — backward-compatible class wrapper
// Delegates to pure functions internally (Strangler Pattern)
// ═══════════════════════════════════════════════════════════════

export class StateMachineValidator {
  private readonly rules: Map<string, StateAnnotation>;
  private readonly nsInitialStates: Map<string, string>;

  /** Internal ledger — the truth source. State is derived from this. */
  private ledger: StateTransition[] = [];

  /** Cached validation context for O(n) incremental validation */
  private ctx: ValidationContext;

  /** Pre-computed rule hash for constraint snapshot (P1) */
  private readonly _ruleHash: string;

  constructor(rules: FunctionProtocol[], initialState: string = 'INIT', namespaceInitialStates?: Map<string, string>) {
    this.rules = new Map();
    rules.forEach(r => {
      this.rules.set(r.function, r.protocol);
    });

    this.nsInitialStates = new Map(namespaceInitialStates);
    if (!this.nsInitialStates.has("_global")) {
      this.nsInitialStates.set("_global", initialState);
    }

    // Pre-compute rule hash for constraint snapshot determinism
    this._ruleHash = hashRules(this.rules);

    // Initialize ledger and context from namespace initial states
    this.ctx = {
      ledger: [],
      currentState: rebuildState([], this.nsInitialStates),
    };
  }

  /** @deprecated Use validateTransition(ctx, ...) for stateless validation */
  setNamespaceInitialState(namespace: string, state: string): void {
    const ns = namespace || DEFAULT_NAMESPACE;
    this.nsInitialStates.set(ns, state);
    // Rebuild context to reflect new initial state
    this.ctx = {
      ledger: this.ledger,
      currentState: rebuildState(this.ledger, this.nsInitialStates),
    };
  }

  /**
   * Validate a function call against current protocol state.
   * Internally delegates to the pure validateTransition() function.
   * @deprecated Prefer validateTransition() directly for stateless validation.
   */
  apply(functionName: string, actionIndex?: number): SSGStepResult {
    const idx = actionIndex ?? this.ledger.length;
    const { valid, transition, rejection } = validateTransition(
      this.ctx, functionName, idx,
      this.rules, this.nsInitialStates,
      this._ruleHash
    );

    // Append to ledger (truth source)
    this.ledger.push(transition);

    // Update context incrementally (O(1) per step)
    if (transition.valid) {
      const stateMap = fromSnapshot(this.ctx.currentState);
      applyTransitionDelta(stateMap, transition);
      this.ctx = {
        ledger: this.ledger,
        currentState: toSnapshot(stateMap),
      };
    } else {
      this.ctx = {
        ledger: this.ledger,
        currentState: this.ctx.currentState,  // unchanged on rejection
      };
    }

    return {
      valid,
      statesBefore: transition.statesBefore,
      statesAfter: transition.statesAfter,
      acquired: transition.acquired,
      invalidated: transition.invalidated,
      namespace: transition.namespace,
      rejection,
    };
  }

  applyWithTransition(functionName: string, actionIndex: number): { result: SSGStepResult; transition: StateTransition } {
    const result = this.apply(functionName, actionIndex);
    const transition = this.ledger[this.ledger.length - 1];
    return { result, transition };
  }

  getCurrentStates(): string[] {
    const effective = new Set<string>();
    for (const states of Object.values(this.ctx.currentState)) {
      for (const s of states) effective.add(s);
    }
    return [...effective];
  }

  snapshotNamespaceStates(): Record<string, string[]> {
    return rebuildState(this.ledger, this.nsInitialStates);
  }

  getNamespaceStates(namespace: string): string[] {
    const ns = namespace || DEFAULT_NAMESPACE;
    return [...(this.ctx.currentState[ns] || [])];
  }

  /** Returns trace reconstructed from the ledger (backward-compat) */
  getTrace(): SSGTraceNode[] {
    // Replay the ledger to build trace nodes
    const trace: SSGTraceNode[] = [];
    const runningState = fromSnapshot({});
    for (const [ns, initState] of this.nsInitialStates) {
      runningState.set(ns, new Set<string>([initState]));
    }
    if (!runningState.has("_global")) runningState.set("_global", new Set<string>(["INIT"]));

    for (const t of this.ledger) {
      const node: SSGTraceNode = {
        function: t.function,
        valid: t.valid,
        statesBefore: t.statesBefore,
        statesAfter: t.statesAfter,
        acquired: t.acquired,
        invalidated: t.invalidated,
        namespace: t.namespace,
      };
      trace.push(node);
      if (t.valid) {
        applyTransitionDelta(runningState, t);
      }
    }
    return trace;
  }

  /** Returns the internal ledger (Phase 3 API) */
  getLedger(): StateTransition[] {
    return [...this.ledger];
  }

  /** Returns the current ValidationContext (Phase 3 API) */
  getContext(): ValidationContext {
    return { ...this.ctx, ledger: [...this.ctx.ledger] };
  }

  /** Returns the pre-computed rule hash (Phase 3 API) */
  getRuleHash(): string {
    return this._ruleHash;
  }

  // ── Static utilities (delegate to standalone functions) ──

  static explainRejection(rejection: SSGRejection): string {
    return explainRejection(rejection);
  }

  static rejectionToJSON(rejection: SSGRejection): object {
    return rejectionToJSON(rejection);
  }
}

// ═══════════════════════════════════════════════════════════════
// Standalone presentation utilities (formerly static methods)
// ═══════════════════════════════════════════════════════════════

/** Format an SSG rejection as a human-readable multi-line string. */
/** @requires SSG_REJECTION @produces EXPLANATION */
export function explainRejection(rejection: SSGRejection): string {
  const nsLabel = rejection.namespace && rejection.namespace !== DEFAULT_NAMESPACE
    ? ` [namespace: ${rejection.namespace}]` : '';
  const lines = [
    `🚫 SSG 协议拦截: ${rejection.blocked}${nsLabel}`,
    ``,
    `  当前状态: ${rejection.currentState.join(', ') || '(无)'}`,
    `  所需状态: ${rejection.requiredState.join(', ')}`,
    ``,
  ];
  if (rejection.missingFunctions.length > 0) {
    lines.push(`  缺失步骤: ${rejection.missingFunctions.join(' → ')}`);
  }
  if (rejection.fixPath.length > 0) {
    lines.push(`  修复路径: ${rejection.fixPath.join(' → ')}`);
  }
  return lines.join('\n');
}

/** Format an SSG rejection as a structured JSON object. */
export function rejectionToJSON(rejection: SSGRejection): object {
  return {
    protocol_violation: {
      blocked_function: rejection.blocked,
      namespace: rejection.namespace,
      current_state: rejection.currentState,
      required_pre_states: rejection.requiredState,
    },
    diagnosis: {
      missing_functions: rejection.missingFunctions,
      fix_path: rejection.fixPath,
    },
  };
}


// ═══════════════════════════════════════════════════════════════
// parseProtocolsFromJSON (unchanged)
// ═══════════════════════════════════════════════════════════════

export function parseProtocolsFromJSON(
  protocolDef: {
    rules: Record<string, {
      pre_states: string[];
      post_states: string[];
      invalidate?: string[];
      namespace?: string;
      aliases?: string[];
      /** Oracle 隔离政策（docs/ORACLE_ISOLATION_POLICY.md）：人工确认门。
       *  缺失 = 存量祖父（视为 confirmed）；proposed = 提案不参与判定 */
      status?: string;
    }>;
  }
): FunctionProtocol[] {
  const protocols: FunctionProtocol[] = [];
  for (const [funcName, rule] of Object.entries(protocolDef.rules)) {
    // 未人工确认的提案规则不加载——AI 只提案，人不签字不生效
    if (rule.status && rule.status !== "confirmed") continue;
    protocols.push({
      function: funcName,
      protocol: {
        pre_states: rule.pre_states,
        post_states: rule.post_states,
        invalidate: rule.invalidate,
        namespace: rule.namespace,
        aliases: rule.aliases,
      },
    });
  }
  return protocols;
}
