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

/** @requires FUNCTION_NAME @produces SUCCESS_RATE */
export function getFunctionSuccessRate(funcName: string): number {
  const records = loadFeedback();
  const funcRecords = records.filter(r => r.functionName === funcName);
  if (funcRecords.length === 0) return 0.5; // 中性值
  const successCount = funcRecords.filter(r => r.success).length;
  return successCount / funcRecords.length;
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
