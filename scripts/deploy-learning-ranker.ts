/**
 * deploy-learning-ranker.ts
 *
 * Offline training + artifact export for LearningRanker A/B deployment.
 *
 * Pipeline:
 *   1. Load trajectory corpus (2,348+ unique sequences)
 *   2. Convert trajectories → PlannerDecision → seed PlannerTelemetry
 *   3. Train LogisticRewardModel from telemetry decisions
 *   4. Build LearningRanker with trained model (modelWeight=0.5)
 *   5. Export model weights + config for production loading
 *
 * Usage:
 *   npx tsx scripts/deploy-learning-ranker.ts
 *   PROGMUNE_RANKER=learning PROGMUNE_MODEL_WEIGHT=0.5 npm start
 */

import * as fs from "fs";
import * as path from "path";
import { LogisticRewardModel } from "../src/logistic-reward";
import { PlannerTelemetry } from "../src/planner-telemetry";
import { LearningRanker, createLearningRanker } from "../src/learning-ranker";
import { createLinearRanker } from "../src/repair-ranker";
import { loadTrajectories } from "../src/failure-corpus";
import type { TrajectoryRecord } from "../src/runtime-types";
import type { PlannerDecision, CandidateStats } from "../src/planner-telemetry";

// ═══════════════════════════════════════════════════════════════
// Step 1: Load trajectory corpus
// ═══════════════════════════════════════════════════════════════

function loadCorpusStats() {
  const trajectories = loadTrajectories();
  const byResult = { success: 0, violation: 0, repair: 0, optimal: 0 };
  for (const t of trajectories) byResult[t.result] = (byResult[t.result] || 0) + 1;

  console.log("─── Trajectory Corpus ───");
  console.log(`  Total:       ${trajectories.length}`);
  console.log(`  Success:     ${byResult.success}`);
  console.log(`  Violation:   ${byResult.violation}`);
  console.log(`  Repair:      ${byResult.repair}`);
  console.log(`  Optimal:     ${byResult.optimal}`);
  console.log();

  return trajectories;
}

// ═══════════════════════════════════════════════════════════════
// Step 2: Convert trajectories → PlannerDecision → seed telemetry
// ═══════════════════════════════════════════════════════════════

function trajectoryToDecision(t: TrajectoryRecord): PlannerDecision | null {
  if (!t.trajectory || t.trajectory.length === 0) return null;

  const candidateId = `cand_${t.id}`;
  const accepted = t.feedback?.accepted === true || t.result === "success" || t.result === "optimal";
  const rejected = t.feedback?.rejected === true || t.result === "violation";
  const executionSuccess = t.result === "success" || t.result === "optimal";

  return {
    id: t.id,
    timestamp: new Date(t.timestamp).getTime(),
    goal: t.goal?.description || t.protocol || "unknown",
    protocol: t.protocol || "_global",
    violationType: t.violation?.type,
    candidates: [
      {
        candidateId,
        source: t.metadata?.source || "corpus",
        evidenceSources: t.violation?.fixPath || [],
        actions: t.trajectory,
        explanation: t.violation?.description || `Trajectory ${t.result}`,
      },
    ],
    selectedCandidateId: candidateId,
    feedback: {
      decision: accepted ? "accepted" : rejected ? "rejected" : "modified",
      executionResult: {
        success: executionSuccess,
        violations: t.violation?.description ? [t.violation.description] : [],
      },
      timestamp: new Date(t.timestamp).getTime(),
    },
    cost: {
      latencyMs: t.cost?.latency,
      actionCount: t.cost?.actions || t.trajectory.length,
    },
  };
}

