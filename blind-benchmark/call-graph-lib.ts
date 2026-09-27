/**
 * 调用图基建（2026-09-24）
 *
 * 从 build-call-chain.ts（§三十五 原型）里抽出来的可复用部分：
 *   - callable 抽取（函数声明 / 变量箭头 / 类方法）
 *   - 调用边解析 **v3 规则**（R49：有接收者只认强边，绝不裸名兜底）
 *
 * 抽出来的原因：闭包采样器要在**全量源码**上建图（不是切片上），
 * 两个脚本必须共用同一套边规则，否则"采样器建的图"和"原型验证用的图"
 * 不是同一张图 ⇒ 覆盖率数字不可比。
 *
 * 只做只读分析，不改提取器主干。
 */
import fs from "fs";
import path from "path";
import { Project, SyntaxKind, Node } from "ts-morph";

export interface QCall {
  prop: string;
  method: string;
}

export interface Fact {
  file: string;
  name: string;
  kind: string;
  decorators: string[];
  /** 所属类的装饰器（NestJS 的 @Controller 挂在类上，方法上只有 @Get/@Post） */
  clsDecorators: string[];
  authCalls: string[];
  sanitizeCalls: string[];
  hasReqParam: boolean;
  /** §49.4（2026-09-27）**文件级路由注册**痕迹（Express/Koa/Fastify 形态：`app.get(` /
   *  `router.post(`）。与 `hasDecoratedInput` 是 R81 的**对称**问题：`hasRouteTrace` 只认
   *  装饰器 ⇒ Express 系仓库的 route 痕迹**恒为 0**（verdaccio 实测：89 条 gold 全 0%，
   *  不是"少"，是一条都没有）。⚠ 又一个"恒为 0"式失效。 */
  hasRouteReg: boolean;
  /** §49.2（2026-09-27）装饰器注入的请求输入（NestJS 惯例 `@Body() dto`）。
   *  与 hasReqParam 并列：**缺了它，NestJS 系仓库的入口一个都认不出来**
   *  （docmost 实测：只看 req.* 字面时，gold 114 条上溯 3 层撞到 req 入口 = 0%）。
   *  `getParameters().getText()` 是**含装饰器**的，所以直接在参数文本上匹配。 */
  hasDecoratedInput: boolean;
  params: string;
  qcalls: QCall[];
  /** 所属类名（类方法专用，§49.8 用于查该类的依赖注入表） */
  ownerClass?: string;
  /**
   * §49.8（2026-09-27）构造函数参数属性 ⇒ DI 成员映射（`private userService: UsersService`
   * ⇒ `[["userService","UsersService"]]`）。只有 constructor 的 fact 带。
   *
   * 为什么用它修边：§49.7 实测三仓后端层入边为 0 的函数里，**有调用点却连不上**的占
   * 23%~44%，而其中 **62~93 条**清一色是 `this.svc.method()` —— 接收者是依赖注入来的，
   * 旧规则只能把 `svc` 首字母大写猜成 `Svc.method`，NestJS 命名全都不匹配 ⇒ 整条边丢。
   * 构造函数签名里**明确写着**这个成员的类型，属于签名级正向证据（R75），
   * 不依赖调用图连通 ⇒ 比猜测精确，也比"缺席型"判据安全。
   */
  diMembers?: Array<[string, string]>;
}

const DECOR_RE = /@(Get|Post|Put|Patch|Delete|Controller|UseGuards|UseInterceptors|UsePipes|Public|RequireAuth|Permissions|Roles|Injectable|Inject|Body|Param|Query|Req|Res|UploadedFile)\b/g;

