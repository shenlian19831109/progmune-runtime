/**
 * nestjs-shape-census.ts — NestJS **形态普查**（只看不改）
 *
 * 为什么需要它：
 *   §51 在 immich 上发现「刀 1 是形态枚举」⇒ §52 重写为注册事件解析 ⇒ §52 在 nocodb 上
 *   又是 0 收益（根因：`@Module(configVar)` —— 装饰器参数是**变量**不是对象字面量）。
 *   一次 held-out 揭露一个写法，就要改一次实现 —— 这是打地鼠，不是收敛。
 *
 *   正确的做法是先把「剩下的门」一次数清楚：**形态普查**。在若干真实项目上统计每个
 *   语法位置的写法分布，按覆盖率决定解析器的边界，再反过来用普查之外的仓验证。
 *
 * 统计维度（每个都对应 detector 的一处解析假设）：
 *   M. @Module 装饰器参数形态：对象字面量 / 变量 / 函数调用 / 无参
 *   P. providers 数组元素形态：直接对象 / spread / 其它
 *   R. HTTP 装饰器参数形态：字符串 / 数组 / 无参 / 变量     ← §52 在 nocodb 上崩在这里
 *   D. mutation 入参的装饰器与类型形态（是否有可校验的结构化输入）
 *   T. DTO 定义形态：class-validator / createZodDto / zod type alias(`.meta({id})`) / 普通 interface
 *   G. 全局管道/守卫注册途径：useGlobalPipes / APP_PIPE / @UsePipes / APP_GUARD / @UseGuards
 *
 * 用法：
 *   NODE_OPTIONS="--max-old-space-size=1536" npx tsx blind-benchmark/nestjs-shape-census.ts \
 *     <name>=<dir> [...]    （OUT=path 可改输出）
 */
import * as fs from "fs";
import * as path from "path";
import { Project, SyntaxKind, SourceFile } from "ts-morph";

interface Stats {
  modules: number;
  moduleArg: Record<string, number>;
  moduleProvidersFiles: number;
  providerElements: Record<string, number>;
  appTokensSeen: Record<string, number>;
  routeDecorators: Record<string, number>;
  routeArgKind: Record<string, number>;
  mutationParams: Record<string, number>;
  paramTypeShape: Record<string, number>;
  dtoClasses: Record<string, number>;
  usePipesCount: number;
  useGuardsCount: number;
  useGlobalPipes: boolean;
  useGlobalGuards: boolean;
  pipesArgNames: Record<string, number>;
}

function blank(): Stats {
  return {
    modules: 0,
    moduleArg: {},
    moduleProvidersFiles: 0,
    providerElements: {},
    appTokensSeen: {},
    routeDecorators: {},
    routeArgKind: {},
    mutationParams: {},
    paramTypeShape: {},
    dtoClasses: {},
    usePipesCount: 0,
    useGuardsCount: 0,
    useGlobalPipes: false,
    useGlobalGuards: false,
    pipesArgNames: {},
  };
}

function bump(rec: Record<string, number>, key: string) {
  rec[key] = (rec[key] || 0) + 1;
}

const HTTP = new Set(["Get", "Post", "Put", "Delete", "Patch", "Options", "Head", "All"]);
const MUTATION = new Set(["POST", "PUT", "DELETE", "PATCH"]);