function seedTelemetry(trajectories: TrajectoryRecord[]): PlannerTelemetry {
  const telemetry = new PlannerTelemetry();
  let seeded = 0;

  for (const t of trajectories) {
    const decision = trajectoryToDecision(t);
    if (!decision) continue;

    // Record the decision
    telemetry.recordDecision({
      goal: decision.goal,
      protocol: decision.protocol,
      violationType: decision.violationType,
      candidates: decision.candidates.map((c) => ({
        candidateId: c.candidateId,
        source: c.source,
        evidenceSources: c.evidenceSources,
        actions: c.actions,
        explanation: c.explanation,
      })),
      selectedCandidateId: decision.selectedCandidateId,
      feedback: decision.feedback,
      cost: decision.cost,
    });

    // Record execution result
    if (decision.feedback?.executionResult) {
      telemetry.recordExecutionResult(
        decision.id,
        decision.feedback.executionResult.success,
        decision.feedback.executionResult.violations,
        decision.cost?.latencyMs
      );
    }

    seeded++;
  }

  console.log(`─── Telemetry Seeded ───`);
  console.log(`  Decisions:    ${seeded}`);
  console.log(`  With feedback: ${telemetry.withFeedback}`);
  console.log(`  Acceptance:   ${(telemetry.getAcceptanceRate() * 100).toFixed(0)}%`);
  console.log();

  return telemetry;
}

// ═══════════════════════════════════════════════════════════════
// Step 3: Train LogisticRewardModel
// ═══════════════════════════════════════════════════════════════

function trainModel(telemetry: PlannerTelemetry): LogisticRewardModel {
  console.log("─── Training LogisticRewardModel ───");

  const model = LogisticRewardModel.train(telemetry, {
    learningRate: 0.01,
    epochs: 200,
    l2Lambda: 0.001,
    batchSize: 32,
    minSamples: 10,
    convergenceThreshold: 1e-4,
  });

  console.log(`  Trained:      ${model.isTrained}`);
  console.log(`  Samples:      ${model.sampleCount}`);
  console.log(`  Final Loss:   ${model.finalLoss.toFixed(4)}`);
  console.log(`  Weights:      [${model.weights.map((w) => w.toFixed(4)).join(", ")}]`);
  console.log(`  Bias:         ${model.bias.toFixed(4)}`);
  console.log();

  // Feature importance
  console.log("─── Feature Importance ───");
  for (const fi of model.featureImportance()) {
    const bar = "█".repeat(Math.round(fi.importance * 20));
    console.log(`  ${fi.name.padEnd(24)} ${fi.weight.toFixed(4).padStart(8)}  ${bar}`);
  }
  console.log();

  return model;
}

// ═══════════════════════════════════════════════════════════════
// Step 4: Build LearningRanker
// ═══════════════════════════════════════════════════════════════

function buildRanker(telemetry: PlannerTelemetry, model: LogisticRewardModel): {
  ranker: LearningRanker;
  config: Record<string, unknown>;
} {
  console.log("─── Building LearningRanker ───");

  const baseRanker = createLinearRanker({
    safety: 0.4,
    successRate: 0.3,
    performance: 0.2,
    auditability: 0.1,
  });

  const modelWeight = 0.5;
  const rankerConfig = { baseWeight: 0.7, feedbackWeight: 0.3, minSamples: 5 };

  const learningRanker = new LearningRanker(
    baseRanker,
    telemetry,
    rankerConfig,
    model,
    modelWeight
  );

  // Quick sanity: rank the top candidates by stats
  const allStats = telemetry.getAllCandidateStats();
  const topCandidates = [...allStats.entries()]
    .sort((a, b) => {
      const ar = (a[1].accepted / Math.max(1, a[1].accepted + a[1].rejected));
      const br = (b[1].accepted / Math.max(1, b[1].accepted + b[1].rejected));
      return br - ar;
    })
    .slice(0, 5);

  console.log(`  Base ranker:   LinearRanker (safety=0.4, success=0.3, perf=0.2, audit=0.1)`);
  console.log(`  Model weight:  ${modelWeight}`);
  console.log(`  Config:        ${JSON.stringify(rankerConfig)}`);
  console.log(`  Top candidates by acceptance:`);
  for (const [fp, stats] of topCandidates) {
    const acc = stats.accepted / Math.max(1, stats.accepted + stats.rejected);
    console.log(`    ${fp.slice(0, 40).padEnd(42)} acc=${(acc * 100).toFixed(0)}%  n=${stats.accepted + stats.rejected}`);
  }
  console.log();

  return {
    ranker: learningRanker,
    config: { modelWeight, ...rankerConfig },
  };
}