/** 鉴权 / 权限 / 校验 相关的调用名（跨框架粗筛，宁可宽） */
const AUTH_CALL_RE =
  /\b(?:can|cannot|authorize|isAuthorized|checkPermission|hasPermission|requirePermission|assertCan\w*|verifyAuth|authenticate|validateOwnership|checkOwnership|assertOwnership|ensureOwner|guard\w*)\s*\(|\bAbility(?:Builder)?\s*\(|\bCASL\b/i;

const REQ_RE = /\b(?:req|request|ctx|context)\s*\.\s*(?:body|params|query|headers|cookies|user)\b/;

/**
 * §49.2（2026-09-27）**装饰器注入**的请求输入。
 *
 * 为什么必须单独一条：`REQ_RE` 只认 `req.body` 这类**属性取值**字面，而 NestJS
 * （docmost / lujakob 两个切片都是）的入口长这样——
 *
 *     @Post() async create(@Body() dto: CreatePageDto, @Req() req) { ... }
 *
 * 请求数据**根本不经过 `req.xxx`**，走的是装饰器 + 参数类型。于是只看 REQ_RE 时，
 * 这些仓库的「入口痕迹」恒为 0 ——§49.1 实测 docmost gold 114 条上溯 3 层，
 * 撞到 req 入口的比例是 **0%**，不是「很少」，是**一条都没有**。
 *
 * ⚠ 这条是**入口检测**用的启发式，不是产品判据；改它不影响任何产品路径
 * （call-graph-lib 只服务于 blind-benchmark 的只读分析）。
 */
export const PARAM_INPUT_DECOR_RE =
  /@(?:Body|Param|Params|Query|Queries|Req|Request|Headers|Header|Cookies|UploadedFile|File|Files)\b/;

const SANITIZE_RE =
  /\b(?:validate\w*|sanitize\w*|escape\w*|normalize\w*|check\w*|assert\w*|ensure\w*|parse\w*|zod|joi|yup|classValidator|plainToInstance|transform)\s*\(/i;

/** 路由入口装饰器（NestJS 惯例；Express/Fastify 走文件名规则） */
export const ROUTE_DECOR_RE = /@(Get|Post|Put|Patch|Delete|All|Sse|Controller)\b/;
/** 守卫/权限装饰器：调用链上出现它就说明这一跳带鉴权上下文 */
export const GUARD_DECOR_RE = /@(UseGuards|RequireAuth|Permissions|Roles|Public|UsePipes|UseInterceptors)\b/;

function decoratorsOf(node: Node): string[] {
  return ((node as any).getDecorators?.() ?? []).map((d: any) =>
    String(d.getText()).slice(0, 80)
  );
}

/** 类名合法性（排除泛型 / 联合 / 内联对象类型 / `Knex` 这类外部类型也无法命中 ⇒ 回合空但无害） */
const SIMPLE_CLASS_RE = /^[A-Z][A-Za-z0-9_]*$/;

/**
 * §49.8：从构造函数参数里抽 DI 成员映射。
 * 命中形态（NestJS 惯例，三仓一致）：
 *
 *     constructor(
 *       private readonly logger: ConsoleLoggerService,
 *       @Inject(authConfiguration.KEY) private authConfig: AuthConfig,
 *     ) {}
 *
 * ⇒ [["logger","ConsoleLoggerService"], ["authConfig","AuthConfig"]]
 * 装饰器不影响 `getTypeNode()`，所以有/无 @Inject 都能取到类型。
 */
export function collectDiParams(m: any): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const p of m.getParameters?.() ?? []) {
    const nm = String(p.getName?.() ?? "").trim();
    const ty = String(p.getTypeNode?.()?.getText?.() ?? "").trim();
    if (!nm || !SIMPLE_CLASS_RE.test(ty)) continue;
    out.push([nm, ty]);
  }
  return out;
}

export function collectCallable(sf: any, fileRel: string): Fact[] {
  const out: Fact[] = [];
  const push = (name: string, kind: string, node: any, clsDecor: string[] = []) => {
    const body = node.getBody?.() ?? node;
    const text = body.getText?.() ?? "";
    const qcalls: QCall[] = [];
    const seenCall = new Set<string>();
    for (const c of body.getDescendantsOfKind?.(SyntaxKind.CallExpression) ?? []) {
      const expr = String(c.getExpression().getText());
      const m = expr.match(/(?:this\s*\.\s*)?([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*$/);
      const key = m ? `${m[1]}.${m[2]}` : expr;
      if (seenCall.has(key)) continue;
      seenCall.add(key);
      qcalls.push(
        m
          ? { prop: m[1], method: m[2] }
          : { prop: "", method: (expr.match(/([A-Za-z_$][\w$]*)\s*$/) ?? ["", expr])[1] }
      );
    }
    out.push({
      file: fileRel,
      name,
      kind,
      decorators: decoratorsOf(node),
      clsDecorators: clsDecor,
      authCalls: (text.match(new RegExp(AUTH_CALL_RE.source, "g")) ?? []).slice(0, 6),
      sanitizeCalls: (text.match(new RegExp(SANITIZE_RE.source, "g")) ?? []).slice(0, 6),
      hasReqParam: REQ_RE.test(text),
      // §49.4：Express/Koa/Fastify 的路由注册是**语句**不是装饰器，只能扫函数体文本
      hasRouteReg: ROUTE_REG_RE.test(text),
      // §49.2：装饰器形态的请求输入。注意要在**截断之前**匹配——
      // params 只留 160 字符，把装饰器挂在后面的参数会被切掉。
      hasDecoratedInput: (node.getParameters?.() ?? []).some((p: any) =>
        PARAM_INPUT_DECOR_RE.test(String(p.getText()))
      ),
      params: (node.getParameters?.() ?? [])
        .map((p: any) => String(p.getText()).slice(0, 40))
        .join(", ")
        .slice(0, 160),
      qcalls,
    });
  };

  for (const fn of sf.getFunctions?.() ?? []) {
    const n = fn.getName();
    if (n) push(n, "function", fn);
  }
  for (const v of sf.getVariableDeclarations?.() ?? []) {
    const init = v.getInitializer?.();
    if (!init) continue;
    if (init.getKind() === SyntaxKind.ArrowFunction || init.getKind() === SyntaxKind.FunctionExpression) {
      push(v.getName(), "arrow", init);
    }
  }
  for (const cls of sf.getClasses?.() ?? []) {
    const cn = cls.getName?.() ?? "";
    const clsDecor = decoratorsOf(cls);
    for (const m of cls.getMethods?.() ?? []) {
      const name = cn ? `${cn}.${m.getName()}` : m.getName();
      push(name, "method", m, clsDecor);
      const f = out[out.length - 1];
      if (cn) f.ownerClass = cn;
      if (cn && m.getName() === "constructor") f.diMembers = collectDiParams(m);
    }
    // ⚠ ts-morph 的 getMethods() **不含构造函数**（ConstructorDeclaration 是另一类节点）。
    // 少了这一步，classDi 恒为空、DI 边修复静默失效——表现为"命中 0 条"而不是报错（R27）。
    for (const ct of cls.getConstructors?.() ?? []) {
      push(cn ? `${cn}.constructor` : "constructor", "constructor", ct, clsDecor);
      const f2 = out[out.length - 1];
      if (cn) {
        f2.ownerClass = cn;
        f2.diMembers = collectDiParams(ct);
      }
    }
  }
  return out;
}

/** 与 fp-pool-fetch.py 保持一致的排除表（切片里没有的目录，建图时也不该有） */
export const EXCLUDE_DIRS = new Set([
  "node_modules", "dist", "build", "coverage", ".git", "e2e", "__tests__",
  "test", "tests", "docs", "examples", "scripts", "benchmark", "vendor",
  ".next", ".nuxt", "out", "public", "static", "assets", "migrations",
]);

export function findSourceFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (EXCLUDE_DIRS.has(e.name.toLowerCase())) continue;
        walk(path.join(d, e.name));
      } else if (/\.tsx?$/.test(e.name) && !e.name.endsWith(".d.ts")) {
        // 测试文件一并排除：① 与 fp-pool-fetch.py 口径一致（切片里没有测试）
        // ② 测试是最常见的"假调用者"来源——把测试算进链，会凭空多出一堆入口
        if (/\.(test|spec)\.tsx?$/.test(e.name)) continue;
        // 单文件 >400KB 一律丢：ts-morph 在本机（8GB + swap 常年吃满）会 OOM
        try {
          if (fs.statSync(path.join(d, e.name)).size > 400 * 1024) continue;
        } catch {
          continue;
        }
        files.push(path.join(d, e.name));
      }
    }
  };
  walk(root);
  return files.sort();
}