function classifyParamType(text: string): string {
  const t = text.trim();
  if (!t) return "unknown";
  if (/^(string|number|boolean|any|unknown|void|never|object)\b/.test(t)) return "primitive";
  if (/^import\(/.test(t)) return "imported-type";
  if (/^[A-Z][\w$]*$/.test(t)) return "simple-class-like";
  if (/^[A-Z][\w$]*<</.test(t)) return "generic";
  if (/^Array<|^[\w$]+\[\]$/.test(t)) return "array";
  if (/^[\w$]+ \|/.test(t)) return "union";
  return "other:" + t.slice(0, 24);
}

function scanOne(name: string, dir: string): Stats {
  const s = blank();
  let project: Project;
  try {
    project = new Project({ tsConfigFilePath: path.join(dir, "tsconfig.json") });
  } catch {
    project = new Project();
    project.addSourceFilesAtPaths(`${dir}/**/*.ts`);
  }

  const files: SourceFile[] = project
    .getSourceFiles()
    .filter(
      (f) =>
        !f.getFilePath().includes("node_modules") &&
        !/\.(test|spec)\.ts$/.test(f.getFilePath())
    );

  // 文件级正则项（不必走 AST）
  for (const f of files) {
    const txt = f.getFullText();
    if (/\.useGlobalPipes\s*\(/.test(txt)) s.useGlobalPipes = true;
    if (/\.useGlobalGuards\s*\(/.test(txt)) s.useGlobalGuards = true;
    for (const m of txt.matchAll(/\bAPP_(PIPE|GUARD|INTERCEPTOR|FILTER)\b/g)) {
      bump(s.appTokensSeen, `APP_${m[1]}`);
    }
  }

  for (const f of files) {
    for (const cls of f.getClasses()) {
      // ── M. @Module 参数形态 ──
      const modDec = cls.getDecorator("Module");
      if (modDec) {
        s.modules++;
        const arg = modDec.getArguments()[0];
        if (!arg) bump(s.moduleArg, "none");
        else if (arg.getKind() === SyntaxKind.ObjectLiteralExpression) bump(s.moduleArg, "object-literal");
        else if (arg.getKind() === SyntaxKind.Identifier) bump(s.moduleArg, "identifier:" + arg.getText());
        else if (arg.getKind() === SyntaxKind.CallExpression) bump(s.moduleArg, "call");
        else bump(s.moduleArg, "other:" + arg.getKindName());
      }

      // ── R. 路由装饰器参数形态 ──
      for (const method of cls.getMethods()) {
        for (const dec of method.getDecorators()) {
          const decName = dec.getName();
          if (!HTTP.has(decName)) continue;
          s.routeDecorators[decName] = (s.routeDecorators[decName] || 0) + 1;
          const arg = dec.getArguments()[0];
          if (!arg) {
            bump(s.routeArgKind, "none");
          } else {
            const k = arg.getKind();
            if (k === SyntaxKind.StringLiteral) bump(s.routeArgKind, "string");
            else if (k === SyntaxKind.ArrayLiteralExpression) bump(s.routeArgKind, "array");
            else if (k === SyntaxKind.Identifier) bump(s.routeArgKind, "identifier");
            else bump(s.routeArgKind, "other:" + arg.getKindName());
          }
        }
      }

      // ── D. mutation 入参形态 ──
      for (const method of cls.getMethods()) {
        const http = method
          .getDecorators()
          .map((d) => d.getName())
          .find((n) => HTTP.has(n));
        if (!http || !MUTATION.has(http.toUpperCase())) continue;
        for (const p of method.getParameters()) {
          const decs = p.getDecorators().map((d) => d.getName());
          if (decs.length === 0) {
            bump(s.mutationParams, "(no-decorator)");
            continue;
          }
          for (const d of decs) bump(s.mutationParams, "@" + d);
          if (decs.some((d) => ["Body", "Query", "Param"].includes(d))) {
            let typeText = "";
            try {
              typeText = p.getType().getText();
            } catch {
              typeText = "(unresolved)";
            }
            bump(s.paramTypeShape, classifyParamType(typeText));
          }
        }
      }

      // ── G. @UsePipes / @UseGuards 参数写法 ──
      for (const target of [cls, ...cls.getMethods()]) {
        const pipes = cls === target ? cls.getDecorator("UsePipes") : target.getDecorator("UsePipes");
        const guards = cls === target ? cls.getDecorator("UseGuards") : target.getDecorator("UseGuards");
        if (pipes) {
          s.usePipesCount++;
          for (const a of pipes.getArguments()) {
            const first = /^[A-Za-z_$][\w$]*/.exec(a.getText().replace(/^(?:new|await)\s+/, ""));
            bump(s.pipesArgNames, first ? first[0] : "?");
          }
        }
        if (guards) s.useGuardsCount++;
      }

      // ── T. DTO 定义形态 ──
      const dtoKind = classifyDto(cls);
      if (dtoKind) bump(s.dtoClasses, dtoKind);
    }
  }

  return s;
}

function classifyDto(cls: any): string | null {
  const name = cls.getName();
  if (!name) return null;
  const isDto = /Dto$/.test(name) || /Dto$/.test(cls.getBaseClass()?.getName?.() ?? "");
  const ext = cls.getExtends();
  const extText = ext?.getText() ?? "";
  if (/createZodDto\s*\(/.test(extText)) return "createZodDto-class";
  const hasValidator = [...cls.getDecorators(), ...cls.getProperties().flatMap((p: any) => p.getDecorators())]
    .some((d: any) => /^@(Is|Validate|Matches|Min|Max|Length|Array|Allow|Equals)/.test(d?.getText?.() ?? ""));
  if (hasValidator) return "class-validator";
  if (!isDto) return null;
  return "plain-dto(no-validator)";
}

async function main() {
  const out: Record<string, unknown> = { generated_at: new Date().toISOString(), projects: {} };
  for (const arg of process.argv.slice(2)) {
    const idx = arg.indexOf("=");
    if (idx <= 0) continue;
    const name = arg.slice(0, idx);
    const dir = arg.slice(idx + 1);
    const t0 = Date.now();
    try {
      const st = scanOne(name, dir);
      (out.projects as any)[name] = { dir, ms: Date.now() - t0, ...st };
      console.log(`\n=== ${name} (${Date.now() - t0}ms) ===`);
      console.log(`@Module: ${st.modules}  参数形态 ${JSON.stringify(st.moduleArg)}`);
      console.log(`route 装饰器: ${JSON.stringify(st.routeDecorators)}`);
      console.log(`route 参数形态: ${JSON.stringify(st.routeArgKind)}`);
      console.log(`APP_* token: ${JSON.stringify(st.appTokensSeen)}  useGlobalPipes=${st.useGlobalPipes} useGlobalGuards=${st.useGlobalGuards}`);
      console.log(`@UsePipes=${st.usePipesCount} @UseGuards=${st.useGuardsCount} pipes 参数名 ${JSON.stringify(st.pipesArgNames)}`);
      console.log(`mutation 入参装饰器: ${JSON.stringify(st.mutationParams)}`);
      console.log(`结构化入参类型形态: ${JSON.stringify(st.paramTypeShape)}`);
      console.log(`DTO class 形态: ${JSON.stringify(st.dtoClasses)}`);
    } catch (e: any) {
      console.error(`[${name}] 失败: ${e?.message}`);
    }
  }
  const p = process.env.OUT || "blind-benchmark/reports/nestjs-shape-census.json";
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(out, null, 2));
  console.log(`\n→ ${p}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
