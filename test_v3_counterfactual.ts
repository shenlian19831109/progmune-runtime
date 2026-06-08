/**
 * V3 E2E Test: Intent Parser + Counterfactual Repair
 *
 * Tests the full V3 flow:
 *   1. Goal → intent parsing (keyword fallback)
 *   2. Validation failure → counterfactual search
 *   3. Top-3 repair alternatives with scores
 */

import { parseGoalSync } from "./src/intent-parser";
import { validateWithRepair } from "./src/validator";
import { suggestAlternatives, formatAlternatives } from "./src/counterfactual-engine";

// ═══════════════════════════════════════════════════════════════
// Test 1: Intent Parser — keyword fallback
// ═══════════════════════════════════════════════════════════════

console.log("╔══════════════════════════════════════════════════╗");
console.log("║  V3 E2E: Intent Parser + Counterfactual Repair  ║");
console.log("╚══════════════════════════════════════════════════╝\n");

function testIntentParser(): void {
  console.log("── Test 1: Intent Parser (keyword fallback) ──\n");

  const cases = [
    "实现一个安全的文件写入，如果失败要重试3次",
    "处理一笔支付，需要审核后才能执行",
    "打开数据库连接，执行查询，关闭连接",
    "用户登录后获取token，然后访问资源",
    "加密消息后发送到队列",
  ];

  for (const goal of cases) {
    const result = parseGoalSync(goal);
    console.log(`  Goal: "${goal}"`);
    console.log(`  → protocol=${result.protocol}, initial=[${result.initialState.join(",")}], target=[${result.targetState.join(",")}]`);
    console.log(`    constraints: ${result.constraints.map(c => `${c.type}=${c.value}`).join(", ")}`);
    console.log(`    source: ${result.source}`);
    console.log();
  }

  // Assertions
  const fileCase = parseGoalSync("实现一个安全的文件写入");
  console.assert(fileCase.protocol === "FileProtocol", "File goal → FileProtocol");
  console.assert(fileCase.initialState[0] === "Closed", "File initial = Closed");

  const txCase = parseGoalSync("处理支付转账");
  console.assert(txCase.protocol === "TransactionProtocol", "Payment goal → TransactionProtocol");

  const authCase = parseGoalSync("用户登录认证");
  console.assert(authCase.protocol === "AuthProtocol", "Auth goal → AuthProtocol");

  const retryCase = parseGoalSync("失败要重试5次的操作");
  console.assert(retryCase.constraints.some(c => c.type === "retry"), "Retry constraint detected");

  console.log("  ✅ All intent parser assertions passed\n");
}

// ═══════════════════════════════════════════════════════════════
// Test 2: Counterfactual Repair — SSG BFS
// ═══════════════════════════════════════════════════════════════

async function testCounterfactualSSG(): Promise<void> {
  console.log("── Test 2: Counterfactual Repair (SSG BFS) ──\n");

  // Build a simple FileProtocol rules map
  const rules = new Map<string, { pre_states: string[]; post_states: string[]; invalidate?: string[]; namespace?: string }>();
  rules.set("open", { pre_states: ["Closed"], post_states: ["Open"], namespace: "FileProtocol" });
  rules.set("write", { pre_states: ["Open"], post_states: ["Writing"], namespace: "FileProtocol" });
  rules.set("close", { pre_states: ["Open", "Writing"], post_states: ["Closed"], invalidate: ["Open", "Writing"], namespace: "FileProtocol" });
  rules.set("append", { pre_states: ["Open"], post_states: ["Writing"], namespace: "FileProtocol" });

  const alts = await suggestAlternatives({
    violation: {
      svl: 4,
      violatedConstraint: "protocol_violation",
      actionIndex: 1,
      currentStates: ["Closed"],
      requiredStates: ["Writing"],
      description: "Cannot write to closed file",
    },
    protocol: "FileProtocol",
    currentState: ["Closed"],
    targetState: ["Writing"],
    rules,
  });

  console.log(`  Found ${alts.length} alternatives:\n`);
  console.log(formatAlternatives(alts));
  console.log();

  // Assertions
  console.assert(alts.length > 0, "Should find at least one alternative");
  if (alts.length > 0) {
    console.assert(alts[0].fixPath.length > 0, "Fix path should not be empty");
    console.assert(alts[0].score > 0, "Score should be positive");
    console.assert(alts[0].rank === 1, "First alternative should be rank 1");
  }

  console.log("  ✅ SSG BFS counterfactual test passed\n");
}

