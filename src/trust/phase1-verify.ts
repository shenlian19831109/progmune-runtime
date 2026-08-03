/**
 * Phase 1 MVP Verification Script
 *
 * Tests the API → Protocol Semantic Mapper + Domain Validator
 * against all 25 B-class FPs from the curl benchmark.
 *
 * Expected outcome: all 25 FPs correctly classified as CLEAN,
 * proving that the semantic mapping layer eliminates B-class FPs.
 *
 * Run: npx ts-node --transpile-only src/trust/phase1-verify.ts
 */

import * as fs from "fs";
import * as path from "path";

// ═══════════════════════════════════════════════════════════════
// Inline the mapper and validator imports (avoid module resolution issues)
// ═══════════════════════════════════════════════════════════════

// We need to import from the mapper — use require for simplicity
const {
  mapSequenceToSemantic,
  isKnownProtocolDomain,
  mapApiToSemantic,
} = require("./api-semantic-mapper");

const {
  validateSemanticSequence,
  batchValidateSequences,
} = require("./protocol-domain-validator");

// ═══════════════════════════════════════════════════════════════
// B-class FP indices from our Phase 0 analysis
// ═══════════════════════════════════════════════════════════════

const B_CLASS_INDICES = new Set([
  4, 5, 11, 12, 15, 31, 34, 36, 42, 47, 48, 51, 52,
  55, 56, 60, 62, 63, 66, 67, 70, 78, 79, 81, 88,
]);

interface FpCase {
  index: number;
  calls: string[];
  expected: string;
  got: string;
}

function loadBenchmarkData(): { fps: FpCase[] } {
  const benchPath = path.resolve(__dirname, "../../benchmarks/reports/cross-repo-precision-latest.json");
  const data = JSON.parse(fs.readFileSync(benchPath, "utf-8"));
  const curl = data.repos.find((r: any) => r.repo === "curl");
  const mismatches = curl.mismatches.filter(
    (m: any) => m.expected === "clean" && m.got === "violation"
  );
  return {
    fps: mismatches.filter((m: any) => B_CLASS_INDICES.has(m.index)),
  };
}

// ═══════════════════════════════════════════════════════════════
// Main Validation
// ═══════════════════════════════════════════════════════════════

function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  Phase 1 MVP — B 类 FP 消除验证");
  console.log("═══════════════════════════════════════════════════════");
  console.log("");

  const { fps } = loadBenchmarkData();
  console.log(`加载 B 类 FP: ${fps.length} 个`);
  console.log("");

  // ── Individual FP analysis ──
  let eliminatedCount = 0;
  let stillFlaggedCount = 0;
  const stillFlagged: FpCase[] = [];
  const problematicMappings: Array<{ api: string; reason: string }> = [];

  for (const fp of fps) {
    const semantic = mapSequenceToSemantic(fp.calls);

    // Filter noise domains for display
    const significantSteps = semantic.steps.filter(
      s => s.domain !== "util" && s.domain !== "mem_util" && s.domain !== "str_util"
    );

    const validation = validateSemanticSequence(semantic);

    if (validation.valid) {
      eliminatedCount++;
    } else {
      stillFlaggedCount++;
      stillFlagged.push(fp);
    }

    // Check for problematic mappings (util fallbacks that should be known)
    for (const step of semantic.steps) {
      if (step.domain === "util" && step.source === "lookup") {
        // Only flag if it's a significant-looking API (not a common word)
        if (step.api.length > 3 && !/^(buffer|bytes|block|files|directories|size|seek|writing|secrets|handshake|allowed|conditions|status|keys|accessed|delay|secret|startup|argument|info|time|proc|set|get|part|chars|name|type|state|data|list|are|hostname|scheme|literal|failed)$/i.test(step.api)) {
          problematicMappings.push({
            api: step.api,
            reason: `API "${step.api}" maps to "util" — may need a mapping rule`,
          });
        }
      }
    }
  }

  // ── Results ──
  console.log("── 判定结果 ──");
  console.log(`  ✅ 正确判定为 CLEAN: ${eliminatedCount}/${fps.length} (${(eliminatedCount/fps.length*100).toFixed(1)}%)`);
  console.log(`  ❌ 仍然误报:       ${stillFlaggedCount}/${fps.length} (${(stillFlaggedCount/fps.length*100).toFixed(1)}%)`);
  console.log("");

  if (stillFlagged.length > 0) {
    console.log("── 仍然误报的 FP ──");
    for (const fp of stillFlagged) {
      const semantic = mapSequenceToSemantic(fp.calls);
      const validation = validateSemanticSequence(semantic);
      console.log(`  idx=${fp.index}: ${validation.reason}`);
      const domains = [...new Set(semantic.steps.map(s => s.domain))];
      console.log(`    domains: ${domains.join(", ")}`);
      console.log(`    primary: ${semantic.primaryDomain}`);
    }
    console.log("");
  }

  // ── Per-FP details ──
  console.log("── 逐条详情 ──");
  for (const fp of fps) {
    const semantic = mapSequenceToSemantic(fp.calls);
    const validation = validateSemanticSequence(semantic);
    const status = validation.valid ? "✅ CLEAN" : "❌ FLAGGED";
    console.log(`  ${status}  idx=${fp.index}  primary=${semantic.primaryDomain || "none"}  groups=${validation.groups.join(",") || "none"}`);
  }
  console.log("");

  // ── Problematic mappings ──
  if (problematicMappings.length > 0) {
    console.log("── 需要关注的映射 (映射为 util 的重要 API) ──");
    const unique = new Set(problematicMappings.map(m => m.api));
    for (const api of [...unique].sort()) {
      console.log(`  ⚠️  ${api}`);
    }
    console.log("");
  }

  // ── Overall Phase 1 assessment ──
  console.log("═══════════════════════════════════════════════════════");
  console.log("  Phase 1 MVP 判定");
  console.log("═══════════════════════════════════════════════════════");
  console.log("");

  const passThreshold = 20; // Phase 0 threshold: ≥20/25

  if (eliminatedCount >= passThreshold) {
    console.log(`  ✅ 通过！${eliminatedCount}/${fps.length} B 类 FP 被消除 (阈值: ${passThreshold})`);
    console.log("");
    console.log("  Phase 1 MVP 验证成功。语义映射层可以有效消除 B 类 FP。");

    if (eliminatedCount === fps.length) {
      console.log("  100% 消除率 — 所有 B 类 FP 都被正确识别为 CLEAN。");
    }

    console.log("");
    console.log("  下一步:");
    console.log("  1. 将映射层集成到 Trust Engine (修改 engine.ts)");
    console.log("  2. 在 curl 完整基准测试上验证精度提升");
    console.log("  3. Phase 2: 添加 C 类 FP 处理");
  } else {
    console.log(`  ❌ 未通过。${eliminatedCount}/${fps.length} < 阈值 ${passThreshold}`);
    console.log("  需要检查映射表和域验证逻辑。");
  }
}

main();
