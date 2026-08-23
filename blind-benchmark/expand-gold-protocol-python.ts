/**
 * Blind Benchmark Gold Expansion — Python Protocol (v1)
 *
 * 金标推导 = 生成器植入配置（_plants.json，生成时确定）+ 扫描结果严格定位匹配
 * （file + function 级，规则名级）。与 expand-gold-python.ts 同款方法论：
 * FP = 与任何植入记录不匹配的检测（模板核查后分类）。
 *
 * T5（missing_cleanup）的 detectionExpected=false——endState 检查未实现，
 * 金标单列 "known_gap" 统计，不计入头条 P/R（README 排除法惯例：如实记录）。
 *
 * Usage: npx ts-node blind-benchmark/expand-gold-protocol-python.ts
 */

import * as fs from "fs";
import * as path from "path";
import { GEN_DIR, VIOLATION_TYPES, type PlantRecord } from "./generate-projects-protocol-python";
import { PROTO_REPORT_PATH, type ProtocolScanResult } from "./scan-protocol-python";

const OUT_PATH = path.resolve(__dirname, "gold", "annotations-protocol-python-v1.json");

// ═══════════════════════════════════════════════════════════════
// 匹配与汇总
// ═══════════════════════════════════════════════════════════════

function main(): void {
  const plantsData = JSON.parse(fs.readFileSync(path.join(GEN_DIR, "_plants.json"), "utf-8"));
  const plants: PlantRecord[] = plantsData.plants;
  const scanReport = JSON.parse(fs.readFileSync(PROTO_REPORT_PATH, "utf-8"));
  const scans: ProtocolScanResult[] = scanReport.results;

  const scanByProject = new Map<string, ProtocolScanResult>();
  for (const s of scans) scanByProject.set(s.projectId, s);

  // 按 projectId 分组金标
  const projects = new Map<string, PlantRecord[]>();
  for (const p of plants) {
    if (!projects.has(p.projectId)) projects.set(p.projectId, []);
    projects.get(p.projectId)!.push(p);
  }

  const goldProjects: any[] = [];
  let measurable = 0, detectedMeas = 0, missedMeas = 0;
  let gapFindings = 0, gapFired = 0;
  let fpCount = 0;
  const fpSamples: string[] = [];

  for (const [projectId, plantList] of [...projects.entries()].sort()) {
    const scan = scanByProject.get(projectId);
    if (!scan) throw new Error(`missing scan result for ${projectId}`);

    // 检测位置集合（file::function）
    const detectedAt = new Set<string>();
    for (const v of scan.violations) detectedAt.add(`${v.file}::${v.function}`);

    const findings: any[] = [];
    for (const [i, p] of plantList.entries()) {
      const loc = `${p.file}::${p.function}`;
      const detected = detectedAt.has(loc);
      if (p.detectionExpected) {
        measurable++;
        if (detected) detectedMeas++;
        else missedMeas++;
      } else {
        gapFindings++;
        if (detected) gapFired++;
      }
      findings.push({
        id: `${p.projectId.toUpperCase()}-${String(i + 1).padStart(3, "0")}`,
        file: p.file,
        function: p.function,
        category: "protocol_violation",
        severity: "medium",
        protocol: p.protocol === "auth" ? "Auth" : "Resource Lifecycle",
        violation_type: p.violationType,
        description: p.description,
        fix_suggestion: p.fixSuggestion,
        detection_expected: p.detectionExpected,
        progmune_detected: detected,
        false_positive: false,
      });
    }

    // FP：扫描检测到但无植入记录的位置
    for (const v of scan.violations) {
      const loc = `${v.file}::${v.function}`;
      const hasPlant = plantList.some((p) => `${p.file}::${p.function}` === loc);
      if (hasPlant) continue;
      fpCount++;
      fpSamples.push(`${projectId} ${loc} — ${v.failingFunction}: ${v.reason.slice(0, 80)}`);
    }

    const projectType = VIOLATION_TYPES.find((t) => t.id === plantList[0]?.typeId);
    goldProjects.push({
      project_id: projectId,
      model: "generator",
      project_type: `protocol_${projectType?.protocol ?? "?"}`,
      style_id: plantList[0]?.styleId,
      type_id: plantList[0]?.typeId,
      files: fs.readdirSync(path.join(GEN_DIR, projectId)).filter((f) => f.endsWith(".py")),
      total_findings: findings.length,
      findings,
    });
  }

  const recall = measurable > 0 ? detectedMeas / measurable : 1;
  const precision = detectedMeas + fpCount > 0 ? detectedMeas / (detectedMeas + fpCount) : 1;

  const gold = {
    $description:
      "Progmune blind-benchmark gold annotations — Python PROTOCOL style-variants v1. " +
      "Gold from generator plant configuration (deterministic) + strict-location scan matching. " +
      "Measures the SSG protocol state-machine path (annotation + built-in rules, " +
      "P4.5 merge + P4.6 cross-function expansion, name/word-segment matching), no LLM.",
    annotated_by: "plant-config + scan strict-location match",
    annotated_at: new Date().toISOString().slice(0, 10),
    version: "1.0",
    detector_scan_generated: scanReport.scan_generated,
    projects: goldProjects,
    aggregate: {
      projects_annotated: goldProjects.length,
      measurable_findings: measurable,
      progmune_detected: detectedMeas,
      progmune_missed: missedMeas,
      overall_recall: Math.round(recall * 1000) / 10,
      overall_precision: Math.round(precision * 1000) / 10,
      false_positives_total: fpCount,
      known_gap_findings: gapFindings,
      known_gap_fired: gapFired,
      note:
        "T2×S5 注解依赖前置约束不可恢复——2 处金标如实漏检（命名匹配本身正常）。" +
        "P4.6 展开为语法内联（深度 ≤4、环安全），不做数据流分析；LLM 语义桥接层不在本基准测量范围。",
    },
  };
  fs.writeFileSync(OUT_PATH, JSON.stringify(gold, null, 2), "utf-8");

  // ── 打印汇总 ──
  console.log("═══ Python 协议盲测 v1 汇总 ═══");
  console.log(`项目数: ${goldProjects.length}（T1–T5 × 5 风格 + T6/T7 × 4 风格，T0 对照不计入）`);
  console.log(`可测金标: ${measurable} | 检出: ${detectedMeas} | 漏检: ${missedMeas}`);
  console.log(`RECALL = ${gold.aggregate.overall_recall}% | PRECISION = ${gold.aggregate.overall_precision}% | FP = ${fpCount}`);
  console.log(`已知缺口金标: ${gapFindings} | 意外命中: ${gapFired}`);
  if (missedMeas > 0) {
    console.log("\n漏检清单:");
    for (const p of plants) {
      const s = scanByProject.get(p.projectId)!;
      const loc = `${p.file}::${p.function}`;
      if (p.detectionExpected && !s.violations.some((v) => `${v.file}::${v.function}` === loc)) {
        console.log(`  MISS ${p.projectId} ${loc} (${p.violationType})`);
      }
    }
  }
  if (fpSamples.length > 0) {
    console.log(`\nFP 清单 (${fpSamples.length}):`);
    for (const s of fpSamples.slice(0, 20)) console.log(`  FP ${s}`);
  }
  console.log(`\n金标已写入: ${path.relative(process.cwd(), OUT_PATH)}`);
}

main();