/** 相对 import 说明符 → 仓库内文件（只跟相对路径，外部包不管） */
export function resolveSpecToFile(fileSet: Set<string>, from: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = path.normalize(path.join(path.dirname(from), spec));
  for (const cand of [base + ".ts", base + ".tsx", path.join(base, "index.ts"), base]) {
    if (fileSet.has(cand)) return cand;
  }
  return null;
}

/** 每个文件「本地名 → 来自哪个文件」的 import 作用域表（用于精确解析裸调用） */
export function buildImportNames(root: string, files: string[]): Map<string, Map<string, string>> {
  const set = new Set(files);
  const out = new Map<string, Map<string, string>>();
  for (const rel of files) {
    let text = "";
    try {
      text = fs.readFileSync(path.join(root, rel), "utf8");
    } catch {
      continue;
    }
    const m = new Map<string, string>();
    const put = (name: string, spec: string) => {
      const n = name.trim().replace(/^type\s+/, "");
      if (!n) return;
      const f = resolveSpecToFile(set, rel, spec);
      if (f && !m.has(n)) m.set(n, f);
    };
    for (const mt of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
      for (const part of mt[1].split(",")) {
        const asM = part.trim().split(/\s+as\s+/);
        put(asM.length === 2 ? asM[1] : asM[0], mt[2]);
      }
    }
    for (const mt of text.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from\s*["']([^"']+)["']/g)) {
      put(mt[1], mt[2]);
    }
    out.set(rel, m);
  }
  return out;
}

