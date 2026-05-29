"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StateMachineValidator = void 0;
exports.parseProtocolsFromJSON = parseProtocolsFromJSON;
const DEFAULT_NAMESPACE = "_global";
class StateMachineValidator {
    constructor(rules, initialState = 'INIT', namespaceInitialStates) {
        this.trace = [];
        this.namespaceStates = new Map();
        // 默认命名空间初始化
        this.namespaceStates.set(DEFAULT_NAMESPACE, new Set([initialState]));
        this.rules = new Map();
        rules.forEach(r => {
            this.rules.set(r.function, r.protocol);
            // 为每个引用的命名空间预初始化状态
            const ns = r.protocol.namespace || DEFAULT_NAMESPACE;
            if (!this.namespaceStates.has(ns)) {
                this.namespaceStates.set(ns, new Set());
            }
        });
        // 一次性设置所有命名空间初始状态，消除顺序依赖
        if (namespaceInitialStates) {
            for (const [ns, state] of namespaceInitialStates) {
                if (ns !== DEFAULT_NAMESPACE && state) {
                    if (!this.namespaceStates.has(ns)) {
                        this.namespaceStates.set(ns, new Set());
                    }
                    this.namespaceStates.get(ns).add(state);
                }
            }
        }
    }
    /** 为指定命名空间设置初始状态（用于协议定义中的 initialState） */
    setNamespaceInitialState(namespace, state) {
        const ns = namespace || DEFAULT_NAMESPACE;
        if (!this.namespaceStates.has(ns)) {
            this.namespaceStates.set(ns, new Set());
        }
        this.namespaceStates.get(ns).add(state);
    }
    apply(functionName, actionIndex) {
        const nsSnapBefore = this.snapshotNamespaceStates();
        const statesBefore = [...this.getEffectiveStates()];
        const rule = this.rules.get(functionName);
        if (!rule) {
            const node = { function: functionName, valid: true, statesBefore, statesAfter: [...this.getEffectiveStates()] };
            this.trace.push(node);
            return { valid: true, statesAfter: [...this.getEffectiveStates()] };
        }
        const ns = rule.namespace || DEFAULT_NAMESPACE;
        const nsStates = this.namespaceStates.get(ns) || new Set();
        const hasValidPreState = rule.pre_states.every(s => nsStates.has(s));
        if (!hasValidPreState) {
            const fixPath = this.findFixPath(ns, [...nsStates], rule.pre_states);
            const missingFunctions = this.findMissingFunctions(ns, [...nsStates], rule.pre_states);
            const rejection = {
                blocked: functionName,
                currentState: [...nsStates],
                requiredState: rule.pre_states,
                missingFunctions,
                fixPath,
                namespace: ns,
            };
            const node = {
                function: functionName, valid: false, statesBefore, statesAfter: [...this.getEffectiveStates()],
                nsStatesBefore: nsSnapBefore, nsStatesAfter: this.snapshotNamespaceStates(),
                namespace: ns, rejection,
            };
            this.trace.push(node);
            return {
                valid: false, statesAfter: [...this.getEffectiveStates()], rejection,
                nsStatesBefore: nsSnapBefore, nsStatesAfter: this.snapshotNamespaceStates(),
                namespace: ns,
            };
        }
        // 计算 acquire/invalidated delta
        const beforeNs = nsSnapBefore[ns] || [];
        if (rule.invalidate) {
            rule.invalidate.forEach(s => nsStates.delete(s));
        }
        rule.post_states.forEach(s => nsStates.add(s));
        this.namespaceStates.set(ns, nsStates);
        const nsSnapAfter = this.snapshotNamespaceStates();
        const afterNs = nsSnapAfter[ns] || [];
        const acquired = afterNs.filter(s => !beforeNs.includes(s));
        const invalidated = beforeNs.filter(s => !afterNs.includes(s));
        const statesAfter = [...this.getEffectiveStates()];
        const node = {
            function: functionName, valid: true, statesBefore, statesAfter,
            nsStatesBefore: nsSnapBefore, nsStatesAfter: nsSnapAfter,
            acquired, invalidated, namespace: ns,
        };
        this.trace.push(node);
        return {
            valid: true, statesAfter,
            nsStatesBefore: nsSnapBefore, nsStatesAfter: nsSnapAfter,
            acquired, invalidated, namespace: ns,
        };
    }
    /** 返回包含 StateTransition 的 apply 结果（供 planner 使用） */
    applyWithTransition(functionName, actionIndex) {
        const result = this.apply(functionName, actionIndex);
        const ns = result.namespace || DEFAULT_NAMESPACE;
        const transition = {
            actionIndex,
            function: functionName,
            namespace: ns,
            acquired: result.acquired || [],
            invalidated: result.invalidated || [],
            statesBefore: result.nsStatesBefore || {},
            statesAfter: result.nsStatesAfter || {},
            valid: result.valid,
        };
        return { result, transition };
    }
    getCurrentStates() {
        return [...this.getEffectiveStates()];
    }
    /** 获取所有命名空间的合并状态视图 */
    getEffectiveStates() {
        const all = new Set();
        for (const states of this.namespaceStates.values()) {
            for (const s of states) {
                all.add(s);
            }
        }
        return all;
    }
    /** 获取每个命名空间的独立状态快照 */
    snapshotNamespaceStates() {
        const snap = {};
        for (const [ns, states] of this.namespaceStates) {
            snap[ns] = [...states].sort();
        }
        return snap;
    }
    /** 获取指定命名空间的当前状态 */
    getNamespaceStates(namespace) {
        const ns = namespace || DEFAULT_NAMESPACE;
        return [...(this.namespaceStates.get(ns) || new Set())];
    }
    /** 返回完整跟踪记录 */
    getTrace() {
        return [...this.trace];
    }
    /** 生成人类可读的拦截解释 */
    static explainRejection(rejection) {
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
    static rejectionToJSON(rejection) {
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
    /** 在指定命名空间中查找缺失函数（复用 BFS 修复路径） */
    findMissingFunctions(namespace, current, targetPreStates) {
        // 复用 BFS fixPath，缺失函数 = 修复路径中尚未被调用的函数
        return this.findFixPath(namespace, current, targetPreStates);
    }
    /** 在指定命名空间中查找修复路径（BFS 状态图搜索，支持多跳缺口） */
    findFixPath(namespace, current, targetPreStates) {
        // 构建命名空间内的函数列表
        const nsFuncs = [];
        for (const [fn, rule] of this.rules) {
            if ((rule.namespace || DEFAULT_NAMESPACE) === namespace) {
                nsFuncs.push({ name: fn, rule });
            }
        }
        // BFS 状态图搜索
        const startKey = [...new Set(current)].sort().join(",");
        const visited = new Set();
        const queue = [
            { states: new Set(current), path: [] }
        ];
        visited.add(startKey);
        while (queue.length > 0) {
            const { states, path } = queue.shift();
            // 检查目标：所有 targetPreStates 是否都满足
            if (targetPreStates.every(s => states.has(s))) {
                return path;
            }
            // 尝试每一步可用的函数
            for (const { name, rule } of nsFuncs) {
                // 检查前置条件是否满足
                if (!rule.pre_states.every(p => states.has(p)))
                    continue;
                // 模拟执行
                const nextStates = new Set(states);
                if (rule.invalidate)
                    rule.invalidate.forEach(s => nextStates.delete(s));
                rule.post_states.forEach(s => nextStates.add(s));
                const nextKey = [...nextStates].sort().join(",");
                if (visited.has(nextKey))
                    continue;
                visited.add(nextKey);
                // 防止无限扩展（状态爆炸保护）
                if (visited.size > 1000)
                    break;
                queue.push({ states: nextStates, path: [...path, name] });
            }
        }
        // BFS 未找到完整路径，回退到单跳直接查找
        const path = [];
        const currentSet = new Set(current);
        for (const target of targetPreStates) {
            if (currentSet.has(target))
                continue;
            for (const { name, rule } of nsFuncs) {
                if (rule.post_states.includes(target)) {
                    path.push(name);
                    if (rule.invalidate)
                        rule.invalidate.forEach(s => currentSet.delete(s));
                    rule.post_states.forEach(s => currentSet.add(s));
                    break;
                }
            }
        }
        return path;
    }
}
exports.StateMachineValidator = StateMachineValidator;
/** 从 protocols.json 结构构建 FunctionProtocol 数组 */
function parseProtocolsFromJSON(protocolDef) {
    const protocols = [];
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
