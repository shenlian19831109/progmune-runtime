export interface StateAnnotation {
  pre_states: string[];
  post_states: string[];
  invalidate?: string[];
}

export interface FunctionProtocol {
  function: string;
  protocol: StateAnnotation;
}

export class StateMachineValidator {
  private currentStates: Set<string>;
  private readonly rules: Map<string, StateAnnotation>;

  constructor(rules: FunctionProtocol[], initialState: string = 'INIT') {
    this.currentStates = new Set<string>([initialState]);
    this.rules = new Map();
    rules.forEach(r => this.rules.set(r.function, r.protocol));
  }

  apply(functionName: string): { valid: boolean; error?: string; statesAfter?: string[] } {
    const rule = this.rules.get(functionName);
    if (!rule) {
      return { valid: true, statesAfter: [...this.currentStates] };
    }

    const hasValidPreState = rule.pre_states.some(s => this.currentStates.has(s));
    if (!hasValidPreState) {
      return {
        valid: false,
        error: `非法调用：${functionName} 要求前置状态 [${rule.pre_states}]，当前状态为 [${[...this.currentStates]}]`
      };
    }

    if (rule.invalidate) {
      rule.invalidate.forEach(s => this.currentStates.delete(s));
    }
    rule.post_states.forEach(s => this.currentStates.add(s));

    return { valid: true, statesAfter: [...this.currentStates] };
  }

  getCurrentStates(): string[] {
    return [...this.currentStates];
  }
}
