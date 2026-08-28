/**
 * Django 框架适配器盲测扫描器（M2）
 *
 * 对 generated-django/ 每个项目：结构扫描（tools/extract_framework_django.py）
 * → 规则判定（src/frameworks/django-detector.ts）→ 与 gold.json 预期比对。
 * 口径：检出 = (rule, handler) 精确匹配金标；FP = 检出但不在金标；
 *       FN = 金标有但未检出。确定性管线（无 LLM）。
 *
 * Usage: npx ts-node blind-benchmark/scan-protocol-django.ts
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { analyzeDjangoStructure } from "../src/frameworks/django-detector";

const GEN_DIR = path.resolve(__dirname, "generated-django");
const TOOL = path.resolve(__dirname, "..", "tools", "extract_framework_django.py");

function scan(projectDir: string): Array<{ rule: string; handler: string | null }> {
  const outPath = path.join(projectDir, ".fw-scan.json");
  execSync(`python3 "${TOOL}" "${projectDir}" "${outPath}"`, { encoding: "utf-8", stdio: "pipe" });
  const structure = JSON.parse(fs.readFileSync(outPath, "utf-8"));
  fs.unlinkSync(outPath);
  const { issues } = analyzeDjangoStructure(structure);
  return issues.map((i) => ({ rule: i.rule, handler: i.handler ?? null }));
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
    path.join(__dirname, "reports", "scan-protocol-django-results.json"),
    JSON.stringify({
      generated: new Date().toISOString(),
      method: "extract_framework_django.py + django-detector（确定性，无 LLM）",
      summary: { tp, fp, fn, precision, recall },
      rows,
    }, null, 2)
  );
  console.log("报告 → blind-benchmark/reports/scan-protocol-django-results.json");
}

main();
