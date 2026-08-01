/**
 * Phase 3: ViolationTrace — Structured Reasoning Chain
 *
 * Replaces string-concatenated violation messages with first-class
 * ViolationTrace objects. Each trace captures the step-by-step protocol
 * state transition that led to the violation, making it possible for
 * an engineer who hasn't read protocols.json to understand the causal
 * chain in under 2 minutes.
 *
 * Design principle: trace length → understanding time should be LINEAR,
 * not exponential. This solves the "reasoning step disaster" where hidden
 * intermediate states cause comprehension difficulty to explode.
 */

import type { TrustViolation } from "./types";

// ── Core Types ──

/**
 * A single step in a violation reasoning chain.
 *
 * Each step records: what happened, what was the state, what was expected,
 * what actually occurred, and where to find the relevant protocol rule.
 */
export interface ViolationTraceStep {
  /** 1-based step index in the trace chain */
  step: number;

  /** Human-readable label for this step (e.g., "TLS Handshake Init") */
  label: string;

  /** The function call that triggered this step */
  action: string;

  /** Protocol state BEFORE this action */
  preState: string;

  /** Protocol state the system SHOULD transition to */
  expectedPostState: string | null;

  /** Protocol state the system ACTUALLY transitioned to */
  actualPostState: string | null;

  /** Is this the step where the violation occurred? */
  isViolationPoint: boolean;

  /** RFC or protocol rule reference */
  ruleRef: string;

  /** Human-readable explanation of what happened at this step */
  explanation: string;
}

/**
 * A complete violation trace: the reasoning chain from initial call
 * through the violation point to the expected fix.
 */
export interface ViolationTrace {
  /** The violation this trace explains */
  violation: Pick<TrustViolation, "rule_id" | "file" | "function" | "message">;

  /** Ordered chain of reasoning steps */
  steps: ViolationTraceStep[];

  /** Index of the step where the violation occurred */
  violationStepIndex: number;

  /** What the system should have done instead */
  expectedBehavior: string;

  /** Concrete fix: what function calls or state transitions are needed */
  fixPath: string[];

  /** RFC or protocol rules referenced */
  references: string[];

  /** Estimated reading time in minutes (for S3.2 validation) */
  estimatedReadingTimeMinutes: number;
}

// ── Trace Builder ──

/**
 * Build a violation trace from a trust violation and its protocol context.
 *
 * The trace is a chain of protocol state transitions showing:
 *   1. The sequence of function calls leading up to the violation
 *   2. The expected protocol state at each step
 *   3. The actual state at each step
 *   4. The exact point where expectation and reality diverged
 *   5. The fix: what should have been called instead
 *
 * @param violation - The violation to trace
 * @param protocolStates - Optional ordered list of protocol states observed
 * @param functionCalls - Optional ordered list of function calls (from IR)
 * @returns A structured ViolationTrace
 */
export function buildViolationTrace(
  violation: TrustViolation,
  protocolStates?: string[],
  functionCalls?: string[]
): ViolationTrace {
  const steps: ViolationTraceStep[] = [];
  const references: string[] = [];

  // Extract RFC/protocol reference
  if (violation.policy_ref) {
    references.push(violation.policy_ref);
  }

  // ── Build the reasoning chain ──

  if (protocolStates && protocolStates.length > 0 && functionCalls && functionCalls.length > 0) {
    // Full trace: we have the actual state machine walk
    buildFullTrace(steps, protocolStates, functionCalls, violation);
  } else {
    // Minimal trace: reconstruct from violation fields alone
    buildMinimalTrace(steps, violation);
  }

  // Calculate violation point
  const violationIdx = steps.findIndex(s => s.isViolationPoint);
  const actualIdx = violationIdx >= 0 ? violationIdx : steps.length - 1;

  // Build expected behavior description
  const expectedBehavior = buildExpectedBehavior(steps, violation);

  // Build fix path
  const fixPath = violation.fix
    ? violation.fix.split(/[;,]\s*/).filter(Boolean)
    : ["Add missing protocol safeguard call"];

  // Estimate reading time: ~15 seconds per step (empirical)
  const estimatedReadingTimeMinutes = Math.max(1, Math.ceil(steps.length * 0.25));

  return {
    violation: {
      rule_id: violation.rule_id,
      file: violation.file,
      function: violation.function,
      message: violation.message,
    },
    steps,
    violationStepIndex: actualIdx,
    expectedBehavior,
    fixPath,
    references,
    estimatedReadingTimeMinutes,
  };
}

