"use strict";
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
exports.loadFeedback = loadFeedback;
exports.saveFeedback = saveFeedback;
exports.getFunctionSuccessRate = getFunctionSuccessRate;
exports.getWeightedSuccessRate = getWeightedSuccessRate;
exports.getFailureAdjustedCredit = getFailureAdjustedCredit;
exports.recordRun = recordRun;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const file_lock_1 = require("./file-lock");
const FEEDBACK_PATH = path.resolve(__dirname, "../feedback.json");
/** @requires CORPUS @produces FEEDBACK_DATA */
function loadFeedback() {
    if (!fs.existsSync(FEEDBACK_PATH))
        return [];
    return JSON.parse(fs.readFileSync(FEEDBACK_PATH, "utf-8"));
}
/** @requires FEEDBACK_EVENT @produces FEEDBACK_ID */
function saveFeedback(record) {
    (0, file_lock_1.withLock)("feedback.json", () => {
        const data = loadFeedback();
        data.push(record);
        fs.writeFileSync(FEEDBACK_PATH, JSON.stringify(data, null, 2));
    });
}
/** @requires FUNCTION_NAME @produces SUCCESS_RATE
 *  Flat success rate (all records equal weight). */
function getFunctionSuccessRate(funcName) {
    const records = loadFeedback();
    const funcRecords = records.filter(r => r.functionName === funcName);
    if (funcRecords.length === 0)
        return 0.5;
    const successCount = funcRecords.filter(r => r.success).length;
    return successCount / funcRecords.length;
}
/** @requires FUNCTION_NAME @produces WEIGHTED_SUCCESS_RATE
 *  Time-weighted success rate: recent results matter more.
 *  Decay: weight = 0.5^(age_days). */
function getWeightedSuccessRate(funcName) {
    const records = loadFeedback();
    const funcRecords = records
        .filter(r => r.functionName === funcName)
        .map(r => ({ ...r, age: (Date.now() - new Date(r.timestamp).getTime()) / 86400000 })); // age in days
    if (funcRecords.length === 0)
        return 0.5;
    let totalWeight = 0, weightedSuccess = 0;
    for (const r of funcRecords) {
        const w = Math.pow(0.5, Math.max(0, r.age)); // half-life = 1 day
        totalWeight += w;
        if (r.success)
            weightedSuccess += w;
    }
    return totalWeight > 0 ? weightedSuccess / totalWeight : 0.5;
}
/** @requires FUNCTION_NAME @produces FAILURE_ADJUSTED_CREDIT
 *  Credit score adjusted by failure severity with Laplace smoothing.
 *
 *  Laplace (add-1) smoothing eliminates small-sample bias:
 *    - 1/1 success → ~0.67 (not 1.0 — still uncertain)
 *    - 99/100 success → ~0.98 (approaches empirical rate)
 *    - 0/1 failure → ~0.33 (not 0.0 — allows redemption)
 *    - Cold start → 0.5 (neutral prior)
 *
 *  SVL-4 protocol violations are penalized 3× more than SVL-1.
 *  Time-weighted via exponential decay (half-life = 1 day). */
function getFailureAdjustedCredit(funcName) {
    const records = loadFeedback();
    const funcRecords = records
        .filter(r => r.functionName === funcName)
        .map(r => ({ ...r, age: (Date.now() - new Date(r.timestamp).getTime()) / 86400000 }));
    // Laplace prior: Beta(1,1) → pseudocount of 1 success + 1 failure
    const LAPLACE_PRIOR_SUCCESS = 1;
    const LAPLACE_PRIOR_TOTAL = 2;
    if (funcRecords.length === 0)
        return LAPLACE_PRIOR_SUCCESS / LAPLACE_PRIOR_TOTAL; // 0.5
    const SVL_PENALTY = {
        "SVL-1": 1.0, // missing function — minor
        "SVL-2": 1.5, // type mismatch — moderate
        "SVL-3": 2.0, // dataflow — significant
        "SVL-4": 3.0, // protocol — severe
    };
    let totalWeight = 0, weightedSuccess = 0;
    for (const r of funcRecords) {
        const timeW = Math.pow(0.5, Math.max(0, r.age));
        if (r.success) {
            totalWeight += timeW;
            weightedSuccess += timeW;
        }
        else {
            const penalty = SVL_PENALTY[r.svlLevel || ""] || 1.0;
            totalWeight += timeW * penalty;
            // weightedSuccess stays 0 for failures
        }
    }
    // Laplace smoothing: (success + 1) / (total + 2)
    return (weightedSuccess + LAPLACE_PRIOR_SUCCESS) / (totalWeight + LAPLACE_PRIOR_TOTAL);
}
/** @requires EXECUTION_DATA @produces RUN_ID */
function recordRun(intent, actions, success, error) {
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
