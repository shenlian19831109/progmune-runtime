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
exports.recordRun = recordRun;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const FEEDBACK_PATH = path.resolve(__dirname, "../feedback.json");
function loadFeedback() {
    if (!fs.existsSync(FEEDBACK_PATH))
        return [];
    return JSON.parse(fs.readFileSync(FEEDBACK_PATH, "utf-8"));
}
function saveFeedback(record) {
    const data = loadFeedback();
    data.push(record);
    fs.writeFileSync(FEEDBACK_PATH, JSON.stringify(data, null, 2));
}
function getFunctionSuccessRate(funcName) {
    const records = loadFeedback();
    const funcRecords = records.filter(r => r.functionName === funcName);
    if (funcRecords.length === 0)
        return 0.5; // 中性值
    const successCount = funcRecords.filter(r => r.success).length;
    return successCount / funcRecords.length;
}
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
