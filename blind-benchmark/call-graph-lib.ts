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
  params: string;
  qcalls: QCall[];
}

const DECOR_RE = /@(Get|Post|Put|Patch|Delete|Controller|UseGuards|UseInterceptors|UsePipes|Public|RequireAuth|Permissions|Roles|Injectable|Inject|Body|Param|Query|Req|Res|UploadedFile)\b/g;

/** 鉴权 / 权限 / 校验 相关的调用名（跨框架粗筛，宁可宽） */
const AUTH_CALL_RE =
  /\b(?:can|cannot|authorize|isAuthorized|checkPermission|hasPermission|requirePermission|assertCan\w*|verifyAuth|authenticate|validateOwnership|checkOwnership|assertOwnership|ensureOwner|guard\w*)\s*\(|\bAbility(?:Builder)?\s*\(|\bCASL\b/i;

const REQ_RE = /\b(?:req|request|ctx|context)\s*\.\s*(?:body|params|query|headers|cookies|user)\b/;

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
      push(cn ? `${cn}.${m.getName()}` : m.getName(), "method", m, clsDecor);
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
}

export function buildGraph(root: string, quiet = false): Graph {
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
   *   ① 有接收者 ⇒ 属性名首字母大写当类名（NestJS 注入惯例 attachmentService→AttachmentService），
   *      命中 Class.method 才算强边；**绝不裸名兜底**（`this.storageService.delete()`
   *       里的 delete 若裸名兜底会错认成 CommentController.delete）。
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
      const cls = q.prop.charAt(0).toUpperCase() + q.prop.slice(1);
      return byFull.get(`${cls}.${q.method}`) ?? byFull.get(`${q.prop}.${q.method}`) ?? [];
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

  const callees: number[][] = new Array(facts.length);
  facts.forEach((f, i) => {
    const out = new Set<number>();
    for (const q of f.qcalls) for (const t of resolve(q, i)) if (t !== i) out.add(t);
    callees[i] = [...out];
  });
  const callers: number[][] = facts.map(() => []);
  callees.forEach((cs, i) => cs.forEach((c) => callers[c].push(i)));

  if (!quiet) {
    const edges = callees.reduce((a, c) => a + c.length, 0);
    console.log(`[graph] 调用边 ${edges} 条（v4：this/super 同类 + import 作用域裸名）`);
  }

  return { facts, files, byFull, byBare, importNames, callees, callers };
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
