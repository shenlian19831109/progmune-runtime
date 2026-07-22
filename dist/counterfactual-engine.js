"use strict";
/**
 * P2: Counterfactual Repair Engine (V3)
 *
 * When validation fails, this engine:
 *   1. Searches Failure Corpus v2 for similar violation patterns
 *   2. BFS-searches the SSG for alternative legal state transition paths
 *   3. Ranks alternatives by: historical success rate → path length → reward weights
 *   4. Returns top-3 with human-readable explanations
 *
 * This is V3's killer feature: "告诉你三条修法"
 *
 * Architecture (refactored):
 *   Strategies (repair-strategies.ts) → Candidates → Ranker (repair-ranker.ts) → Top-3
 *
 * @requires VALIDATION_FAILURE @produces REPAIR_ALTERNATIVES
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.deduplicateCandidates = deduplicateCandidates;
exports.getRankerStatus = getRankerStatus;
exports.suggestAlternatives = suggestAlternatives;
exports.formatAlternatives = formatAlternatives;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const zeroshot_strategy_1 = require("./zeroshot-strategy");
const repair_strategies_1 = require("./repair-strategies");
const repair_ranker_1 = require("./repair-ranker");
const learning_ranker_1 = require("./learning-ranker");
const planner_telemetry_1 = require("./planner-telemetry");
const logistic_reward_1 = require("./logistic-reward");
// ═══════════════════════════════════════════════════════════════
// Cross-source evidence merge
// ═══════════════════════════════════════════════════════════════
/**
 * Deduplicate candidates by action signature, merging evidence sources.
 *
 * When the same repair path (e.g., "close_file") comes from
 * corpus + protocol + antibody, all three sources are recorded
 * in `evidenceSources`. This merged candidate has higher credibility
 * than any single-source candidate.
 *
 * This is a key input feature for the future Reward Model (P4).
 */
function deduplicateCandidates(candidates) {
    const groups = new Map();
    for (const c of candidates) {
        const key = c.actions
            .map(a => (a.kind === "call" ? a.function : a.kind))
            .join("→");
        const existing = groups.get(key);
        if (existing) {
            // Merge: combine evidence sources and take max evidence count
            const existingSources = existing.evidenceSources || [existing.source];
            const newSource = c.source;
            if (!existingSources.includes(newSource)) {
                existingSources.push(newSource);
            }
            existing.evidenceSources = existingSources;
            existing.evidence = Math.max(existing.evidence || 0, c.evidence || 0);
            // Merge metadata: highest historicalSuccessRate wins
            if (c.metadata?.historicalSuccessRate !== undefined &&
                (existing.metadata?.historicalSuccessRate === undefined ||
                    c.metadata.historicalSuccessRate > existing.metadata.historicalSuccessRate)) {
                existing.metadata = { ...existing.metadata, ...c.metadata };
            }
        }
        else {
            c.evidenceSources = [c.source];
            groups.set(key, c);
        }
    }
    return [...groups.values()];
}
// ═══════════════════════════════════════════════════════════════
// P7.3: Ranker Factory — env-var-driven ranker selection
// ═══════════════════════════════════════════════════════════════
let _activeLearningRanker = null;
let _rankerType = "heuristic";
let _modelWeight = 0.3;
let _modelSampleCount = 0;
let _rankerStartTime = 0;
/** Get (or create) the LearningRanker singleton with pre-trained model. */
function getActiveLearningRanker() {
    if (_activeLearningRanker)
        return _activeLearningRanker;
    _rankerType = "learning";
    _rankerStartTime = Date.now();
    _modelWeight = parseFloat(process.env.PROGMUNE_MODEL_WEIGHT || "0.3");
    const baseRanker = (0, repair_ranker_1.createLinearRanker)();
    const telemetry = new planner_telemetry_1.PlannerTelemetry();
    // Try to load pre-trained reward model from models/
    let rewardModel;
    try {
        const modelPath = path.resolve(process.env.PROGMUNE_PROJECT_DIR || process.cwd(), "models", "reward-model.json");
        if (fs.existsSync(modelPath)) {
            const data = JSON.parse(fs.readFileSync(modelPath, "utf-8"));
            rewardModel = logistic_reward_1.LogisticRewardModel.importWeights(data);
        }
    }
    catch {
        // No pre-trained model → fall back to telemetry-only learning
    }
    _modelSampleCount = (rewardModel ? rewardModel.sampleCount : 0);
    _activeLearningRanker = new learning_ranker_1.LearningRanker(baseRanker, telemetry, { baseWeight: 0.7, feedbackWeight: 0.3, minSamples: 5 }, rewardModel, _modelWeight);
    return _activeLearningRanker;
}
/** Return the current ranker status and metrics. */
function getRankerStatus() {
    return {
        type: _rankerType,
        modelWeight: _rankerType === "learning" ? _modelWeight : 0,
        modelSamples: _rankerType === "learning" ? _modelSampleCount : 0,
        uptimeSeconds: _rankerStartTime > 0 ? Math.round((Date.now() - _rankerStartTime) / 1000) : 0,
    };
}
// ═══════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════
/**
 * Generate the top-3 counterfactual repair alternatives for a violation.
 *
 * This is V3's killer feature: "告诉你三条修法"
 *
 * Internally delegates to Strategy → Candidate → Ranker pipeline.
 */
