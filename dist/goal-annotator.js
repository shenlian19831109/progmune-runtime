"use strict";
/**
 * P1: Goal Skeleton — Async Goal Annotator
 *
 * Converts natural language goals to structured GoalRecords via LLM.
 * Non-blocking, best-effort, 500ms timeout. Falls back to keyword extraction
 * on failure. This is a DATA FLYWHEEL, not a reasoning system.
 *
 * Principle: collect (goal, trajectory, outcome) pairs now,
 *            mine Goal Graphs from data later.
 *
 * @requires GOAL_TEXT @produces GOAL_RECORD
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.annotateGoal = annotateGoal;
exports.annotateGoalBackground = annotateGoalBackground;
const llm_1 = require("./llm");
const intent_parser_1 = require("./intent-parser");
const TIMEOUT_MS = 500;
// ═══════════════════════════════════════════════════════════════
// LLM extraction prompt
// ═══════════════════════════════════════════════════════════════
const ANNOTATION_PROMPT = `Extract structured goal info as JSON. Output ONLY the JSON object:

{
  "protocol": "<FileProtocol|TransactionProtocol|DatabaseProtocol|AuthProtocol|default>",
  "initial_state": "<starting state>",
  "target_state": "<desired end state>",
  "constraints": ["<constraint1>", "<constraint2>"]
}

Examples:
"safely write config file" → {"protocol":"FileProtocol","initial_state":"Closed","target_state":"Closed","constraints":["must persist data","must not violate protocol"]}
"transfer money with audit" → {"protocol":"TransactionProtocol","initial_state":"Pending","target_state":"Settled","constraints":["audit required","compliance"]}

Goal: `;
// ═══════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════
/**
 * Annotate a natural language goal asynchronously.
 * Best-effort: LLM with 500ms timeout, falls back to keyword parser.
 * Returns immediately with a GoalRecord (never throws).
 */
async function annotateGoal(goalText) {
    // Try LLM extraction with timeout
    try {
        const llmResult = await Promise.race([
            (0, llm_1.generate)(ANNOTATION_PROMPT + `"${goalText}"`),
            new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS)),
        ]);
        const jsonMatch = llmResult.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            return {
                text: goalText,
                protocol: parsed.protocol || "default",
                initial_state: parsed.initial_state || "INIT",
                target_state: parsed.target_state || "COMPLETED",
                constraints: parsed.constraints || [],
                method: "llm_extracted",
                confidence: 0.85,
            };
        }
    }
    catch {
        // LLM timeout or parse error → fall through to keyword
    }
    // Fallback: keyword-based extraction
    try {
        const keywordResult = (0, intent_parser_1.parseGoalSync)(goalText);
        return {
            text: goalText,
            protocol: keywordResult.protocol,
            initial_state: keywordResult.initialState[0] || "INIT",
            target_state: keywordResult.targetState[0] || "COMPLETED",
            constraints: keywordResult.constraints.map(c => c.description),
            method: "inferred",
            confidence: 0.5,
        };
    }
    catch {
        // Complete failure
        return {
            text: goalText,
            protocol: "default",
            initial_state: "INIT",
            target_state: "COMPLETED",
            constraints: [],
            method: "failed",
            confidence: 0,
        };
    }
}
/**
 * Fire-and-forget async annotation.
 * Call this from the main flow — it runs in background and never blocks.
 * The annotated goal is written to the trajectory record on next collection.
 */
function annotateGoalBackground(goalText, onAnnotated) {
    annotateGoal(goalText).then(onAnnotated).catch(() => {
        // Silent — annotation failure must never surface to user
    });
}
// ═══════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════
if (require.main === module) {
    const goal = process.argv[2] || "safely write config file";
    annotateGoal(goal).then(result => {
        console.log(JSON.stringify(result, null, 2));
    });
}
