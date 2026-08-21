/**
 * Phase 12: Agent Loop Controller (P1)
 *
 * Progmune Agent 最小闭环 —— 免疫门在环内的自主实现循环。
 *
 * Loop:
 *   intent → 目标分解(GoalPlanner) → execute()（plan→8门验证→SSG修复→emit→写盘+指纹）
 *         → verifyCompiles / verifyFileMarker（写盘后验证门）
 *         → 失败反馈注入 → 重试(≤maxRetries) → 迭代(≤maxIterations)
 *         → 成功输出带指纹 diff + 完整审计轨迹
 *
 * 铁律（Agent 化设计文档 v1.1）：
 *   1. 验证门必须在环内 —— 写盘前已过 plan/emit 内验证，写盘后再过编译+指纹门；
 *   2. 违规优先确定性修复（execute 内 SSG 修复），其次 LLM 重试，最后明确降级；
 *   3. 失败反馈必须注入下一次尝试 —— 不静默重试同一输入。
 *
 * 设计文档里程碑 M1 验收：
 *   progmune agent "实现 XX" → 全程过验证门 → 编译通过 → 输出带指纹 diff；
 *   失败注入重试 ≤3；审计轨迹完整。
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { execute, verifyCompiles, verifyFileMarker } from "./execute";
import type { ExecuteResult } from "./execute";
import { expandGoalActions } from "./goal-planner";
import { collectGitContext, extractIRWithDelta } from "./agent-perception";
import type { GitContext, IRDelta } from "./agent-perception";
import { runProjectTests } from "./agent-supervision";
import { decidePermission, interactiveConfirm } from "./agent-permissions";

// ── Types ──

/** 单次尝试记录 —— 审计轨迹的基本单元 */
export interface LoopAttempt {
  /** 第几次尝试（跨迭代累计，重试也计数） */
  attempt: number;
  /** 当前迭代轮次（1-based） */
  iteration: number;
  /** 本次尝试使用的意图（含失败反馈注入） */
  intent: string;
  /** 注入的失败反馈（首次尝试为空） */
  feedback?: string;
  startedAt: string;
  success: boolean;
  degraded: boolean;
  sessionId: string;
  filePath?: string;
  /** 代码内容指纹（SHA256 前 16 位） */
  fingerprint: string;
  ruleHash: string;
  irFunctionCount: number;
  violations: number;
  repairApplied: boolean;
  repairCount: number;
  /** 写盘后验证门 1：编译通过 */
  compilePass: boolean;
  /** 写盘后验证门 2：@progmune-generated 指纹标记存在 */
  markerPass: boolean;
  /** P3 测试门：是否运行了项目测试 */
  testRan?: boolean;
  /** P3 测试门：测试是否通过（未运行时为 true） */
  testPass?: boolean;
  error?: string;
}

/** 审计事件（时间序） */
export interface AuditEvent {
  timestamp: string;
  event: string;
  detail: string;
}

export interface AgentLoopOptions {
  projectPath: string;
  intent: string;
  /** 输出文件（相对 projectPath 或绝对路径）。缺省时 execute 不写盘，仅产码 */
  filePath?: string;
  /** 最大迭代轮数（默认 5） */
  maxIterations?: number;
  /** 每轮最大重试次数（默认 3，M1 要求 ≤3） */
  maxRetries?: number;
  /** 单次 execute 超时（毫秒，默认 120000） */
  timeoutMs?: number;
  /** P2: 首次尝试注入 git 仓库上下文（默认 false，CLI 默认开启） */
  includeContext?: boolean;
  /** P3: 编译/指纹通过后追加项目测试门（默认 false，CLI --test 开启） */
  runTests?: boolean;
  /** P5: 测试门（shell 执行）审批预批准（CLI --yes）；缺省时交互确认，无 TTY 则拒绝 */
  approveExec?: boolean;
}

