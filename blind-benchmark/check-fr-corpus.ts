/**
 * 真实修复语料（fix-regression-corpus）pre/post 判别力复核闸门
 *
 * 为什么需要它：fr-007 的教训是「DETECTED 结论会随判别力变化」。
 * `fix-regression-corpus.json` 里记的 pre 5 / post 0 是**某一版引擎**的
 * measured 结果；改判别逻辑后必须重测，不能当一次性结论存档。
 * 而此前每次重测都要手工拉 codeload、手工数标记——步骤散落在会话里，
 * 一旦快照被清理（2026-09-19 的 /tmp 事故）就无从复现。
 *
 * 本脚本把「快照 → 提取 → 数标记 → 比对登记值」固化成一条命令：
 *   npx tsx blind-benchmark/check-fr-corpus.ts fr-007
 *
 * 快照约定：`blind-benchmark/fr-corpus/<id>-<repo>/{pre,post}/`
 * **受保护资产**：不得放在 /tmp 之类的可清理位置，不得整体删除。
 * 缺失时本脚本报错退出（不静默跳过 —— 静默跳过就是下一次空过）。
 *
 * 退出码 0 = pre/post 与登记值一致；非 0 = 有漂移（需人工判定是改进还是回归）。
 */

import * as fs from "fs";
import * as path from "path";
import { extractIR } from "../src/extract-ir";

const MARKER = "__progmune_path_traversal__";
const CORPUS = path.resolve(__dirname, "fix-regression-corpus.json");
const SNAPSHOTS = path.resolve(__dirname, "fr-corpus");

/** 登记值写在条目的 result_note 里（"pre 5 条 / post 0"），这里人工传入比对 */
const EXPECTED: Record<string, { pre: number; post: number }> = {
  "fr-007": { pre: 5, post: 0 },
  // 2026-09-19（3.7.38）：补全「文档解析产物」根 + sink 形参继承后，
  // fr-016 成为第二个有判别力的真实语料对。此前它是 pre 0 / post 0，
  // 不能当验证对（见设计稿 §三）；现在它有了判别力，可以被继续守卫。
  // 2026-09-20（3.7.39）5 → 7：C4b（项目自有纯塑形 helper 传播）接通
  // getFileNamePath(...) 这一跳，iterateAsyncApiComponents / iterateComponents
  // 由漏报转为检出。两条都是真阳性（恶意组件名带 ../ 逃出输出目录）。
  "fr-016": { pre: 7, post: 0 },
};

function markedFns(dir: string): string[] {
  const fns = extractIR(dir) as Array<{ name: string; file?: string; calls?: string[] }>;
  return fns
    .filter((f) => (f.calls || []).some((c) => c.includes(MARKER)))
    .map((f) => f.name)
    .sort();
}

function main(): number {
  const id = process.argv[2];
  if (!id) {
    console.error("用法：npx tsx blind-benchmark/check-fr-corpus.ts <fr-id> [fr-id...]");
    return 2;
  }
  const ids = process.argv.slice(2);
  const corpus = JSON.parse(fs.readFileSync(CORPUS, "utf-8"));
  const entries: any[] = corpus.entries;
  let bad = 0;

  for (const eid of ids) {
    const e = entries.find((x) => x.id === eid);
    if (!e) {
      console.error(`✗ ${eid}: 注册表里没有该条目`);
      bad++;
      continue;
    }
    const dirs = fs
      .readdirSync(SNAPSHOTS)
      .filter((d) => d.startsWith(`${eid}-`))
      .map((d) => path.join(SNAPSHOTS, d));
    if (dirs.length === 0) {
      console.error(`✗ ${eid}: fr-corpus/ 下没有快照目录（${eid}-<repo>/{pre,post}）`);
      console.error(`  重建命令（只取 ${e.ground_truth_files?.[0]?.split("/")[0] ?? "子包"} 所在目录）：`);
      for (const side of ["pre", "post"]) {
        const sha =
          side === "pre"
            ? (e.parent_commit as string)
            : (e.fix_commit as string);
        console.error(
          `    mkdir -p blind-benchmark/fr-corpus/${eid}-${String(e.repo).replace("/", "-")}/${side} && \\\n` +
            `    curl -sL https://codeload.github.com/${e.repo}/tar.gz/${sha} | \\\n` +
            `    tar -xz -C blind-benchmark/fr-corpus/${eid}-${String(e.repo).replace("/", "-")}/${side} --strip-components=1`
        );
      }
      bad++;
      continue;
    }
    const snap = dirs[0];
    console.log(`\n── ${eid} (${e.repo}) ──`);
    console.log(`   快照：${path.relative(process.cwd(), snap)}`);
    const got: Record<string, number> = {};
    for (const side of ["pre", "post"]) {
      const dir = path.join(snap, side);
      if (!fs.existsSync(dir)) {
        console.error(`✗ 缺少 ${side} 快照`);
        bad++;
        continue;
      }
      const fns = markedFns(dir);
      got[side] = fns.length;
      console.log(`   ${side.padEnd(4)} 标记 ${fns.length} 条：${fns.join(", ") || "（无）"}`);
    }
    const exp = EXPECTED[eid];
    if (exp) {
      for (const side of ["pre", "post"]) {
        if (got[side] === exp[side as "pre" | "post"]) continue;
        console.log(`   ! ${side}: 登记 ${exp[side as "pre" | "post"]} 条，实测 ${got[side]} 条 —— 需人工判定是判别力改进还是召回回归`);
        bad++;
      }
      console.log(`   登记值 pre ${exp.pre} / post ${exp.post}`);
    } else {
      console.log(`   （该条目未登记期望计数，仅打印实测值）`);
    }
    console.log(`   登记结论：${e.result}（${e.result_reason}）`);
  }

  return bad === 0 ? 0 : 1;
}

if (require.main === module) {
  process.exit(main());
}