/** §49.7（2026-09-27）一个被调用却没有连上目标的调用点，属于哪一类断链 */
export interface UnresCat {
  /** this.x()/super.x() 但同类里找不到这个方法（在父类 / mixin / 原型上） */
  thisMiss: number;
  /** 有接收者（依赖注入 `this.svc.foo()`），没拼出命中的 Class.method */
  inj: number;
  /** 裸调用，但仓库里有多个同名定义 ⇒ import 作用域没帮上忙，全局歧义 */
  dup: number;
  /** 裸调用，仓库里压根没有这个定义（外部包 / 动态 require / 别名） */
  nf: number;
  /** 有多少个**不同文件**发出过这个未连上的调用（>1 说明是普遍现象，值得修） */
  files: Set<string>;
}

export interface Graph {
  facts: Fact[];
  files: string[];
  byFull: Map<string, number[]>;
  byBare: Map<string, number[]>;
  /** 文件 → 「本地名 → 来源文件」 */
  importNames: Map<string, Map<string, string>>;
  /** fact 下标 → 出边（callee 下标） */
  callees: number[][];
  callers: number[][];
  /**
   * §49.7：被调用却**没连上任何定义**的调用点，按「被调名」聚合的**断链原因**。
   *
   * ⚠ 这个诊断必须由 buildGraph **在建图过程中**产出。探针不许另起一份逻辑重算
   * ——R59 的老教训：§44 手抄 `computeExposed` 重写成宽口径，结果预测 8 条、真实 4 条
   * 且清单全不同。这里同理：resolve 规则改一次，手抄的那份就静默过期。
   */
  unresolved: Map<string, UnresCat>;
  /** §49.8：有接收者的边分别由 DI 精确命中 / DI 命中但目标缺失 / 猜类名 得来的条数 */
  edgeStats: { di: number; diMiss: number; guess: number };
}