export interface AgentLoopResult {
  success: boolean;
  attempts: LoopAttempt[];
  /** 实际迭代轮数 */
  iterations: number;
  /** 成功前（或耗尽前）的失败尝试数 */
  retries: number;
  /** 目标分解出的子目标动作（GoalPlanner 输出，无模板命中时为空） */
  subgoals: string[];
  filePath?: string;
  fingerprint: string;
  /** git diff（新文件/无 git 时回退为摘要） */
  diff: string;
  /** 完整审计轨迹（时间序） */
  auditTrail: AuditEvent[];
  /** 降级标记：任一尝试使用了规则回退（LLM 生成被耗尽） */
  degraded: boolean;
  /** P2: 成功时的 IR 增量（+新增 / -消失） */
  irDelta?: IRDelta;
  /** P2: 感知到的 git 仓库上下文（未开启 includeContext 时为 undefined） */
  gitContext?: GitContext;
}

// ── Helpers ──

/** 单次执行超时包装。超时后底层 promise 继续运行（P1 已知限制，文档化即可）。 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/** 构造失败的 ExecuteResult（execute 抛异常时的兜底） */
function failedExecuteResult(error: string): ExecuteResult {
  return {
    success: false,
    code: "",
    sessionId: "",
    hash: "",
    ruleHash: "",
    irFunctionCount: 0,
    protocolRuleCount: 0,
    violations: 0,
    degraded: false,
    repairApplied: false,
    repairCount: 0,
    repairBranchIds: [],
    error,
  };
}

/** 计算目标文件的 git diff；新文件/非 git 仓库时回退为摘要。 */
export function computeDiff(projectPath: string, filePath: string): string {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(projectPath, filePath);
  try {
    const out = execSync(`git -C "${projectPath}" diff -- "${abs}"`, {
      encoding: "utf-8",
      timeout: 10000,
      stdio: "pipe",
    }).trim();
    if (out) return out;
    const status = execSync(`git -C "${projectPath}" status --porcelain -- "${abs}"`, {
      encoding: "utf-8",
      timeout: 10000,
      stdio: "pipe",
    }).trim();
    if (status) return `(新文件，未跟踪)\n${status}`;
    return "(无 git 变更)";
  } catch (e: any) {
    // 非 git 仓库或文件不存在 → 回退为文件内容摘要
    try {
      const content = fs.readFileSync(abs, "utf-8");
      return `(git diff 不可用: ${e.message})\n${content.slice(0, 500)}`;
    } catch {
      return `(git diff 不可用: ${e.message})`;
    }
  }
}

// ── Main Loop ──

/**
 * 运行 P1 最小 agent loop。
 *
 * @requires INTENT @produces AGENT_LOOP_RESULT
 */
