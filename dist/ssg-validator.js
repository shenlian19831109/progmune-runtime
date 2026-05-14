"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StateMachineValidator = void 0;
class StateMachineValidator {
    constructor(rules, initialState = 'INIT') {
        this.currentStates = new Set([initialState]);
        this.rules = new Map();
        rules.forEach(r => this.rules.set(r.function, r.protocol));
    }
    apply(functionName) {
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
    getCurrentStates() {
        return [...this.currentStates];
    }
}
exports.StateMachineValidator = StateMachineValidator;
