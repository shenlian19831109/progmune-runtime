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
        const hasValidPreState = rule.pre_states.every(s => this.currentStates.has(s));
        if (!hasValidPreState) {
            const missingSteps = this.findMissingSteps([...this.currentStates], rule.pre_states);
            const hint = missingSteps.length > 0
                ? `\n  缺失步骤：${missingSteps.join(' → ')}`
                : '';
            return {
                valid: false,
                error: `[PROGMUNE] L4 协议违规：${functionName}\n  当前状态：${[...this.currentStates].join(', ')}\n  期望前置状态：${rule.pre_states.join(', ')}${hint}`
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
    /** 查找从当前状态到目标前置状态的缺失步骤 */
    findMissingSteps(current, targetPreStates) {
        const steps = [];
        for (const target of targetPreStates) {
            if (current.includes(target))
                continue;
            // 查找哪个函数的 post_states 能达到目标状态
            for (const [fn, rule] of this.rules) {
                if (rule.post_states.includes(target) && !rule.pre_states.some(p => !current.includes(p))) {
                    steps.push(fn);
                    for (const s of rule.post_states) {
                        if (!current.includes(s)) {
                            steps.push(s);
                            current.push(s);
                        }
                    }
                    break;
                }
            }
        }
        return steps;
    }
}
exports.StateMachineValidator = StateMachineValidator;
