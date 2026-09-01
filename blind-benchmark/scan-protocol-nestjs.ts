/**
 * NestJS 框架适配器盲测扫描器（补全轮）
 *
 * 对 generated-nestjs/ 每个项目：analyzeNestJSProject（ts-morph 项目级）
 * → 与 gold.json 预期比对。口径：检出 = (rule, handler) 精确匹配金标。
 *
 * Usage: npx ts-node blind-benchmark/scan-protocol-nestjs.ts
 */

import * as fs from "fs";
import * as path from "path";
import { analyzeNestJSProject } from "../src/frameworks/nestjs-detector";

const GEN_DIR = path.resolve(__dirname, "generated-nestjs");

function scan(projectDir: string): Array<{ rule: string; handler: string | null }> {
  const analysis = analyzeNestJSProject(projectDir);
  return analysis.issues.map((i) => ({
    rule: i.type,
    // 键约定：控制器.路径末段（检测器 issue 只携带 route 字符串）
    handler: i.controller
      ? `${i.controller}.${(i.route.split(" ")[1] || "").split("/").filter(Boolean).pop() || ""}`
      : null,
  }));
}

function main() {
  const gold = JSON.parse(
    fs.readFileSync(path.join(GEN_DIR, "gold.json"), "utf-8")
  ) as Array<{ id: string; gold: Array<{ rule: string; handler: string | null }> }>;

  let tp = 0, fp = 0, fn = 0;
  const rows: any[] = [];

  for (const g of gold) {
    const detected = scan(path.join(GEN_DIR, g.id));
    const detKey = (x: { rule: string; handler: string | null }) => `${x.rule}@${x.handler}`;
    const detSet = new Set(detected.map(detKey));
    const goldSet = new Set(g.gold.map(detKey));

    let rowTp = 0, rowFp = 0, rowFn = 0;
    for (const d of detected) {
      if (goldSet.has(detKey(d))) { rowTp++; tp++; }
      else { rowFp++; fp++; console.log(`  ✗FP ${g.id}: ${detKey(d)}`); }
    }
    for (const gg of g.gold) {
      if (!detSet.has(detKey(gg))) { rowFn++; fn++; console.log(`  ✗FN ${g.id}: ${detKey(gg)}`); }
    }
    rows.push({ ...g, detected, rowTp, rowFp, rowFn });
    console.log(`${g.id}: TP ${rowTp} / FP ${rowFp} / FN ${rowFn}`);
  }

  const precision = tp / (tp + fp) || 0;
  const recall = tp / (tp + fn) || 0;
  console.log(`\n总计：TP ${tp} / FP ${fp} / FN ${fn}`);
  console.log(`Precision ${(precision * 100).toFixed(1)}% / Recall ${(recall * 100).toFixed(1)}%`);

  fs.writeFileSync(
    path.join(__dirname, "reports", "scan-protocol-nestjs-results.json"),
    JSON.stringify({
      generated: new Date().toISOString(),
      method: "analyzeNestJSProject（ts-morph 项目级，确定性）",
      summary: { tp, fp, fn, precision, recall },
      rows,
    }, null, 2)
  );
  console.log("报告 → blind-benchmark/reports/scan-protocol-nestjs-results.json");
}

main();
