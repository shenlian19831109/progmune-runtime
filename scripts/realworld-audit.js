#!/usr/bin/env node
/**
 * realworld-audit.js — 真实语料考核一键工具（方法论固化，2026-09-02）
 *
 * 用途：对任意真实开源项目（URL 或本地路径）跑某个框架检测器的完整
 * 考核：clone/vendor → 扫描 → JSON 报告（路由/规则/逐条 flags）→
 * 金标标注模板。以后新增检测器/语言（Java/Spring 等）一律先过此工具。
 *
 * 用法：
 *   npm run audit:realworld -- --framework fiber --repo https://github.com/mrusme/journalist
 *   npm run audit:realworld -- --framework gin  --repo ./benchmarks/go-apps/gin-realworld
 *
 * 选项：
 *   --framework  检测器：express|fastify|koa|hapi|nextjs|nestjs|trpc|gin|fiber
 *                |fastapi|django|flask（python 三件套需 python3 + tools/*.py）
 *   --repo       git URL 或本地目录（本地目录不再 clone）
 *   --name       语料名（默认取 URL 最后一段 / 目录名）
 *
 * 产物：
 *   blind-benchmark/reports/realworld-audit-<name>.json   扫描报告
 *   blind-benchmark/reports/realworld-audit-<name>.gold.md 金标标注模板（人工逐条标注用）
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

// ── 参数 ──
const argv = process.argv.slice(2);
const getArg = (flag) => {
  const i = argv.indexOf("--" + flag);
  return i !== -1 ? argv[i + 1] : undefined;
};
const framework = getArg("framework");
let repo = getArg("repo");
const nameArg = getArg("name");
if (!framework || !repo) {
  console.error("用法: node scripts/realworld-audit.js --framework <detector> --repo <url|dir> [--name slug]");
  console.error("detector:", "express|fastify|koa|hapi|nextjs|nestjs|trpc|gin|fiber|spring|fastapi|django|flask");
  process.exit(1);
}

const CACHE_ROOT = path.join(__dirname, "..", "benchmarks", "audit-cache");
const REPORTS_DIR = path.join(__dirname, "..", "blind-benchmark", "reports");

// ── vendor / 定位语料根 ──
let corpusRoot = repo;
let slug = nameArg;
const isUrl = /^https?:\/\//.test(repo);
if (isUrl) {
  slug = slug || repo.replace(/\/+$/, "").split("/").pop().replace(/\.git$/, "");
  corpusRoot = path.join(CACHE_ROOT, slug);
  if (!fs.existsSync(corpusRoot)) {
    fs.mkdirSync(CACHE_ROOT, { recursive: true });
    console.log(`[vendor] git clone --depth 1 ${repo} → ${corpusRoot}`);
    try {
      execSync(`git clone --depth 1 ${repo} ${corpusRoot}`, { stdio: "inherit", cwd: __dirname });
    } catch (e) {
      console.error(`[vendor] clone 失败（URL 不存在或网络）：${e.message.split("\n")[0]}`);
      process.exit(1);
    }
  } else {
    console.log(`[vendor] 已存在（复用）: ${corpusRoot}`);
  }
} else {
  slug = slug || path.basename(repo.replace(/\/+$/, ""));
}

// ── 文件遍历 ──
function walk(dir, extRe, skip = ["node_modules", ".git", "vendor", "dist", "build", "__pycache__", "test", "tests", ".venv", "venv", "env"]) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (skip.includes(e.name)) continue;
      out.push(...walk(fp, extRe, skip));
    } else if (extRe.test(e.name)) out.push(fp);
  }
  return out;
}
const needsModuleReset = (f) => { delete require.cache[require.resolve(f)]; return require(f); };

// ── 各检测器 runner：统一返回 { files, routes, issues: [{rule,route,file}] } ──
const runners = {
  express: (root) => {
    const { analyzeExpressFile } = require("../dist/frameworks/express-detector.js");
    const files = walk(root, /\.(ts|js)$/, ["node_modules", ".git", "test", "tests", "dist", "build"]);
    const issues = [];
    let routes = 0, apps = 0;
    for (const f of files) {
      try {
        const a = analyzeExpressFile(f);
        if (a && a.hasExpress) { apps++; routes += a.routes.length; a.issues.forEach((i) => issues.push({ rule: i.rule, route: i.route || "", file: f.replace(root, "") })); }
      } catch { /* skip */ }
    }
    return { files: files.length, routes, issues };
  },
  fastify: (root) => {
    const { analyzeFastifyFile } = require("../dist/frameworks/fastify-detector.js");
    const files = walk(root, /\.(js|ts)$/, ["node_modules", ".git", "test", "tests", "dist"]);
    const issues = []; let routes = 0;
    for (const f of files) { try {
      const a = analyzeFastifyFile(f);
      if (a && a.hasFastify) { routes += a.routes.length; a.issues.forEach((i) => issues.push({ rule: i.rule, route: i.route || "", file: f.replace(root, "") })); }
    } catch {} }
    return { files: files.length, routes, issues };
  },
  koa: (root) => {
    const { analyzeKoaFile } = require("../dist/frameworks/koa-detector.js");
    const files = walk(root, /\.(js|ts)$/, ["node_modules", ".git", "test", "tests", "dist"]);
    const issues = []; let routes = 0;
    for (const f of files) { try {
      const a = analyzeKoaFile(f);
      if (a && a.hasKoa) { routes += a.routes.length; a.issues.forEach((i) => issues.push({ rule: i.rule, route: i.route || "", file: f.replace(root, "") })); }
    } catch {} }
    return { files: files.length, routes, issues };
  },
  hapi: (root) => {
    const { analyzeHapiFile } = require("../dist/frameworks/hapi-detector.js");
    const files = walk(root, /\.(js|ts)$/, ["node_modules", ".git", "test", "tests"]);
    const issues = []; let routes = 0;
    for (const f of files) { try {
      const a = analyzeHapiFile(f);
      if (a && a.hasHapi) { routes += a.routes.length; a.issues.forEach((i) => issues.push({ rule: i.rule, route: i.route || "", file: f.replace(root, "") })); }
    } catch {} }
    return { files: files.length, routes, issues };
  },
  nextjs: (root) => {
    const { analyzeNextApp, readNextMiddleware } = require("../dist/frameworks/nextjs-detector.js");
    const mw = readNextMiddleware(root);
    const a = analyzeNextApp(root, mw);
    return { files: (a.routeFiles || []).length, routes: a.routeFiles.length, issues: a.issues.map((i) => ({ rule: i.rule, route: i.route || i.file || "", file: i.file || "" })) };
  },
  nestjs: (root) => {
    const { analyzeNestJSProject } = require("../dist/frameworks/nestjs-detector.js");
    const a = analyzeNestJSProject(root);
    return { files: a.controllers.length, routes: a.routes.length, issues: a.issues.map((i) => ({ rule: i.type || "?", route: i.route || "", file: i.controller || "" })) };
  },
  trpc: (root) => {
    const files = walk(root, /\.(ts|tsx)$/, ["node_modules", ".git", "test", "tests", "__tests__", "dist"]);
    const issues = []; let routes = 0;
    for (const f of files) { try {
      const { analyzeTRPCFile } = needsModuleReset("../dist/frameworks/trpc-detector.js");
      const a = analyzeTRPCFile(f);
      if (a.hasTRPC) { routes += a.procedures.length; a.issues.forEach((i) => issues.push({ rule: i.rule, route: i.procedure || "", file: f.replace(root, "") })); }
    } catch {} }
    return { files: files.length, routes, issues };
  },
  gin: (root) => {
    const { analyzeGinProject } = require("../dist/frameworks/gin-detector.js");
    const a = analyzeGinProject(root);
    return { files: a.filesScanned, routes: 0, issues: a.issues.map((i) => ({ rule: i.rule, route: i.route || "", file: "" })) };
  },
  fiber: (root) => {
    const { analyzeFiberProject } = require("../dist/frameworks/fiber-detector.js");
    const a = analyzeFiberProject(root);
    return { files: a.filesScanned, routes: 0, issues: a.issues.map((i) => ({ rule: i.rule, route: i.route || "", file: "" })) };
  },
  spring: (root) => {
    const { analyzeSpringProject } = require("../dist/frameworks/spring-detector.js");
    const a = analyzeSpringProject(root);
    return { files: a.filesScanned, routes: a.routes.length, issues: a.issues.map((i) => ({ rule: i.rule, route: i.route || "", file: "" })) };
  },
  fastapi: (root) => py("extract_framework_py.py", root, "analyzeFastapiStructure"),
  django: (root) => py("extract_framework_django.py", root, "analyzeDjangoStructure"),
  flask: (root) => py("extract_framework_flask.py", root, "analyzeFlaskStructure"),
};