async function suggestAlternatives(params) {
    // 1. Build search context
    const ctx = {
        protocol: params.protocol || "default",
        currentState: (params.currentState?.length ?? 0) > 0
            ? params.currentState
            : params.violation.currentStates || [],
        targetState: (params.targetState?.length ?? 0) > 0
            ? params.targetState
            : (params.violation.requiredStates?.length ?? 0) > 0
                ? params.violation.requiredStates
                : [], // Keep empty to trigger cleanup path — don't fake COMPLETED
        violationType: params.violation.violatedConstraint || "protocol_violation",
        constraints: params.constraints || [],
        rules: params.rules || new Map(),
        goal: params.goal,
    };
    // 2. Run all strategies to collect candidates (no scoring in strategies)
    const strategies = (0, repair_strategies_1.createDefaultStrategies)();
    const allCandidates = [];
    for (const strategy of strategies) {
        allCandidates.push(...strategy.search(ctx));
    }
    // P8.3: If no candidates found, try ZeroShotStrategy
    if (allCandidates.length === 0) {
        const zeroShot = new zeroshot_strategy_1.ZeroShotStrategy();
        allCandidates.push(...zeroShot.search(ctx));
    }
    // 3. Deduplicate by action signature, merge evidence sources
    const uniqueCandidates = deduplicateCandidates(allCandidates);
    if (uniqueCandidates.length === 0)
        return [];
    // 4. Extract features and rank
    const maxActions = Math.max(...uniqueCandidates.map(c => c.actions.length), 8);
    const features = uniqueCandidates.map(c => (0, repair_ranker_1.extractFeatures)(c, ctx, { maxActions }));
    // P7.3: Ranker selection via PROGMUNE_RANKER env var
    //   "learning" → LearningRanker with pre-trained reward model
    //   "heuristic" (default) → LinearRanker with goalMatch weights
    const rankerType = process.env.PROGMUNE_RANKER || "heuristic";
    let ranked;
    if (rankerType === "learning") {
        const learner = getActiveLearningRanker();
        ranked = learner.rank(uniqueCandidates, features, {
            protocol: ctx.protocol,
            violationType: ctx.violationType,
        });
    }
    else {
        const ranker = (0, repair_ranker_1.createLinearRanker)();
        ranked = ranker.rankOverall(uniqueCandidates, features);
    }
    // 5. Map back to CounterfactualAlternative (backward-compat)
    const top3 = ranked.slice(0, 3);
    const alternatives = top3.map((c, i) => {
        // Re-extract features for the final ranked position
        const f = features[uniqueCandidates.indexOf(c)] ||
            (0, repair_ranker_1.extractFeatures)(c, ctx, { maxActions });
        // Score: use LearningRanker score if available, otherwise compute from LinearRanker
        const score = c.score !== undefined
            ? c.score
            : (0, repair_ranker_1.createLinearRanker)().score(f);
        return {
            rank: i + 1,
            description: c.explanation,
            fixPath: c.actions
                .filter(a => a.kind === "call")
                .map(a => a.function),
            targetState: ctx.targetState,
            score,
            source: c.source === "protocol" ? "ssg_bfs" : c.source,
            historicalSuccessRate: f.historicalSuccessRate,
            corpusEvidenceCount: f.corpusEvidence,
            satisfiedConstraints: ctx.constraints
                .filter(cn => (cn.type === "safety" || cn.type === "security") &&
                c.actions.length <= 5)
                .map(cn => cn.description),
            repairStrategy: c.metadata?.source,
        };
    });
    return alternatives;
}
/**
 * Format alternatives as human-readable text (for LLM prompts or CLI output).
 */
function formatAlternatives(alternatives) {
    if (alternatives.length === 0)
        return "未找到修复方案。";
    const lines = [];
    for (const alt of alternatives) {
        const badge = alt.source === "corpus"
            ? "📊 历史数据"
            : alt.source === "ssg_bfs"
                ? "🔍 协议搜索"
                : alt.source === "antibody"
                    ? "🛡️ 抗体规则"
                    : "🤖 LLM";
        lines.push(`方案 ${alt.rank}: ${alt.description}`);
        lines.push(`  路径: ${alt.fixPath.join(" → ")}`);
        lines.push(`  置信度: ${(alt.score * 100).toFixed(0)}% | ${badge}`);
        if (alt.historicalSuccessRate > 0) {
            lines.push(`  历史成功率: ${(alt.historicalSuccessRate * 100).toFixed(0)}% (${alt.corpusEvidenceCount} 案例)`);
        }
        if (alt.satisfiedConstraints.length > 0) {
            lines.push(`  满足约束: ${alt.satisfiedConstraints.join(", ")}`);
        }
    }
    return lines.join("\n");
}
// ═══════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════
if (require.main === module) {
    const testViolation = {
        svl: 4,
        violatedConstraint: "protocol_violation",
        actionIndex: 1,
        currentStates: ["Open"],
        requiredStates: ["Closed"],
        description: "文件未关闭",
    };
    suggestAlternatives({
        violation: testViolation,
        protocol: "FileProtocol",
        currentState: ["Open"],
        targetState: ["Closed"],
        constraints: [{ type: "safety", value: 0.8, description: "安全写入" }],
    }).then(alts => {
        console.log(formatAlternatives(alts));
    });
}