export function buildGraph(
  root: string,
  quiet = false,
  opts: { useDi?: boolean } = {}
): Graph {
  /** 关掉 DI 解析可得到「修复前」的对照——同一份源码跑两次不用重建 Project 之外的东西 */
  const useDi = opts.useDi !== false;
  const project = new Project({
    compilerOptions: { allowJs: false, noResolve: true, target: 99 },
    skipAddingFilesFromTsConfig: true,
  });
  const absFiles = findSourceFiles(root);
  if (!quiet) console.log(`[graph] 发现 ${absFiles.length} 个源文件，加载中…`);

  const facts: Fact[] = [];
  const files: string[] = [];
  let loaded = 0;
  for (const f of absFiles) {
    try {
      const sf = project.addSourceFileAtPath(f);
      loaded++;
      const rel = path.relative(root, f);
      files.push(rel);
      facts.push(...collectCallable(sf as any, rel));
    } catch {
      // 单文件解析失败不影响整体（本机欠载常见）
    }
  }
  if (!quiet) console.log(`[graph] 已加载 ${loaded} 文件，抽出 ${facts.length} 个 callable`);

  const byFull = new Map<string, number[]>();
  const byBare = new Map<string, number[]>();
  facts.forEach((f, i) => {
    const push = (m: Map<string, number[]>, k: string) => {
      const a = m.get(k) ?? [];
      a.push(i);
      m.set(k, a);
    };
    push(byFull, f.name);
    push(byBare, f.name.includes(".") ? f.name.split(".").pop()! : f.name);
  });

  /**
   * 一次调用指向哪些定义。规则（v4，R49 仍是底线：宁可漏边，不可造假边）：
   *   ⓪ `this.x()` / `super.x()` ⇒ 限定在**同一个类**内解析（fact 名形如 Class.method）。
   *      这不是放宽，是**补漏**：v3 下 `this.x()` 会去查 `This.x`，必然落空 ⇒
   *      同类内部调用这条最常见的边整条丢光。
   *   ① 有接收者 ⇒ **先查本类的依赖注入表**（§49.8：构造函数里写着成员的类型，
   *      签名级精确信息，优先于任何猜测）；查不到才退回"属性名首字母大写当类名"
   *      （NestJS 注入惯例 attachmentService→AttachmentService）。
   *      命中 Class.method 才算强边；**绝不裸名兜底**。
   *   ② 无接收者 ⇒ 先按 **import 作用域**解析（名字是从哪个文件 import 进来的，就只认那个文件
   *      里的定义）；import 里查不到才退回"裸名全局唯一"。
   *      旧规则只看全局唯一，于是 `removeUserAvatar` 这类常见名一撞名就整条边丢弃——
   *      而 import 作用域是**精确**信息，用它不会引入假边。
   */
  const resolve = (q: QCall, selfIdx: number): number[] => {
    const self = facts[selfIdx];
    if (q.prop === "this" || q.prop === "super") {
      const dot = self.name.indexOf(".");
      if (dot > 0) {
        const cls = self.name.slice(0, dot);
        const hit = byFull.get(`${cls}.${q.method}`);
        if (hit && hit.length) return hit;
      }
      return [];
    }
    if (q.prop) {
      // ① DI 表优先：构造函数的参数属性**写着**这个成员的类型，属于签名级精确信息
      const di = useDi ? classDi.get(self.ownerClass ?? "")?.get(q.prop) : undefined;
      if (di) {
        const hit = byFull.get(`${di}.${q.method}`);
        if (hit && hit.length) {
          stats.di++;
          return hit;
        }
        // DI 已明确类型、但那个类里没有这个方法 ⇒ 是父类/外部类提供的。
        // 这时**不回退猜测**（R49：宁可漏边，不可造假边）——猜的是另一个类，连错比不连更糟。
        stats.diMiss++;
        return [];
      }
      const cls = q.prop.charAt(0).toUpperCase() + q.prop.slice(1);
      const guess = byFull.get(`${cls}.${q.method}`) ?? byFull.get(`${q.prop}.${q.method}`) ?? [];
      if (guess.length) stats.guess++;
      return guess;
    }
    // 裸调用：import 作用域优先
    const fromFile = importNames.get(self.file)?.get(q.method);
    if (fromFile) {
      const hit = (byBare.get(q.method) ?? []).filter((i) => facts[i].file === fromFile);
      if (hit.length) return hit;
    }
    const arr = byBare.get(q.method) ?? [];
    return arr.length === 1 ? arr : [];
  };

  const importNames = buildImportNames(root, files);

  /** §49.8：类名 → 「成员名 → 注入类型」，由构造函数参数属性合成（同上：乃是**签名证据**) */
  const classDi = new Map<string, Map<string, string>>();
  for (const f of facts) {
    if (!f.ownerClass || !f.diMembers?.length) continue;
    let m = classDi.get(f.ownerClass);
    if (!m) classDi.set(f.ownerClass, (m = new Map()));
    for (const [mem, ty] of f.diMembers) if (SIMPLE_CLASS_RE.test(ty) && !m.has(mem)) m.set(mem, ty);
  }

  /** §49.8 边来源计数：用于对照「精确边」与「猜边」各贡献了多少，别把功劳算错地方 */
  const stats = { di: 0, diMiss: 0, guess: 0 };

  /** §49.7：被调用却没连上的调用点，按被调名聚合（见 Graph.unresolved） */
  const unresolved = new Map<string, UnresCat>();

  /**
   * §49.7 断链诊断：resolve 落空时**记下原因**，而不是静默丢弃。
   * 「这条边为什么没了」是能否修边的唯一依据——只给一个合并的入边为 0 比例，
   * 可修和不可修混在一起，会得出错误的「能力上限」结论（R80）。
   */
  const cat = (name: string, k: keyof Omit<UnresCat, "files">, file: string) => {
    let c = unresolved.get(name);
    if (!c) unresolved.set(name, (c = { thisMiss: 0, inj: 0, dup: 0, nf: 0, files: new Set() }));
    c[k]++;
    c.files.add(file);
  };
  const catOf = (q: QCall, self: Fact): keyof Omit<UnresCat, "files"> => {
    if (q.prop === "this" || q.prop === "super") return "thisMiss";
    if (q.prop) return "inj";
    return (byBare.get(q.method) ?? []).length === 0 ? "nf" : "dup";
  };

  const callees: number[][] = new Array(facts.length);
  facts.forEach((f, i) => {
    const out = new Set<number>();
    for (const q of f.qcalls) {
      const ts = resolve(q, i).filter((t) => t !== i);
      if (!ts.length) cat(q.method, catOf(q, f), f.file);
      for (const t of ts) out.add(t);
    }
    callees[i] = [...out];
  });
  const callers: number[][] = facts.map(() => []);
  callees.forEach((cs, i) => cs.forEach((c) => callers[c].push(i)));

  if (!quiet) {
    const edges = callees.reduce((a, c) => a + c.length, 0);
    console.log(`[graph] 调用边 ${edges} 条（v4：this/super 同类 + import 作用域裸名）`);
  }

  return { facts, files, byFull, byBare, importNames, callees, callers, unresolved, edgeStats: stats };
}

