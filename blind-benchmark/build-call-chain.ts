/**
 * 跨函数调用链视图 —— 原型（2026-09-24）
 *
 * 背景：文章（Jev + Ontology）指出「判断」的前提是 **World State**。
 * 我们 §二十九 给 Jev 的 state 只有函数名 + 调用列表，而 §33.5 独立发现
 * UNKNOWN 的真瓶颈是鉴权/会话族需要 **跨函数、跨文件的调用链上下文**。
 * ⇒ 两条线索同根：我们缺「世界状态」这一层。本工具是造这一层的第一步。
 *
 * 按 R41：这是「补信息」路径（确定性、可测、免费），不上概率模型。
 * 原型只做**只读分析**，不改提取器主干。
 *
 * 用法：
 *   npx tsx build-call-chain.ts --repo docmost --depth 2
 *   npx tsx build-call-chain.ts --repo docmost --fn uploadFile
 *
 * 输出：reports/call-chain-<repo>.json
 */
import fs from "fs";
import path from "path";
import { Project, SyntaxKind, Node } from "ts-morph";

const HERE = __dirname;
const POOL = path.join(HERE, "fp-pool");
const OUT_DIR = path.join(HERE, "reports");

/* ---------------- 抽取：一个 callable 的「关键事实」 ---------------- */

const DECOR_RE = /@(Get|Post|Put|Patch|Delete|Controller|UseGuards|UseInterceptors|UsePipes|Public|RequireAuth|Permissions|Roles|Injectable|Inject|Body|Param|Query|Req|Res|UploadedFile)\b/g;