export async function runAgentLoop(opts: AgentLoopOptions): Promise<AgentLoopResult> {
  const projectPath = path.resolve(opts.projectPath);
  const maxIterations = opts.maxIterations ?? 5;
  const maxRetries = opts.maxRetries ?? 3;
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const includeContext = opts.includeContext ?? false;
  const runTestsGate = opts.runTests ?? false;

  const attempts: LoopAttempt[] = [];
  const auditTrail: AuditEvent[] = [];
  const audit = (event: string, detail: string) =>
    auditTrail.push({ timestamp: new Date().toISOString(), event, detail });

  audit("loop:start",
    `intent="${opts.intent}" project=${projectPath} file=${opts.filePath || "(未指定)"} ` +
    `maxIterations=${maxIterations} maxRetries=${maxRetries} timeoutMs=${timeoutMs} ` +
    `context=${includeContext} tests=${runTestsGate}`);

  // ── P2 感知：git 上下文（best-effort） ──
  let gitContext: GitContext | undefined;
  let contextHint = "";
  if (includeContext) {
    gitContext = collectGitContext(projectPath);
    audit("perception:git", gitContext.available
      ? `branch=${gitContext.branch} commits=${gitContext.recentCommits.length} ` +
        `changed=${gitContext.changedFiles.length} files=${gitContext.sourceFiles.length}`
      : `不可用: ${gitContext.error}`);
    if (gitContext.available) {
      contextHint =
        `\n[项目上下文：分支 ${gitContext.branch}；` +
        `最近提交: ${gitContext.recentCommits.slice(0, 2).join(" / ") || "(无)"}；` +
        `变更文件: ${gitContext.changedFiles.slice(0, 5).join(", ") || "(无)"}]`;
    }
  }

  // ── P2 感知：初始 IR 函数名集合（成功时算增量） ──
  let prevIRNames: Set<string> | undefined;
  try {
    const { ir } = extractIRWithDelta(projectPath);
    prevIRNames = new Set(ir.map((f: any) => String(f.name || "")).filter(Boolean));
    audit("perception:ir", `初始 IR ${prevIRNames.size} 个函数`);
  } catch (e: any) {
    audit("perception:ir", `初始 IR 提取失败（忽略）: ${e.message}`);
  }

  // ── 目标分解（best-effort，不阻塞主循环） ──
  let subgoals: string[] = [];
  try {
    subgoals = expandGoalActions(opts.intent);
    audit("goal:decompose",
      subgoals.length > 0 ? `子目标: ${subgoals.join(" → ")}` : "无模板命中，单目标直行");
  } catch (e: any) {
    audit("goal:decompose", `目标分解失败（忽略）: ${e.message}`);
  }

  let attemptNo = 0;
  const baseIntent = `${opts.intent}${contextHint}`;
  let currentIntent = baseIntent;

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    audit("iteration:start", `第 ${iteration}/${maxIterations} 轮`);

    for (let retry = 0; retry < maxRetries; retry++) {
      attemptNo++;
      const startedAt = new Date().toISOString();
      audit("attempt:start", `#${attemptNo} (iter ${iteration}, retry ${retry}) intent="${currentIntent.slice(0, 120)}"`);

      // ── 执行（内部含 plan → 8 门验证 → SSG 修复 → emit → 写盘+指纹） ──
      let result: ExecuteResult;
      try {
        result = await withTimeout(
          execute(currentIntent, projectPath, opts.filePath),
          timeoutMs,
          `execute #${attemptNo}`,
        );
      } catch (e: any) {
        result = failedExecuteResult(`execute 抛出异常: ${e.message}`);
      }

      // ── 写盘后验证门（编译 + 指纹标记） ──
      let compilePass = false;
      let markerPass = false;
      let filePath: string | undefined = opts.filePath || result.filePath;
      if (result.success && filePath) {
        const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(projectPath, filePath);
        try {
          const compile = verifyCompiles(resolved);
          compilePass = compile.pass;
          const marker = verifyFileMarker(resolved);
          markerPass = marker.marked;
        } catch (e: any) {
          audit("verify:error", `写盘后验证门异常: ${e.message}`);
        }
      } else if (result.success) {
        // 产码模式（未指定输出文件）：编译门不适用；指纹门改为检查代码头部标记
        compilePass = true;
        markerPass = result.code.includes("@progmune-generated");
      }

      // ── P3 自监督：项目测试门（可选，编译/指纹通过后才跑） ──
      let testRan = false;
      let testPass = true;
      let testFailureSummary = "";
      if (result.success && compilePass && markerPass && runTestsGate && filePath) {
        // ── P5 安全层：跑测试 = shell 执行 → 审批门 ──
        const execDecision = decidePermission(
          "agent",
          { level: "exec", target: "项目测试（npm test / pytest）", projectPath, preApproved: opts.approveExec },
          interactiveConfirm,
        );
        audit(execDecision.audit.event, execDecision.audit.detail);
        if (!execDecision.allowed) {
          audit("verify:test", "测试门被审批门拒绝，跳过（--yes 可预批准）");
        } else {
          try {
            const t = runProjectTests(projectPath);
            testRan = t.ran;
            testPass = t.pass;
            if (t.ran) {
              audit("verify:test",
                t.pass ? `测试通过 (${t.command})` : `测试失败: ${t.failures.slice(0, 3).join(" | ")}`);
              if (!t.pass) testFailureSummary = `项目测试失败: ${t.failures.slice(0, 3).join("；")}`;
            }
          } catch (e: any) {
            audit("verify:test", `测试门异常（忽略）: ${e.message}`);
          }
        }
      }

      const attempt: LoopAttempt = {
        attempt: attemptNo,
        iteration,
        intent: currentIntent,
        feedback: attemptNo > 1 ? currentIntent.slice(opts.intent.length) || undefined : undefined,
        startedAt,
        success: result.success && compilePass && markerPass && (!testRan || testPass),
        degraded: result.degraded || false,
        sessionId: result.sessionId || "",
        filePath,
        fingerprint: result.hash || "",
        ruleHash: result.ruleHash || "",
        irFunctionCount: result.irFunctionCount,
        violations: result.violations,
        repairApplied: result.repairApplied,
        repairCount: result.repairCount,
        compilePass,
        markerPass,
        testRan,
        testPass,
        error: result.error,
      };
      attempts.push(attempt);

      // ── 成功出口 ──
      if (attempt.success) {
        const diff = filePath ? computeDiff(projectPath, filePath) : "(未指定输出文件，无 diff)";
        audit("attempt:ok",
          `#${attemptNo} 验证门全通过: sessionId=${result.sessionId} fingerprint=${result.hash} ` +
          `compile=${compilePass} marker=${markerPass} test=${testRan ? testPass : "(未跑)"} ` +
          `repairApplied=${result.repairApplied}`);
        audit("loop:success", `fingerprint=${result.hash} 迭代=${iteration} 重试=${attemptNo - 1}`);

        // ── P2 感知：成功时 IR 增量（agent 写盘后 IR 变化观测） ──
        let irDelta: IRDelta | undefined;
        try {
          const { delta } = extractIRWithDelta(projectPath, prevIRNames);
          irDelta = delta;
          audit("perception:ir",
            `IR 增量: +${delta.added.length} -${delta.removed.length} (共 ${delta.functionCount} 函数)` +
            (delta.added.length > 0 ? ` 新增: ${delta.added.join(", ")}` : ""));
        } catch (e: any) {
          audit("perception:ir", `成功时 IR 增量提取失败（忽略）: ${e.message}`);
        }

        return {
          success: true,
          attempts,
          iterations: iteration,
          retries: attemptNo - 1,
          subgoals,
          filePath,
          fingerprint: result.hash,
          diff,
          auditTrail,
          degraded: result.degraded || false,
          irDelta,
          gitContext,
        };
      }

      // ── 失败反馈注入（不静默重试同一输入） ──
      const reasons: string[] = [];
      if (!result.success) reasons.push(result.error || "执行失败");
      if (result.success && !compilePass) reasons.push("编译验证未通过");
      if (result.success && !markerPass) reasons.push("指纹标记缺失");
      if (testFailureSummary) reasons.push(testFailureSummary);
      const feedback = reasons.join("；");
      audit("attempt:fail", `#${attemptNo} ${feedback || "未知原因"}`);

      if (retry < maxRetries - 1) {
        currentIntent = `${baseIntent}\n[上一次尝试失败：${feedback}。请修复后重新实现。]`;
        audit("retry", `注入反馈后重试 #${retry + 2}/${maxRetries}`);
      } else {
        currentIntent = baseIntent; // 进入下一迭代前复位意图
      }
    }

    audit("iteration:end", `第 ${iteration} 轮耗尽 ${maxRetries} 次重试`);
  }

  audit("loop:exhausted", `迭代上限 ${maxIterations} 轮后仍未成功，共 ${attemptNo} 次尝试`);
  return {
    success: false,
    attempts,
    iterations: maxIterations,
    retries: attemptNo,
    subgoals,
    fingerprint: "",
    diff: "",
    auditTrail,
    degraded: attempts.some((a) => a.degraded),
    gitContext,
  };
}
