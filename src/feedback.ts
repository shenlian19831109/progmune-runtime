import * as fs from "fs";
import * as path from "path";
import { withLock } from "./file-lock";

interface RunRecord {
  intent: string;
  functionName: string;
  success: boolean;
  errorType?: string;
  /** SVL level if this was a constraint violation */
  svlLevel?: string;
  timestamp: string;
}

const FEEDBACK_PATH = path.resolve(__dirname, "../feedback.json");

/** @requires CORPUS @produces FEEDBACK_DATA */
export function loadFeedback(): RunRecord[] {
  if (!fs.existsSync(FEEDBACK_PATH)) return [];
  return JSON.parse(fs.readFileSync(FEEDBACK_PATH, "utf-8"));
}

/** @requires FEEDBACK_EVENT @produces FEEDBACK_ID */
export function saveFeedback(record: RunRecord) {
  withLock("feedback.json", () => {
    const data = loadFeedback();
    data.push(record);
    fs.writeFileSync(FEEDBACK_PATH, JSON.stringify(data, null, 2));
  });
}

/** @requires FUNCTION_NAME @produces SUCCESS_RATE
 *  Flat success rate (all records equal weight). */
export function getFunctionSuccessRate(funcName: string): number {
  const records = loadFeedback();
  const funcRecords = records.filter(r => r.functionName === funcName);
  if (funcRecords.length === 0) return 0.5;
  const successCount = funcRecords.filter(r => r.success).length;
  return successCount / funcRecords.length;
}

/** @requires FUNCTION_NAME @produces WEIGHTED_SUCCESS_RATE
 *  Time-weighted success rate: recent results matter more.
 *  Decay: weight = 0.5^(age_days). */
export function getWeightedSuccessRate(funcName: string): number {
  const records = loadFeedback();
  const funcRecords = records
    .filter(r => r.functionName === funcName)
    .map(r => ({ ...r, age: (Date.now() - new Date(r.timestamp).getTime()) / 86400000 })); // age in days
  if (funcRecords.length === 0) return 0.5;
  let totalWeight = 0, weightedSuccess = 0;
  for (const r of funcRecords) {
    const w = Math.pow(0.5, Math.max(0, r.age)); // half-life = 1 day
    totalWeight += w;
    if (r.success) weightedSuccess += w;
  }
  return totalWeight > 0 ? weightedSuccess / totalWeight : 0.5;
}

/** @requires FUNCTION_NAME @produces FAILURE_ADJUSTED_CREDIT
 *  Credit score adjusted by failure severity.
 *  SVL-4 (protocol) violations penalize 2x more than SVL-1.
 *  Time-weighted + severity-weighted. */
export function getFailureAdjustedCredit(funcName: string): number {
  const records = loadFeedback();
  const funcRecords = records
    .filter(r => r.functionName === funcName)
    .map(r => ({ ...r, age: (Date.now() - new Date(r.timestamp).getTime()) / 86400000 }));
  if (funcRecords.length === 0) return 1.0; // cold start: no penalty without evidence

  const SVL_PENALTY: Record<string, number> = {
    "SVL-1": 1.0,   // missing function — minor
    "SVL-2": 1.5,   // type mismatch — moderate
    "SVL-3": 2.0,   // dataflow — significant
    "SVL-4": 3.0,   // protocol — severe
  };

  let totalWeight = 0, weightedSuccess = 0;
  for (const r of funcRecords) {
    const timeW = Math.pow(0.5, Math.max(0, r.age));
    if (r.success) {
      totalWeight += timeW;
      weightedSuccess += timeW;
    } else {
      const penalty = SVL_PENALTY[r.svlLevel || ""] || 1.0;
      totalWeight += timeW * penalty;
      // weightedSuccess stays 0 for failures
    }
  }
  return totalWeight > 0 ? weightedSuccess / totalWeight : 1.0;
}

/** @requires EXECUTION_DATA @produces RUN_ID */
export function recordRun(intent: string, actions: any[], success: boolean, error?: string) {
  for (const action of actions) {
    if (action.kind === "call") {
      saveFeedback({
        intent,
        functionName: action.function,
        success,
        errorType: error ? error.split("\n")[0] : undefined,
        timestamp: new Date().toISOString(),
      });
    }
  }
}
