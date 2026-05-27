export interface StateAnnotation {
  pre_states: string[];
  post_states: string[];
  invalidate?: string[];
}

export interface FunctionProtocol {
  function: string;
  protocol: StateAnnotation;
}

/** 结构化 SSG 拦截结果 */
export interface SSGRejection {
  blocked: string;           // 被拦截的函数名
  currentState: string[];    // 当前状态
  requiredState: string[];   // 所需前置状态
  missingFunctions: string[];// 缺少哪些函数调用
  fixPath: string[];         // 修复路径：依次调用这些函数可达目标状态
}

/** 单次 apply 的结构化结果 */
export interface SSGStepResult {
  valid: boolean;
  statesAfter: string[];
  rejection?: SSGRejection;
}

/** 完整跟踪节点 */
export interface SSGTraceNode {
  function: string;
  valid: boolean;
  statesBefore: string[];
  statesAfter: string[];
  rejection?: SSGRejection;
}

export class StateMachineValidator {
  private currentStates: Set<string>;
  private readonly rules: Map<string, StateAnnotation>;
  private trace: SSGTraceNode[] = [];

  constructor(rules: FunctionProtocol[], initialState: string = 'INIT') {
    this.currentStates = new Set<string>([initialState]);
    this.rules = new Map();
    rules.forEach(r => this.rules.set(r.function, r.protocol));
  }

  apply(functionName: string): SSGStepResult {
    const statesBefore = [...this.currentStates];
    const rule = this.rules.get(functionName);

    if (!rule) {
      // 无协议约束 → 直接放行
      this.trace.push({ function: functionName, valid: true, statesBefore, statesAfter: [...this.currentStates] });
      return { valid: true, statesAfter: [...this.currentStates] };
    }

    const hasValidPreState = rule.pre_states.every(s => this.currentStates.has(s));

    if (!hasValidPreState) {
      const fixPath = this.findFixPath([...this.currentStates], rule.pre_states);
      const missingFunctions = this.findMissingFunctions([...this.currentStates], rule.pre_states);

      const rejection: SSGRejection = {
        blocked: functionName,
        currentState: [...this.currentStates],
        requiredState: rule.pre_states,
        missingFunctions,
        fixPath,
      };

      this.trace.push({ function: functionName, valid: false, statesBefore, statesAfter: [...this.currentStates], rejection });
      return { valid: false, statesAfter: [...this.currentStates], rejection };
    }

    if (rule.invalidate) {
      rule.invalidate.forEach(s => this.currentStates.delete(s));
    }
    rule.post_states.forEach(s => this.currentStates.add(s));

    const statesAfter = [...this.currentStates];
    this.trace.push({ function: functionName, valid: true, statesBefore, statesAfter });
    return { valid: true, statesAfter };
  }

  getCurrentStates(): string[] {
    return [...this.currentStates];
  }

  /** 返回完整跟踪记录 */
  getTrace(): SSGTraceNode[] {
    return [...this.trace];
  }

  /** 生成人类可读的拦截解释 */
  static explainRejection(rejection: SSGRejection): string {
    const lines = [
      `🚫 SSG 协议拦截: ${rejection.blocked}`,
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

  /** 生成结构化 JSON 格式的错误报告 */
  static rejectionToJSON(rejection: SSGRejection): object {
    return {
      protocol_violation: {
        blocked_function: rejection.blocked,
        current_state: rejection.currentState,
        required_pre_states: rejection.requiredState,
      },
      diagnosis: {
        missing_functions: rejection.missingFunctions,
        fix_path: rejection.fixPath,
      },
    };
  }

  /** 查找从当前状态到目标前置状态的缺失函数名 */
  private findMissingFunctions(current: string[], targetPreStates: string[]): string[] {
    const missing: string[] = [];
    for (const target of targetPreStates) {
      if (current.includes(target)) continue;
      for (const [fn, rule] of this.rules) {
        if (rule.post_states.includes(target)) {
          missing.push(fn);
          break;
        }
      }
    }
    return missing;
  }

  /** 查找修复路径：要调用哪些函数才能达到目标状态 */
  private findFixPath(current: string[], targetPreStates: string[]): string[] {
    const path: string[] = [];
    const currentSet = new Set(current);

    for (const target of targetPreStates) {
      if (currentSet.has(target)) continue;
      // 找到能产生目标状态的函数
      for (const [fn, rule] of this.rules) {
        if (rule.post_states.includes(target)) {
          // 检查该函数的前置条件是否满足
          if (rule.pre_states.every(p => currentSet.has(p))) {
            path.push(fn);
            // 模拟执行
            if (rule.invalidate) rule.invalidate.forEach(s => currentSet.delete(s));
            rule.post_states.forEach(s => currentSet.add(s));
            break;
          }
        }
      }
    }
    return path;
  }
}