// ═══════════════════════════════════════════════════════════════
// Step 5: Export artifacts for production
// ═══════════════════════════════════════════════════════════════

function exportArtifacts(
  model: LogisticRewardModel,
  rankerConfig: Record<string, unknown>
): void {
  const projectDir = process.env.PROGMUNE_PROJECT_DIR || process.cwd();
  const modelsDir = path.resolve(projectDir, "models");
  const configDir = path.resolve(projectDir, "config");

  fs.mkdirSync(modelsDir, { recursive: true });
  fs.mkdirSync(configDir, { recursive: true });

  // Export model weights
  const weightsData = model.exportWeights();
  const modelPath = path.join(modelsDir, "reward-model.json");
  fs.writeFileSync(modelPath, JSON.stringify(weightsData, null, 2));
  console.log(`  Model:    ${modelPath}`);

  // Export ranker config
  const configPath = path.join(configDir, "ranker-config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        ranker: "learning",
        ...rankerConfig,
        exportedAt: new Date().toISOString(),
        sampleCount: model.sampleCount,
        finalLoss: model.finalLoss,
      },
      null,
      2
    )
  );
  console.log(`  Config:   ${configPath}`);

  // Export feature importance for observability
  const fiPath = path.join(modelsDir, "feature-importance.json");
  fs.writeFileSync(
    fiPath,
    JSON.stringify(
      model.featureImportance().map((fi) => ({
        name: fi.name,
        weight: fi.weight,
        importance: fi.importance,
      })),
      null,
      2
    )
  );
  console.log(`  Features: ${fiPath}`);
  console.log();
}

// ═══════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════

async function main() {
  console.log("\n╔════════════════════════════════════════════════════╗");
  console.log("║   LearningRanker — Offline Training & Deployment   ║");
  console.log("╚════════════════════════════════════════════════════╝\n");

  // 1. Load corpus
  const trajectories = loadCorpusStats();

  // 2. Seed telemetry from trajectory records
  const telemetry = seedTelemetry(trajectories);

  // 3. Train reward model
  const model = trainModel(telemetry);

  // 4. Build LearningRanker
  const { config: rankerConfig } = buildRanker(telemetry, model);

  // 5. Export artifacts
  console.log("─── Exporting Deployment Artifacts ───");
  exportArtifacts(model, rankerConfig);

  // 6. Print deployment instructions
  console.log("─── A/B Test Deployment ───");
  console.log("  Phase 1 — Offline Replay:");
  console.log("    npx vitest run tests/p7-simulation/user-simulation.test.ts");
  console.log();
  console.log("  Phase 2 — 5% Canary:");
  console.log("    PROGMUNE_RANKER=learning PROGMUNE_MODEL_WEIGHT=0.3 npm start");
  console.log();
  console.log("  Phase 3 — 50% Ramp:");
  console.log("    PROGMUNE_RANKER=learning PROGMUNE_MODEL_WEIGHT=0.5 npm start");
  console.log();
  console.log("  Phase 4 — Full Switch (after 7-day observation):");
  console.log("    PROGMUNE_RANKER=learning PROGMUNE_MODEL_WEIGHT=0.5 \\");
  console.log("      PROGMUNE_RANKER_MIN_SAMPLES=3 npm start");
  console.log();
  console.log("  Monitor: tail -f .progmune_corpus/telemetry/decisions.jsonl");
  console.log();
}

main().catch((err) => {
  console.error("Deployment failed:", err);
  process.exit(1);
});
