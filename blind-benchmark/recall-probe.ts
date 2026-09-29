/**
 * §49.17 召回对照探针 —— 对真实仓库做**全量** safeguard 扫描（2026-09-28）
 *
 * 背景：之前所有结论（精确率 6%、排序提升 2.4~6.4×）都建立在 `fp-gold.jsonl` 上，
 * 而那个池子**只包含扫描器报出来的告警** ⇒ 能算精确率，**算不出召回**。
 * §49.17 的正路是拿官方安全公告（GHSA）反查，所以要先有一份「我们在这些仓库上
 * 到底报了什么」的**全量清单**，才能判断一个已知漏洞是否被我们覆盖到。
 *
 * 与 xfn-signal-probe 的关系：同一套同刻提取（extractIRWithTypes +
 * detectSafeguardViolations，language="typescript"、传 paramTypes），
 * 差别只有两点：
 *   ① 输入是**真实全量仓库**而不是 fp-pool 切片；
 *   ② 输出**不过滤 exported**（召回测量要看工具的能力上限，不能先过滤一遍分母）。
 *      同时记 exported 标记，便于后续按「concentrate 口径」二次筛选。
 *
 * 用法：
 *   NODE_OPTIONS="--max-old-space-size=2048" PROGMUNE_HUB=off PROGMUNE_MAX_LLM_CALLS=0 \
 *     npx tsx blind-benchmark/recall-probe.ts <repoName>=<dir> [<repoName>=<dir> ...]
 *   # 输出 reports/advisories/fullscan-<repoName>.jsonl
 */
import * as fs from "fs";
import * as path from "path";
import { extractIRWithTypes } from "../src/extract-ir";
import { detectSafeguardViolations } from "../src/protocol-detector";

const OUT_DIR = path.resolve(__dirname, "reports", "advisories");

interface Row {
  repo: string;
  fn: string;
  bare: string;
  file: string;
  rule: string;
  rules: string[];
  nRules: number;
  calls: string[];
  params: Array<{ n: string; t: string }>;
  exported: boolean;
}

const targets = process.argv.slice(2).map((a) => {
  const i = a.indexOf("=");
  if (i < 0) throw new Error(`参数格式应为 <repoName>=<dir>，收到：${a}`);
  return { repo: a.slice(0, i), dir: path.resolve(a.slice(i + 1)) };
});
if (!targets.length) {
  console.error("用法：recall-probe.ts <repoName>=<dir> [...]");
  process.exit(1);
}

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

for (const { repo, dir } of targets) {
  if (!fs.existsSync(dir)) {
    console.log(`SKIP ${repo}: 目录不存在 ${dir}`);
    continue;
  }
  const t0 = Date.now();
  let funcs: any[] = [];
  try {
    const ir = extractIRWithTypes(dir);
    funcs = ir.functions.filter((f: any) => !f.external);
  } catch (e: any) {
    console.log(`FAIL ${repo}: ${String(e?.message ?? e).slice(0, 160)}`);
    continue;
  }
  const lines: string[] = [];
  let nAlert = 0;
  let nFnWithAlert = 0;
  for (const f of funcs) {
    const calls: string[] = f.calls || [];
    const params = (f.params || []).map((p: any) => ({
      n: String(p.name ?? ""),
      t: String(p.type ?? ""),
    }));
    let sv: any[] = [];
    try {
      sv = detectSafeguardViolations(
        calls,
        f.name,
        "typescript",
        params.map((p) => p.n),
        !!f.exported,
        params.map((p) => p.t)
      );
    } catch (e: any) {
      // 单函数异常不应中断全仓（记录但继续）
      continue;
    }
    if (!sv.length) continue;
    nFnWithAlert++;
    const rules = sv.map((v: any) => String(v.rule));
    for (const v of sv) {
      const row: Row = {
        repo,
        fn: String(f.name ?? ""),
        bare: String(f.name ?? "").split(".").pop() || "",
        file: String(f.file ?? ""),
        rule: String(v.rule),
        rules,
        nRules: rules.length,
        calls,
        params,
        exported: !!f.exported,
      };
      lines.push(JSON.stringify(row));
      nAlert++;
    }
  }
  const out = path.join(OUT_DIR, `fullscan-${repo}.jsonl`);
  fs.writeFileSync(out, lines.join("\n") + (lines.length ? "\n" : ""), "utf8");
  console.log(
    `  ${repo.padEnd(12)} 函数 ${String(funcs.length).padStart(5)}  命中函数 ${String(nFnWithAlert).padStart(4)}  告警 ${String(nAlert).padStart(5)}  ${((Date.now() - t0) / 1000).toFixed(1)}s`
  );
}
console.log(`\n[recall-probe] 输出目录 ${path.relative(process.cwd(), OUT_DIR)}`);
console.log("下一步：python3 blind-benchmark/advisory-match.py <repo>");
