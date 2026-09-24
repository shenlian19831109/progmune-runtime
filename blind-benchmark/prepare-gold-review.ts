#!/usr/bin/env npx tsx
/**
 * prepare-gold-review.ts —— 真值补核的「素材准备」（R39：gold 必须可复核）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 为什么要有这个工具
 * ───────────────────────────────────────────────────────────────────────────
 * 真值集 verified 只有 12.96%（53/409），其中 **TP/verified 仅 11 条** —— 这是规则
 * 校准的最大瓶颈。补核的动作是「打开源码逐条判断」，而这一步此前靠 grep，会漏
 * 函数形态（E5 时吃过亏：`export const x = async () =>` 被文本探针漏掉）。
 *
 * 本工具只做**素材准备**，不做判定：用 ts-morph 准确定位每条待核条目的函数体，
 * 连同上下文（所在类、装饰器、文件头 import）一起落盘。判定仍由人（或带证据的
 * 复核者）做 —— 工具不产生 gold，只让 gold 的产生**可复核**。
 *
 * 为什么连上下文一起给
 * ───────────────────────────────────────────────────────────────────────────
 * 判 Input Validation 这类规则时，光看函数体不够：需要知道
 *   ① 它是不是 Controller（装饰器）⇒ 参数是不是外部输入
 *   ② 同文件里有没有全局校验中间件 ⇒ 函数体内没校验不代表没校验
 *   ③ 参数类型是不是 DTO（schema 校验在别处）
 * 所以上下文是判定依据的一部分，不是噪音。
 *
 * 用法
 *   npx tsx blind-benchmark/prepare-gold-review.ts [--gold TP] [--rule "Input Validation"]
 * 产物：blind-benchmark/reports/gold-review-pending.json
 */

import fs from "node:fs";
import path from "node:path";
import { Project, Node } from "ts-morph";

const HERE = __dirname;
const GOLD = path.join(HERE, "fp-gold.jsonl");
const POOL = path.join(HERE, "fp-pool");
const OUT = path.join(HERE, "reports", "gold-review-pending.json");

interface GoldRow {
  id: string;
  repo: string;
  fn: string;
  file: string;
  rule: string;
  calls: string[];
  lead?: string;
  shape?: string;
  gold: string;
  gold_confidence: string;
  gold_reason: string;
}

/** 定位一个函数（含类方法、箭头常量、对象方法），返回源码与上下文 */
function locate(project: Project, repoDir: string, file: string, fn: string) {
  const candidates = [path.join(repoDir, file), path.join(repoDir, "src", file)];
  const hit = candidates.find((p) => fs.existsSync(p));
  if (!hit) return { status: "NO_FILE" as const, tried: candidates };
  const sf = project.getSourceFile(hit) || project.addSourceFileAtPath(hit);
  const simple = fn.includes(".") ? fn.split(".").pop()! : fn;

  let node: any = null;
  for (const f of sf.getFunctions()) if (f.getName() === simple) node = f;
  if (!node) {
    for (const vd of sf.getVariableDeclarations()) {
      if (vd.getName() !== simple) continue;
      const init = vd.getInitializer();
      if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) node = init;
    }
  }
  if (!node) {
    for (const cls of sf.getClasses()) {
      for (const m of cls.getMethods()) {
        const full = `${cls.getName()}.${m.getName()}`;
        if (full === fn || m.getName() === simple) node = m;
      }
    }
  }
  if (!node) return { status: "NO_FN" as const, file: hit };

  const parent = node.getParent?.();
  const enclosingClass =
    parent && Node.isClassDeclaration(parent) ? parent.getName() : undefined;
  const decorators =
    (node.getDecorators?.() || []).map((d: any) => d.getText()).join(" ") ||
    (parent && Node.isClassDeclaration(parent)
      ? parent.getDecorators().map((d: any) => d.getText()).join(" ")
      : "") ||
    "";

  return {
    status: "OK" as const,
    file: path.relative(repoDir, hit),
    line: node.getStartLineNumber?.() ?? 0,
    enclosingClass,
    decorators,
    params: (node.getParameters?.() || []).map((p: any) => p.getText()).join(", "),
    body: (node.getText?.() ?? "").slice(0, 2200),
    // 上下文：文件级是否有全局校验中间件 / DTO import
    fileImports: sf
      .getImportDeclarations()
      .map((i) => i.getModuleSpecifierValue())
      .filter((m) => /valid|dto|schema|joi|zod|class-validator|guard|pipe|middle/i.test(m))
      .slice(0, 8),
  };
}

function main() {
  const args = process.argv.slice(2);
  const gi = args.indexOf("--gold");
  const ri = args.indexOf("--rule");
  const goldFilter = (gi >= 0 ? (args[gi + 1] || "") : "").toUpperCase();
  const ruleFilter = ri >= 0 ? args[ri + 1] || "" : "";

  const rows: GoldRow[] = fs
    .readFileSync(GOLD, "utf8")
    .trim()
    .split("\n")
    .map(JSON.parse)
    .filter((r: GoldRow) => {
      if (goldFilter && r.gold !== goldFilter) return false;
      if (goldFilter && r.gold_confidence === "verified") return false; // 已确证的不重核
      if (ruleFilter && !new RegExp(ruleFilter, "i").test(r.rule)) return false;
      return true;
    });

  console.log(`[prepare] 待核条目 ${rows.length}（gold=${goldFilter || "全部"} rule=${ruleFilter || "全部"}）`);

  const out: any[] = [];
  let ok = 0;
  for (const repo of [...new Set(rows.map((r) => r.repo))]) {
    const repoDir = path.join(POOL, repo);
    if (!fs.existsSync(repoDir)) {
      console.log(`  ! 池里没有 ${repo}`);
      continue;
    }
    const project = new Project({ skipAddingFilesFromTsConfig: true });
    for (const r of rows.filter((x) => x.repo === repo)) {
      const loc = locate(project, repoDir, r.file || "", r.fn);
      if (loc.status === "OK") ok++;
      out.push({
        id: r.id,
        repo: r.repo,
        fn: r.fn,
        rule: r.rule,
        current: { gold: r.gold, confidence: r.gold_confidence, reason: r.gold_reason },
        calls: (r.calls || []).slice(0, 14),
        lead: r.lead,
        shape: r.shape,
        loc,
      });
    }
  }
  console.log(`[prepare] 成功定位 ${ok} / ${rows.length}`);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`→ ${path.relative(process.cwd(), OUT)}`);
}

if (require.main === module) main();