function py(tool, root, analyzeFn) {
  const out = path.join(REPORTS_DIR, `.audit-tmp-${tool}.json`);
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  try {
    execSync(`python3 ${path.join(__dirname, "..", "tools", tool)} ${JSON.stringify(root)} ${JSON.stringify(out)}`, { stdio: "ignore" });
  } catch (e) {
    return { files: 0, routes: 0, issues: [{ rule: "TOOL_ERROR", route: String(e.message || e).slice(0, 200), file: "" }] };
  }
  const data = JSON.parse(fs.readFileSync(out, "utf-8"));
  // 模块名推导：extract_framework_py.py → fastapi-detector（py 是 fastapi 提取器的历史文件名）
  const modBase = tool.replace("extract_framework_", "").replace(".py", "");
  const { [analyzeFn]: fn } = require("../dist/frameworks/" + (modBase === "py" ? "fastapi" : modBase) + "-detector.js");
  const res = fn(data);
  const routes = (data.routes || []).length;
  return { files: data.filesScanned || 0, routes, issues: (res.issues || []).map((i) => ({ rule: i.rule, route: i.route || "", file: i.file || i.handler || "" })) };
}

// ── 执行 ──
const runner = runners[framework];
if (!runner) { console.error("未知检测器:", framework); process.exit(1); }
fs.mkdirSync(REPORTS_DIR, { recursive: true });
console.log(`[scan] ${framework} ← ${corpusRoot}`);
const res = runner(corpusRoot);
const byRule = {};
for (const i of res.issues) byRule[i.rule] = (byRule[i.rule] || 0) + 1;
const report = {
  tool: "realworld-audit v1",
  date: new Date().toISOString().slice(0, 10),
  framework, corpus: slug, repo,
  filesScanned: res.files, routesOrProcs: res.routes, issuesTotal: res.issues.length,
  byRule, issues: res.issues.slice(0, 200),
};
const jsonPath = path.join(REPORTS_DIR, `realworld-audit-${slug}.json`);
fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
console.log(`[report] ${jsonPath}`);
console.log(`files=${res.files} routes=${res.routes} issues=${res.issues.length} byRule=${JSON.stringify(byRule)}`);