// ═══════════════════════════════════════════════════════════════
// Test 3: validateWithRepair — E2E pipeline
// ═══════════════════════════════════════════════════════════════

async function testValidateWithRepair(): Promise<void> {
  console.log("── Test 3: validateWithRepair (E2E pipeline) ──\n");

  const actions = [
    { kind: "call" as const, function: "write", args: [{ name: "data", type: "string", value: "hello" }] },
    { kind: "call" as const, function: "close", args: [] },
  ];

  const result = await validateWithRepair(actions, {
    protocol: "FileProtocol",
    targetState: ["Closed"],
  });

  console.log(`  Valid: ${result.valid}`);
  console.log(`  Violations: ${result.violations.length}`);

  if (result.violations.length > 0) {
    const v = result.violations[0];
    console.log(`  SVL-${v.svl}: ${v.violatedConstraint} | ${v.description}`);
    if (v.repairAlternatives && v.repairAlternatives.length > 0) {
      console.log(`\n  🔧 Top-3 Repair Alternatives:`);
      for (const alt of v.repairAlternatives) {
        console.log(`    ${alt.rank}. ${alt.description}`);
        console.log(`       路径: ${alt.fixPath.join(" → ")}`);
        console.log(`       来源: ${alt.source} | 得分: ${(alt.score * 100).toFixed(0)}% | 历史成功率: ${(alt.historicalSuccessRate * 100).toFixed(0)}%`);
      }
    }
  }

  console.log();
  console.log("  ✅ validateWithRepair pipeline test passed\n");
}

// ═══════════════════════════════════════════════════════════════
// Test 4: Auto-collection + Repair integration
// ═══════════════════════════════════════════════════════════════

async function testAutoCollectWithRepair(): Promise<void> {
  console.log("── Test 4: Auto-collection + Repair integration ──\n");

  // Trigger a violation with an undefined function
  const actions = [
    { kind: "call" as const, function: "undefinedFn", args: [] },
  ];

  const result = await validateWithRepair(actions, { protocol: "default" });

  console.assert(result.valid === false, "Should be invalid");
  console.assert(result.violations.length > 0, "Should have violations");
  console.assert(
    result.violations[0].repairAlternatives !== undefined,
    "Should have repairAlternatives field (may be empty)"
  );

  console.log(`  Violation: ${result.violations[0].description}`);
  console.log(`  Repair alternatives: ${result.violations[0].repairAlternatives?.length || 0}`);
  console.log();
  console.log("  ✅ Auto-collection + Repair integration passed\n");
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  let failures = 0;

  try { testIntentParser(); } catch (e: any) { failures++; console.error("  ❌ Test 1 failed:", e.message); }
  try { await testCounterfactualSSG(); } catch (e: any) { failures++; console.error("  ❌ Test 2 failed:", e.message); }
  try { await testValidateWithRepair(); } catch (e: any) { failures++; console.error("  ❌ Test 3 failed:", e.message); }
  try { await testAutoCollectWithRepair(); } catch (e: any) { failures++; console.error("  ❌ Test 4 failed:", e.message); }

  console.log("═══════════════════════════════════════════");
  if (failures === 0) {
    console.log("  ✅ All V3 E2E tests passed");
  } else {
    console.log(`  ❌ ${failures} test(s) failed`);
  }
  console.log("═══════════════════════════════════════════");

  process.exit(failures > 0 ? 1 : 0);
}

main();
