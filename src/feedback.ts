import * as fs from "fs";
import * as path from "path";
import { withLock } from "./file-lock";

interface RunRecord {
  intent: string;
  functionName: string;
  success: boolean;
  errorType?: string;
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