// ── Full Trace (when we have state machine data) ──

function buildFullTrace(
  steps: ViolationTraceStep[],
  states: string[],
  calls: string[],
  violation: TrustViolation
): void {
  for (let i = 0; i < Math.min(calls.length, states.length); i++) {
    const call = calls[i];
    const currentState = i > 0 ? states[i - 1] : "INITIAL";
    const actualNextState = i < states.length ? states[i] : "UNKNOWN";

    // Determine expected state transition
    const expected = inferExpectedState(currentState, call);

    // Violation: expected transition exists but actual state doesn't match
    // OR: call requires specific pre-state but we're not in it
    const isViolation = expected !== null && expected !== actualNextState &&
                        actualNextState !== "UNKNOWN" && actualNextState !== expected;

    const stepExplanation = isViolation
      ? `函数 ${call} 在状态 ${currentState} 下被调用。` +
        `预期协议状态应转为 ${expected}，但实际为 ${actualNextState}。` +
        `这违反了 ${violation.rule_id}。${violation.evidence || violation.why || ""}`
      : expected
        ? `函数 ${call} 将协议状态从 ${currentState} 正常转移到 ${expected}。`
        : `函数 ${call} 执行（无协议状态变更要求）。`;

    steps.push({
      step: i + 1,
      label: inferStepLabel(call, currentState),
      action: call,
      preState: currentState,
      expectedPostState: expected,
      actualPostState: isViolation ? actualNextState : (expected || actualNextState),
      isViolationPoint: isViolation,
      ruleRef: violation.rule_id,
      explanation: stepExplanation,
    });
  }
}

// ── Minimal Trace (reconstructed from violation fields) ──

function buildMinimalTrace(
  steps: ViolationTraceStep[],
  violation: TrustViolation
): void {
  // Parse the violation to reconstruct the reasoning chain
  const funcName = violation.function || "unknown_function";
  const fileName = violation.file || "unknown_file";

  // Step 1: The triggering action
  steps.push({
    step: 1,
    label: "违规触发点",
    action: funcName,
    preState: "EXPECTED_PROTOCOL_STATE",
    expectedPostState: "SAFE_STATE",
    actualPostState: "VIOLATION_STATE",
    isViolationPoint: true,
    ruleRef: violation.rule_id,
    explanation: `在 ${fileName} 中，函数 ${funcName} 的执行触发了违规检测。${violation.evidence || ""}`,
  });

  // Step 2: Why it's a violation
  steps.push({
    step: 2,
    label: "违规原因",
    action: "protocol_check",
    preState: "VIOLATION_STATE",
    expectedPostState: null,
    actualPostState: null,
    isViolationPoint: false,
    ruleRef: violation.rule_id,
    explanation: violation.why || violation.message || "协议规则匹配发现违规。",
  });

  // Step 3: The fix
  if (violation.fix) {
    steps.push({
      step: 3,
      label: "修复路径",
      action: violation.fix,
      preState: "VIOLATION_STATE",
      expectedPostState: "SAFE_STATE",
      actualPostState: null,
      isViolationPoint: false,
      ruleRef: violation.rule_id,
      explanation: `建议修复: ${violation.fix}`,
    });
  }
}

// ── State Inference Helpers ──

