"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeActionCode = executeActionCode;
class ActionBuilder {
    constructor() {
        this.actions = [];
        this.vars = {};
    }
    call(func, args, assignTo) {
        const normalizedArgs = args.map(a => {
            if (typeof a === 'object' && a !== null && !('name' in a && 'type' in a && 'value' in a)) {
                return { name: '', type: 'any', value: a };
            }
            return a;
        });
        const action = { kind: "call", function: func, args: normalizedArgs };
        if (assignTo) {
            action.assignTo = assignTo;
            this.vars[assignTo] = assignTo;
        }
        this.actions.push(action);
    }
    ifBlock(condition, thenFn) {
        const sub = new ActionBuilder();
        sub.vars = { ...this.vars };
        thenFn();
        this.actions.push({ kind: "if", condition, thenActions: sub.actions });
        Object.assign(this.vars, sub.vars);
    }
    ifElse(condition, thenFn, elseFn) {
        const thenBuilder = new ActionBuilder();
        const elseBuilder = new ActionBuilder();
        thenBuilder.vars = { ...this.vars };
        elseBuilder.vars = { ...this.vars };
        thenFn();
        elseFn();
        this.actions.push({
            kind: "if",
            condition,
            thenActions: thenBuilder.actions,
            elseActions: elseBuilder.actions
        });
        Object.assign(this.vars, thenBuilder.vars, elseBuilder.vars);
    }
    assign(target, value) {
        this.actions.push({ kind: "assign", target, value });
        this.vars[target] = target;
    }
    output(value) {
        this.actions.push({ kind: "return", value });
    }
}
let currentVars = {};
/** @requires ACTION_CODE @produces ACTION_RESULT */
function executeActionCode(code) {
    const root = new ActionBuilder();
    currentVars = {};
    const apiFuncs = {
        call: (...args) => root.call(args[0], args.slice(1)),
        callAssign: (...args) => {
            const f = args[0];
            const assignTo = args[1];
            root.call(f, args.slice(2), assignTo);
        },
        ifBlock: (cond, fn) => root.ifBlock(cond, () => fn()),
        ifElse: (cond, thenFn, elseFn) => root.ifElse(cond, () => thenFn(), () => elseFn()),
        assign: (t, v) => {
            root.assign(t, v);
            currentVars[t] = v;
        },
        output: (v) => root.output(v),
    };
    const apiNames = ['call', 'callAssign', 'ifBlock', 'ifElse', 'assign', 'output'];
    const apiValues = apiNames.map(n => apiFuncs[n]);
    try {
        const proxyVars = new Proxy(currentVars, {
            get(target, prop) {
                if (typeof prop === 'string' && prop in target)
                    return target[prop];
                return undefined;
            },
            set(target, prop, value) {
                if (typeof prop === 'string')
                    target[prop] = value;
                return true;
            }
        });
        const wrappedCode = `with(vars) { ${code} }`;
        const fn = new Function('vars', ...apiNames, wrappedCode);
        fn(proxyVars, ...apiValues);
        return root.actions;
    }
    catch (e) {
        console.error("执行 Action 代码失败:", e);
        return null;
    }
}