/** gold 里只存裸名，索引里是 `Class.method` ⇒ 必须允许后缀匹配，否则起点就断 */
export function selfFacts(g: Graph, fn: string, file?: string): number[] {
  const bare = fn.includes(".") ? fn.split(".").pop()! : fn;
  const hit = g.facts
    .map((f, i) => i)
    .filter((i) => {
      const f = g.facts[i];
      return f.name === fn || f.name === bare || f.name.endsWith("." + bare);
    });
  if (!file) return hit;
  const inFile = hit.filter((i) => g.facts[i].file === file || g.facts[i].file.endsWith(file));
  return inFile.length ? inFile : hit;
}

export function hasAuthTrace(g: Graph, i: number): boolean {
  const f = g.facts[i];
  return (
    f.authCalls.length > 0 ||
    f.decorators.some((d) => GUARD_DECOR_RE.test(d)) ||
    f.clsDecorators.some((d) => GUARD_DECOR_RE.test(d))
  );
}

/**
 * 文件级路由注册痕迹（Express/Koa/Fastify 形态：`router.get(` / `app.post(` / `.route(`）。
 * 装饰器只是 NestJS 的惯例——只认装饰器会让 Express 系仓库的入口文件**一个都找不出来**
 * （verdaccio 实测：入口文件只有 14 个且全是误命中，可达性恒为 0）。
 */
export const ROUTE_REG_RE =
  /\b(?:app|router|server|api|route[r]?)\s*\.\s*(?:get|post|put|patch|delete|all|route)\s*\(/;

export function hasRouteTrace(g: Graph, i: number): boolean {
  const f = g.facts[i];
  return (
    f.decorators.some((d) => ROUTE_DECOR_RE.test(d)) ||
    f.clsDecorators.some((d) => ROUTE_DECOR_RE.test(d))
  );
}