/** Infer expected protocol state transition from function name + current state */
function inferExpectedState(currentState: string, functionCall: string): string | null {
  const call = functionCall.toLowerCase();

  // Authentication chain
  if (currentState === "UNAUTHENTICATED") {
    if (/login|authenticate|signin|verify_password/.test(call)) return "AUTHENTICATED";
    if (/register|signup/.test(call)) return "USER_REGISTERED";
  }
  if (currentState === "AUTHENTICATED") {
    if (/authorize|check_owner|check_permission/.test(call)) return "AUTHORIZED";
    if (/logout|revoke/.test(call)) return "UNAUTHENTICATED";
  }
  if (currentState === "PASSWORD_RECEIVED" && /hash|crypt|bcrypt|argon/.test(call)) return "PASSWORD_HASHED";
  if (currentState === "PASSWORD_HASHED" && /verify|compare/.test(call)) return "PASSWORD_VERIFIED";
  if (currentState === "TOKEN_ISSUED" && /revoke|invalidate/.test(call)) return "UNAUTHENTICATED";

  // TLS chain
  if (currentState === "TLS_CONFIGURED") {
    if (/listen|bind|accept|start_server|create_server/.test(call)) return "SERVER_STARTED";
    if (/set_cipher|use_cert|load_cert/.test(call)) return "TLS_CONFIGURED"; // still configuring
  }

  // File upload chain
  if (currentState === "AUTHENTICATED" && /receive_upload|handle_upload/.test(call)) return "FILE_RECEIVED";
  if (currentState === "FILE_RECEIVED" && /validate_file|check_file|stat\b/.test(call)) return "FILE_VALIDATED";
  if (currentState === "FILE_VALIDATED" && /store_file|save_file|write_file/.test(call)) return "FILE_STORED";

  // Payment chain
  if (currentState === "ORDER_CREATED" && /initiate_payment/.test(call)) return "PAYMENT_INITIATED";
  if (currentState === "PAYMENT_INITIATED" && /receive_callback/.test(call)) return "PAYMENT_CALLBACK_RECEIVED";
  if (currentState === "PAYMENT_CALLBACK_RECEIVED") {
    if (/confirm/.test(call)) return "PAYMENT_CONFIRMED";
    if (/fail/.test(call)) return "PAYMENT_FAILED";
  }

  // Generic patterns (fallback)
  if (/init|create|new|start|setup|open/.test(call)) return "INITIALIZED";
  if (/connect|handshake/.test(call)) return "CONNECTED";
  if (/send|write|transfer|xfer/.test(call)) return "DATA_TRANSFERRED";
  if (/close|free|cleanup|shutdown|destroy|done/.test(call)) return "CLOSED";
  if (/validate|verify|check/.test(call)) return "VALIDATED";

  return null;
}

/** Generate a human-readable label for a trace step */
function inferStepLabel(functionCall: string, currentState: string): string {
  const call = functionCall.toLowerCase();

  // Auth
  if (/login|authenticate|signin|verify_password/.test(call)) return "用户认证";
  if (/register|signup/.test(call)) return "用户注册";
  if (/logout|revoke|invalidate/.test(call)) return "会话终止";
  if (/authorize|check_owner|check_permission/.test(call)) return "权限检查";
  if (/hash|crypt|bcrypt|argon/.test(call)) return "密码哈希";
  if (/verify_hash|compare_password/.test(call)) return "密码验证";

  // TLS
  if (/load_tls|ssl_init|tls_setup|configure_ssl|configure_tls/.test(call)) return "TLS 配置";
  if (/listen|bind|accept|start_server|create_server/.test(call)) return "服务器启动";
  if (/set_cipher|use_cert|load_cert/.test(call)) return "证书配置";

  // Network
  if (/connect|handshake/.test(call)) return "协议握手";
  if (/send|write|transfer|xfer/.test(call)) return "数据传输";
  if (/close|free|cleanup|shutdown|destroy|done/.test(call)) return "连接关闭";

  // File
  if (/receive_upload|handle_upload/.test(call)) return "文件接收";
  if (/validate_file|check_file/.test(call)) return "文件校验";
  if (/store_file|save_file|write_file/.test(call)) return "文件存储";

  // General
  if (/init|create|new|start|setup|open/.test(call)) return "资源初始化";
  if (/validate|verify|check/.test(call)) return "安全校验";
  if (/encrypt|cipher/.test(call)) return "数据加密";
  if (/decrypt/.test(call)) return "数据解密";
  if (/hash/.test(call)) return "哈希计算";

  return `状态转换: ${currentState}`;
}

