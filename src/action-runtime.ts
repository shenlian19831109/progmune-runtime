export interface Action {
  kind: "call" | "if" | "for" | "assign" | "return";
  function?: string;
  args?: any[];
  assignTo?: string;
  condition?: string;
  thenActions?: Action[];
  elseActions?: Action[];
  variable?: string;
  iterable?: string;
  bodyActions?: Action[];
  target?: string;
  value?: any;
}

class ActionBuilder {
  public actions: Action[] = [];
  public vars: Record<string, any> = {};

  call(func: string, args: any[], assignTo?: string) {
    const normalizedArgs = args.map(a => {
      if (typeof a === 'object' && a !== null && !('name' in a && 'type' in a && 'value' in a)) {
        return { name: '', type: 'any', value: a };
      }
      return a;
    });
    const action: Action = { kind: "call", function: func, args: normalizedArgs };
    if (assignTo) {
      action.assignTo = assignTo;
      this.vars[assignTo] = assignTo;
    }
    this.actions.push(action);
  }

  ifBlock(condition: string, thenFn: () => void) {
    const sub = new ActionBuilder();
    sub.vars = { ...this.vars };
    thenFn();
    this.actions.push({ kind: "if", condition, thenActions: sub.actions });
    Object.assign(this.vars, sub.vars);
  }

  ifElse(condition: string, thenFn: () => void, elseFn: () => void) {
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

  assign(target: string, value: any) {
    this.actions.push({ kind: "assign", target, value });
    this.vars[target] = target;
  }

  output(value: any) {
    this.actions.push({ kind: "return", value });
  }
}

let currentVars: Record<string, any> = {};

export function executeActionCode(code: string): Action[] | null {
  const root = new ActionBuilder();
  currentVars = {};

  const apiFuncs = {
    call: (...args: any[]) => root.call(args[0], args.slice(1)),
    callAssign: (...args: any[]) => {
      const f = args[0];
      const assignTo = args[1];
      root.call(f, args.slice(2), assignTo);
    },
    ifBlock: (cond: string, fn: any) => root.ifBlock(cond, () => fn()),
    ifElse: (cond: string, thenFn: any, elseFn: any) =>
      root.ifElse(cond, () => thenFn(), () => elseFn()),
    assign: (t: string, v: any) => {
      root.assign(t, v);
      currentVars[t] = v;
    },
    output: (v: any) => root.output(v),
  };

  const apiNames = ['call', 'callAssign', 'ifBlock', 'ifElse', 'assign', 'output'];
  const apiValues = apiNames.map(n => apiFuncs[n as keyof typeof apiFuncs]);

  try {
    const proxyVars = new Proxy(currentVars, {
      get(target, prop) {
        if (typeof prop === 'string' && prop in target) return target[prop];
        return undefined;
      },
      set(target, prop, value) {
        if (typeof prop === 'string') target[prop] = value;
        return true;
      }
    });

    const wrappedCode = `with(vars) { ${code} }`;
    const fn = new Function('vars', ...apiNames, wrappedCode);
    fn(proxyVars, ...apiValues);
    return root.actions;
  } catch (e) {
    console.error("执行 Action 代码失败:", e);
    return null;
  }
}
