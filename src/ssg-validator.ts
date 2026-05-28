export interface StateAnnotation {
  pre_states: string[];
  post_states: string[];
  invalidate?: string[];
  /** 命名空间：auth, file, db, socket 等。未指定则为全局默认空间 "_global" */
  namespace?: string;
}

export interface FunctionProtocol {
  function: string;
  protocol: StateAnnotation;
}

/** 结构化 SSG 拦截结果 */
export interface SSGRejection {
  blocked: string;
  currentState: string[];
  requiredState: string[];
  missingFunctions: string[];
  fixPath: string[];
  /** 违规所在的命名空间 */
  namespace: string;
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

const DEFAULT_NAMESPACE = "_global";

export class StateMachineValidator {
  /** 每个命名空间独立的状态集合 */
  private namespaceStates: Map<string, Set<string>>;
  private readonly rules: Map<string, StateAnnotation>;
  private trace: SSGTraceNode[] = [];

  constructor(rules: FunctionProtocol[], initialState: string = 'INIT') {
    this.namespaceStates = new Map();
    // 默认命名空间初始化
    this.namespaceStates.set(DEFAULT_NAMESPACE, new Set<string>([initialState]));
    this.rules = new Map();
    rules.forEach(r => {
      this.rules.set(r.function, r.protocol);
      // 为每个引用的命名空间预初始化状态
      const ns = r.protocol.namespace || DEFAULT_NAMESPACE;
      if (!this.namespaceStates.has(ns)) {
        this.namespaceStates.set(ns, new Set<string>());
      }
    });
  }

  /** 为指定命名空间设置初始状态（用于协议定义中的 initialState） */
  setNamespaceInitialState(namespace: string, state: string): void {
    const ns = namespace || DEFAULT_NAMESPACE;
    if (!this.namespaceStates.has(ns)) {
      this.namespaceStates.set(ns, new Set<string>());
    }
    this.namespaceStates.get(ns)!.add(state);
  }

  apply(functionName: string): SSGStepResult {
    const statesBefore = [...this.getEffectiveStates()];
    const rule = this.rules.get(functionName);

    if (!rule) {
      this.trace.push({ function: functionName, valid: true, statesBefore, statesAfter: [...this.getEffectiveStates()] });
      return { valid: true, statesAfter: [...this.getEffectiveStates()] };
    }

    const ns = rule.namespace || DEFAULT_NAMESPACE;
    const nsStates = this.namespaceStates.get(ns) || new Set<string>();

    const hasValidPreState = rule.pre_states.every(s => nsStates.has(s));

    if (!hasValidPreState) {
      const fixPath = this.findFixPath(ns, [...nsStates], rule.pre_states);
      const missingFunctions = this.findMissingFunctions(ns, [...nsStates], rule.pre_states);

      const rejection: SSGRejection = {
        blocked: functionName,
        currentState: [...nsStates],
        requiredState: rule.pre_states,
        missingFunctions,
        fixPath,
        namespace: ns,
      };

      this.trace.push({ function: functionName, valid: false, statesBefore, statesAfter: [...this.getEffectiveStates()], rejection });
      return { valid: false, statesAfter: [...this.getEffectiveStates()], rejection };
    }

    if (rule.invalidate) {
      rule.invalidate.forEach(s => nsStates.delete(s));
    }
    rule.post_states.forEach(s => nsStates.add(s));
    this.namespaceStates.set(ns, nsStates);

    const statesAfter = [...this.getEffectiveStates()];
    this.trace.push({ function: functionName, valid: true, statesBefore, statesAfter });
    return { valid: true, statesAfter };
  }

  getCurrentStates(): string[] {
    return [...this.getEffectiveStates()];
  }

  /** 获取所有命名空间的合并状态视图 */
  private getEffectiveStates(): Set<string> {
    const all = new Set<string>();
    for (const states of this.namespaceStates.values()) {
      for (const s of states) {
        all.add(s);
      }
    }
    return all;
  }

  /** 获取指定命名空间的当前状态 */
  getNamespaceStates(namespace: string): string[] {
    const ns = namespace || DEFAULT_NAMESPACE;
    return [...(this.namespaceStates.get(ns) || new Set<string>())];
  }

  /** 返回完整跟踪记录 */
  getTrace(): SSGTraceNode[] {
    return [...this.trace];
  }

  /** 生成人类可读的拦截解释 */
  static explainRejection(rejection: SSGRejection): string {
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

  /** 生成结构化 JSON 格式的错误报告 */
  static rejectionToJSON(rejection: SSGRejection): object {
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

  /** 在指定命名空间中查找缺失函数 */
  private findMissingFunctions(namespace: string, current: string[], targetPreStates: string[]): string[] {
    const missing: string[] = [];
    for (const target of targetPreStates) {
      if (current.includes(target)) continue;
      for (const [fn, rule] of this.rules) {
        const ns = rule.namespace || DEFAULT_NAMESPACE;
        if (ns !== namespace) continue;
        if (rule.post_states.includes(target)) {
          missing.push(fn);
          break;
        }
      }
    }
    return missing;
  }

  /** 在指定命名空间中查找修复路径 */
  private findFixPath(namespace: string, current: string[], targetPreStates: string[]): string[] {
    const path: string[] = [];
    const currentSet = new Set(current);

    for (const target of targetPreStates) {
      if (currentSet.has(target)) continue;
      for (const [fn, rule] of this.rules) {
        const ns = rule.namespace || DEFAULT_NAMESPACE;
        if (ns !== namespace) continue;
        if (rule.post_states.includes(target)) {
          if (rule.pre_states.every(p => currentSet.has(p))) {
            path.push(fn);
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

/** 从 protocols.json 结构构建 FunctionProtocol 数组 */
export function parseProtocolsFromJSON(
  protocolDef: {
    rules: Record<string, {
      pre_states: string[];
      post_states: string[];
      invalidate?: string[];
      namespace?: string;
    }>;
  }
): FunctionProtocol[] {
  const protocols: FunctionProtocol[] = [];
  for (const [funcName, rule] of Object.entries(protocolDef.rules)) {
    protocols.push({
      function: funcName,
      protocol: {
        pre_states: rule.pre_states,
        post_states: rule.post_states,
        invalidate: rule.invalidate,
        namespace: rule.namespace,
      },
    });
  }
  return protocols;
}
