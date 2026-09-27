/**
 * §49.12 排序信号提取器 —— 找与「谁调用它」**正交**的信号（2026-09-28）
 *
 * 背景：§49.9 的三个判据方向全被否决，只剩排序。§49.10 用「链上是否撞到请求入口」
 * 这一条信号试排，结论是前 10% 密度 0%、不可用。但那个 0% 是**评估器的错**：
 * 稳定排序保留了输入顺序，而 TP 恰好全排在列表尾部（见 §49.12 的顺序伪影检验）——
 * 随机打散后同一分组的期望密度是 19.2%，不是 0。尺子修好之前，任何新信号都不能量。
 *
 * 所以本探针换一个方向找信号。已有信号（inDeg / reachReq / reachAuth …）全部描述
 * **「谁调用了它」**——那是调用图层面的事实。与之正交的一族信号描述
 * **「这个函数自身做了什么」**：它有没有防护证据、有没有直接操作数据、参数是什么类型。
 *
 * 三条硬约束（违反任何一条，算出来的信号都不能落地）：
 *   ① **只输出原始特征，不打分。** 打分策略放 rank-signals.py 里迭代，避免每改一次
 *      打分就重跑一遍全池（本机 8GB，跑一次几分钟）。
 *   ② **信号必须能在产品拿到的输入上算出来。** 产品路径每个函数能拿到的是
 *      FunctionInfo：name / file / params[{name,type}] / calls / exported。IR 里
 *      **没有**装饰器、没有函数体文本 ⇒ 任何依赖它们的信号都落不了地，不采。
 *      （calls 里带 __progmune_*__ 语义标记，是提取器注入的，可以放心用。）
 *   ③ **同刻提取，不用冻结母本。** 直接调 src 的 extractIRWithTypes +
 *      detectSafeguardViolations 现场扫（R73：reports 里的旧 results 不是同刻基线）。
 *      判据参数与 fp-pool-scan 完全一致（language="typescript"、传 paramTypes）。
 *
 * 与 gold 的连接在 python 侧做 —— 探针不知道真值，避免「为了让结论好看而改匹配」。
 *
 * 用法：
 *   NODE_OPTIONS="--max-old-space-size=2048" PROGMUNE_HUB=off PROGMUNE_MAX_LLM_CALLS=0 \
 *     npx tsx blind-benchmark/xfn-signal-probe.ts [输出路径]
 */
import * as fs from "fs";
import * as path from "path";
import { extractIRWithTypes } from "../src/extract-ir";
import { detectSafeguardViolations } from "../src/protocol-detector";
import { computeExposed, isExposed } from "./fp-pool-scan";

const POOL_DIR = path.resolve(__dirname, "fp-pool");
const OUT = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(__dirname, "reports/xfn-49-signals.jsonl");

interface Row {
  repo: string;
  /** IR 里的完整名（类方法是 "Class.method"） */
  fn: string;
  /** 去掉类名前缀的裸名，供匹配兜底 */
  bare: string;
  file: string;
  rule: string;
  /** 该函数命中的**全部**规则（用于 nRules 与「同函数多规则」信号） */
  rules: string[];
  nRules: number;
  calls: string[];
  params: Array<{ n: string; t: string }>;
  exported: boolean;
}

const lines: string[] = [];
const repos = fs
  .readdirSync(POOL_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

let nFn = 0;
let nAlert = 0;

for (const repo of repos) {
  const dir = path.join(POOL_DIR, repo);
  let funcs: any[] = [];
  try {
    const ir = extractIRWithTypes(dir);
    funcs = ir.functions.filter((f: any) => !f.external);
  } catch (e: any) {
    console.log(`FAIL ${repo}: ${String(e?.message || e).slice(0, 140)}`);
    continue;
  }
  const exposed = computeExposed(funcs);
  let rAlert = 0;
  for (const f of funcs.filter((f: any) => f.exported)) {
    nFn++;
    const calls: string[] = f.calls || [];
    const params = (f.params || []).map((p: any) => ({
      n: String(p.name ?? ""),
      t: String(p.type ?? ""),
    }));
    // 与 fp-pool-scan 完全同口径（language 必传 "typescript"、传 params 与 paramTypes）
    const sv = detectSafeguardViolations(
      calls,
      f.name,
      "typescript",
      params.map((p) => p.n),
      isExposed(f.name, exposed),
      params.map((p) => p.t)
    );
    if (!sv.length) continue;
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
      rAlert++;
    }
  }
  console.log(`  ${repo.padEnd(46)} 函数 ${String(funcs.length).padStart(4)}  告警 ${rAlert}`);
}

fs.writeFileSync(OUT, lines.join("\n") + "\n", "utf8");
console.log(
  `\n[xfn-signal-probe] 输出 ${path.relative(process.cwd(), OUT)}  ` +
    `函数 ${nFn} / 告警 ${nAlert} / 仓库 ${repos.length}`
);
console.log("下一步：python3 blind-benchmark/rank-signals.py <此文件> blind-benchmark/fp-gold.jsonl");