/** 鉴权 / 权限 / 校验 相关的调用名（跨框架粗筛，宁可宽） */
const AUTH_CALL_RE =
  /\b(?:can|cannot|authorize|isAuthorized|checkPermission|hasPermission|requirePermission|assertCan\w*|verifyAuth|authenticate|validateOwnership|checkOwnership|assertOwnership|ensureOwner|guard\w*)\s*\(|\bAbility(?:Builder)?\s*\(|\bCASL\b/i;

/** 请求入口痕迹 */
const REQ_RE = /\b(?:req|request|ctx|context)\s*\.\s*(?:body|params|query|headers|cookies|user)\b/;

/** 校验 / 清洗痕迹 */
const SANITIZE_RE =
  /\b(?:validate\w*|sanitize\w*|escape\w*|normalize\w*|check\w*|assert\w*|ensure\w*|parse\w*|zod|joi|yup|classValidator|plainToInstance|transform)\s*\(/i;

interface Fact {
  file: string;
  name: string;
  kind: string;
  decorators: string[];
  authCalls: string[];
  sanitizeCalls: string[];
  hasReqParam: boolean;
  params: string;
  /** 该函数体里出现的调用（带接收者，用于反查调用关系） */
  qcalls: QCall[];
}

/** 一次调用：this.attachmentService.uploadFile(...) ⇒ prop=attachmentService, method=uploadFile */
interface QCall {
  prop: string;
  method: string;
}

function decoratorsOf(node: Node): string[] {
  const out: string[] = [];
  for (const d of (node as any).getDecorators?.() ?? []) {
    const t = d.getText().slice(0, 80);
    out.push(t);
  }
  return out;
}

function collectCallable(sf: any, fileRel: string): Fact[] {
  const out: Fact[] = [];
  const push = (name: string, kind: string, node: any) => {
    const body = node.getBody?.() ?? node;
    const text = body.getText?.() ?? "";
    // 调用抽取必须带**接收者**：只存裸名会让 delete/createForUser 这类常见名
    // 制造大量假边（第一版实测：createForUser 冒出 25 个"调用者"）。
    const qcalls: QCall[] = [];
    const seenCall = new Set<string>();
    for (const c of body.getDescendantsOfKind?.(SyntaxKind.CallExpression) ?? []) {
      const expr = c.getExpression().getText();
      const m = expr.match(/(?:this\s*\.\s*)?([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*$/);
      const key = m ? `${m[1]}.${m[2]}` : expr;
      if (seenCall.has(key)) continue;
      seenCall.add(key);
      qcalls.push(m ? { prop: m[1], method: m[2] } : { prop: "", method: (expr.match(/([A-Za-z_$][\w$]*)\s*$/) ?? ["", expr])[1] });
    }
    out.push({
      file: fileRel,
      name,
      kind,
      decorators: decoratorsOf(node),
      authCalls: (text.match(new RegExp(AUTH_CALL_RE.source, "g")) ?? []).slice(0, 6),
      sanitizeCalls: (text.match(new RegExp(SANITIZE_RE.source, "g")) ?? []).slice(0, 6),
      hasReqParam: REQ_RE.test(text),
      params: (node.getParameters?.() ?? []).map((p: any) => p.getText().slice(0, 40)).join(", ").slice(0, 160),
      qcalls,
    });
  };

  // 函数声明
  for (const fn of sf.getFunctions?.() ?? []) {
    const n = fn.getName();
    if (n) push(n, "function", fn);
  }
  // 变量箭头 / 函数表达式
  for (const v of sf.getVariableDeclarations?.() ?? []) {
    const init = v.getInitializer?.();
    if (!init) continue;
    if (init.getKind() === SyntaxKind.ArrowFunction || init.getKind() === SyntaxKind.FunctionExpression) {
      push(v.getName(), "arrow", init);
    }
  }
  // 类方法
  for (const cls of sf.getClasses?.() ?? []) {
    const cn = cls.getName() ?? "";
    for (const m of cls.getMethods?.() ?? []) {
      push(cn ? `${cn}.${m.getName()}` : m.getName(), "method", m);
    }
  }
  return out;
}

/* ---------------- 主流程 ---------------- */

const flag = (args: string[], name: string): string => {
  const i = args.indexOf(name);
  // indexOf 找不到返回 -1，-1+1=0 ⇒ 会把 args[0]（另一个 flag 名）当值读进来。
  // 第一版就栽在这：不传 --fn 时 onlyFn 变成了 "--repo"，目标数恒为 1。
  return i >= 0 && i + 1 < args.length ? args[i + 1] : "";
};

function main() {
  const args = process.argv.slice(2);
  const repo = flag(args, "--repo") || "docmost";
  const depth = Number(flag(args, "--depth") || 2);
  const onlyFn = flag(args, "--fn");

  const root = path.join(POOL, repo);
  if (!fs.existsSync(root)) {
    console.error(`[call-chain] 切片不存在: ${root}`);
    process.exit(1);
  }

  // 目标：从真值集里取该仓库的 UNKNOWN（这正是我们要救的那批）
  const goldPath = path.join(HERE, "fp-gold.jsonl");
  const targets: { fn: string; rule: string; file: string }[] = [];
  if (onlyFn) {
    targets.push({ fn: onlyFn, rule: "(manual)", file: "" });
  } else {
    for (const line of fs.readFileSync(goldPath, "utf8").trim().split("\n")) {
      const g = JSON.parse(line);
      if (g.repo !== repo) continue;
      if (g.gold !== "UNKNOWN") continue;
      targets.push({ fn: g.fn, rule: g.rule, file: g.file || "" });
    }
  }
  console.log(`[call-chain] repo=${repo} 目标（UNKNOWN）${targets.length} 条，depth=${depth}`);

  const project = new Project({
    compilerOptions: { allowJs: false, noResolve: true, target: 99 },
    skipAddingFilesFromTsConfig: true,
  });
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) files.push(p);
    }
  };
  walk(root);
  console.log(`[call-chain] 发现 ${files.length} 个源文件，加载中…`);

  let loaded = 0;
  const allFacts: Fact[] = [];
  for (const f of files) {
    try {
      const sf = project.addSourceFileAtPath(f);
      loaded++;
      const rel = path.relative(root, f);
      allFacts.push(...collectCallable(sf as any, rel));
    } catch (e) {
      // 单文件解析失败不影响整体（本机欠载常见）
    }
  }
  console.log(`[call-chain] 已加载 ${loaded} 文件，抽出 ${allFacts.length} 个 callable`);

  // 索引：全限定名（Class.method）与裸名
  const byFull = new Map<string, Fact[]>();
  const byBare = new Map<string, Fact[]>();
  for (const f of allFacts) {
    const full = byFull.get(f.name) ?? [];
    full.push(f);
    byFull.set(f.name, full);
    const bare = f.name.includes(".") ? f.name.split(".").pop()! : f.name;
    const arr = byBare.get(bare) ?? [];
    arr.push(f);
    byBare.set(bare, arr);
  }

  /**
   * 解析一次调用指向哪个定义。
   * 规则：① 有接收者 ⇒ 属性名首字母大写当类名（NestJS 注入惯例：attachmentService→AttachmentService）
   *       命中 Class.method 即为强边；② 否则裸名**唯一**才采信；③ 有歧义一律丢弃
   *       —— 宁可漏边，不可造假边（假边会让调用链视图直接不可用）。
   */
  const resolveCall = (q: QCall): Fact[] => {
    if (q.prop) {
      // 有接收者 ⇒ 只认强边，**绝不裸名兜底**。
      // 反例：`this.storageService.delete()` 里的 delete 若恰好在索引里唯一（比如只有
      // CommentController.delete），裸名兜底会把它误判成调用者。有接收者就说明
      // 调用指向的是那个类，不是我们。
      const cls = q.prop.charAt(0).toUpperCase() + q.prop.slice(1);
      return byFull.get(`${cls}.${q.method}`) ?? byFull.get(`${q.prop}.${q.method}`) ?? [];
    }
    // 无接收者（裸调用）⇒ 名字全局唯一才采信，有歧义丢弃
    const arr = byBare.get(q.method) ?? [];
    return arr.length === 1 ? arr : [];
  };

  /** 向上追溯调用者：谁调用了 targets 中任一定义 */
  const callersOf = (targets: Fact[], seen: Set<string>): Fact[] => {
    const tset = new Set(targets);
    const out: Fact[] = [];
    for (const f of allFacts) {
      if (tset.has(f)) continue;
      const key = `${f.file}|${f.name}`;
      if (seen.has(key)) continue;
      let hit = false;
      for (const q of f.qcalls) {
        if (resolveCall(q).some((r) => tset.has(r))) {
          hit = true;
          break;
        }
      }
      if (hit) {
        seen.add(key);
        out.push(f);
      }
    }
    return out;
  };

  const rows = targets.map((t) => {
    const bare = t.fn.includes(".") ? t.fn.split(".").pop()! : t.fn;
    // 类方法在索引里是 `Class.method`，gold 里只存裸名 ⇒ 必须允许后缀匹配，
    // 否则 self 为空 ⇒ 整条调用链从起点就断了（第一版就栽在这）。
    const self = allFacts.filter(
      (f) => f.name === t.fn || f.name === bare || f.name.endsWith("." + bare)
    );
    const seen = new Set<string>(self.map((f) => `${f.file}|${f.name}`));
    const layers: { depth: number; items: { file: string; name: string; decorators: string[]; authCalls: string[]; sanitizeCalls: string[]; hasReqParam: boolean }[] }[] = [];
    let frontier = self;
    for (let d = 1; d <= depth; d++) {
      const next = callersOf(frontier, seen);
      if (!next.length) break;
      layers.push({
        depth: d,
        items: next.slice(0, 12).map((c) => ({
          file: c.file,
          name: c.name,
          decorators: c.decorators.slice(0, 4),
          authCalls: c.authCalls,
          sanitizeCalls: c.sanitizeCalls,
          hasReqParam: c.hasReqParam,
        })),
      });
      frontier = next;
    }
    return {
      fn: t.fn,
      rule: t.rule,
      file: t.file,
      self: self.slice(0, 4).map((f) => ({
        file: f.file,
        name: f.name,
        kind: f.kind,
        decorators: f.decorators.slice(0, 6),
        params: f.params,
        authCalls: f.authCalls,
        sanitizeCalls: f.sanitizeCalls,
        hasReqParam: f.hasReqParam,
      })),
      callerLayers: layers,
      /** 关键派生事实：调用链上任意一层出现鉴权 / 入口痕迹 */
      chainHasAuth: layers.some((l) => l.items.some((i) => i.authCalls.length || i.decorators.some((d) => /UseGuards|RequireAuth|Permissions|Roles|Public/.test(d)))),
      chainHasRoute: layers.some((l) => l.items.some((i) => i.decorators.some((d) => /@(Get|Post|Put|Patch|Delete|Controller)\b/.test(d)))),
      chainHasReqParam: layers.some((l) => l.items.some((i) => i.hasReqParam)),
      chainDepthReached: layers.length,
    };
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = path.join(OUT_DIR, `call-chain-${repo}.json`);
  fs.writeFileSync(out, JSON.stringify({ repo, depth, files: loaded, callables: allFacts.length, rows }, null, 1));

  const deep = rows.filter((r) => r.chainDepthReached > 0).length;
  const auth = rows.filter((r) => r.chainHasAuth).length;
  const route = rows.filter((r) => r.chainHasRoute).length;
  const req = rows.filter((r) => r.chainHasReqParam).length;
  console.log(`\n[call-chain] 输出 ${out}`);
  console.log(`[call-chain] 目标 ${rows.length} 条`);
  console.log(`  至少追溯 1 层调用者  ${deep} 条`);
  console.log(`  调用链上见到鉴权痕迹 ${auth} 条`);
  console.log(`  调用链上见到路由入口 ${route} 条`);
  console.log(`  调用链上见到 req 参数 ${req} 条`);
}

main();