/** Build a human-readable expected behavior description */
function buildExpectedBehavior(
  steps: ViolationTraceStep[],
  violation: TrustViolation
): string {
  const violStep = steps.find(s => s.isViolationPoint);
  if (!violStep) {
    return `应遵循协议规则 ${violation.rule_id}。修复建议: ${violation.fix || "添加缺失的协议安全调用"}`;
  }

  return `函数 ${violStep.action} 在状态 ${violStep.preState} 下被调用时，` +
    `应首先确保协议状态转换到 ${violStep.expectedPostState || "安全状态"}，` +
    `而非停留在 ${violStep.actualPostState || "违规状态"}。` +
    `这违反了 ${violation.rule_id}。`;
}

// ── Serialization ──

/**
 * Render a ViolationTrace as a human-readable text block.
 *
 * Format:
 *   代码第 X 行调用了 send()
 *   → 此时 TLS 状态是 HANDSHAKE_INCOMPLETE
 *   → 根据 RFC 8446 §4.2.2，此状态下不允许发送应用数据
 *   → 违规
 */
export function renderTraceAsText(trace: ViolationTrace): string {
  const lines: string[] = [];
  lines.push(`═══════ 违规推理链 ═══════`);
  lines.push(`文件: ${trace.violation.file}`);
  lines.push(`函数: ${trace.violation.function}`);
  lines.push(`规则: ${trace.violation.rule_id}`);
  lines.push("");

  for (const step of trace.steps) {
    const marker = step.isViolationPoint ? "❌" : "  ";
    lines.push(`${marker} [步骤 ${step.step}] ${step.label}`);
    lines.push(`   操作: ${step.action}`);
    lines.push(`   状态: ${step.preState}`);

    if (step.expectedPostState) {
      lines.push(`   预期: → ${step.expectedPostState}`);
    }
    if (step.actualPostState && step.isViolationPoint) {
      lines.push(`   实际: → ${step.actualPostState}  ← 违规发生`);
    }

    if (step.ruleRef) {
      lines.push(`   依据: ${step.ruleRef}`);
    }

    lines.push(`   说明: ${step.explanation}`);
    lines.push("");
  }

  lines.push(`预期行为: ${trace.expectedBehavior}`);
  lines.push(`修复路径: ${trace.fixPath.join(" → ")}`);

  if (trace.references.length > 0) {
    lines.push(`参考: ${trace.references.join(", ")}`);
  }

  lines.push("");
  lines.push(`估算阅读时间: ~${trace.estimatedReadingTimeMinutes} 分钟`);

  return lines.join("\n");
}

/**
 * Render a ViolationTrace as a compact single-line summary.
 */
export function renderTraceSummary(trace: ViolationTrace): string {
  const violStep = trace.steps[trace.violationStepIndex];
  if (!violStep) return trace.violation.message;
  return `${violStep.action} 在 ${violStep.preState} 状态下违反 ${trace.violation.rule_id}` +
    (trace.fixPath.length > 0 ? ` → 修复: ${trace.fixPath.join(" → ")}` : "");
}

// ── Batch Tracing ──

/**
 * Build traces for multiple violations.
 */
export function buildViolationTraces(
  violations: TrustViolation[]
): ViolationTrace[] {
  return violations.map(v => buildViolationTrace(v));
}