// ── 金标标注模板 ──
const goldPath = path.join(REPORTS_DIR, `realworld-audit-${slug}.gold.md`);
const rows = res.issues.slice(0, 100).map((i, n) => `| ${n + 1} | ${i.rule} | ${i.route} | ${i.file} |  | `).join("\n");
fs.writeFileSync(goldPath, `# Real-World Audit — ${framework} @ ${slug}

> 语料：${repo}（vendored ${corpusRoot}）。生成：${report.date}。
> 方法：真实语料 → 检测器扫描 → **逐条人工金标标注** → 反证实验。

## 扫描

| 项 | 值 |
|----|----|
| 文件 | ${res.files} |
| 路由/过程 | ${res.routes} |
| issues | ${res.issues.length} ${JSON.stringify(byRule)} |

## 逐条标注（人工）

| # | 规则 | 路由 | 文件 | 标注(TP/FP/加固类/能力令牌) | 依据 |
|---|------|------|------|------------------------------|------|
${rows || "（无 flags——需人工核实 0 flags 是否空洞：金标是否全受保护 + 摘保护反证）"}

## 反证实验清单（人工执行）

1. **敏感性**：摘掉某条受保护 mutation 的认证 → 应报（若无反应 = 失明）
2. **0 flags 空洞检查**：语料金标是否全受保护（若全保护则 0 flags 正确；否则漏报）
3. **register/login 公开**：豁免词表是否正确放过
`);
console.log(`[gold-template] ${goldPath}`);
