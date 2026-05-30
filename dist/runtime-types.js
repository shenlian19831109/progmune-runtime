"use strict";
// Runtime Ontology — Progmune 执行语义的 formal type system
// 所有 runtime primitive 的单一定义源
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
exports.listAllStates = exports.findTransition = exports.findViolations = exports.findConsumer = exports.findProducer = exports.rejectionToJSON = exports.explainRejection = exports.diffLedgers = exports.hashLedger = exports.hashRules = exports.findFixPathStatic = exports.checkLedgerConsistency = exports.validateTransition = exports.applyTransitionDelta = exports.rebuildState = exports.parseProtocolsFromJSON = exports.StateMachineValidator = void 0;
exports.generateAttemptId = generateAttemptId;
exports.generateSessionId = generateSessionId;
exports.generatePlannerSeed = generatePlannerSeed;
const crypto = __importStar(require("crypto"));
var ssg_validator_1 = require("./ssg-validator");
Object.defineProperty(exports, "StateMachineValidator", { enumerable: true, get: function () { return ssg_validator_1.StateMachineValidator; } });
Object.defineProperty(exports, "parseProtocolsFromJSON", { enumerable: true, get: function () { return ssg_validator_1.parseProtocolsFromJSON; } });
// Phase 3: Semantic Ledger pure functions (re-exported from ssg-validator)
var ssg_validator_2 = require("./ssg-validator");
Object.defineProperty(exports, "rebuildState", { enumerable: true, get: function () { return ssg_validator_2.rebuildState; } });
Object.defineProperty(exports, "applyTransitionDelta", { enumerable: true, get: function () { return ssg_validator_2.applyTransitionDelta; } });
Object.defineProperty(exports, "validateTransition", { enumerable: true, get: function () { return ssg_validator_2.validateTransition; } });
Object.defineProperty(exports, "checkLedgerConsistency", { enumerable: true, get: function () { return ssg_validator_2.checkLedgerConsistency; } });
Object.defineProperty(exports, "findFixPathStatic", { enumerable: true, get: function () { return ssg_validator_2.findFixPathStatic; } });
Object.defineProperty(exports, "hashRules", { enumerable: true, get: function () { return ssg_validator_2.hashRules; } });
Object.defineProperty(exports, "hashLedger", { enumerable: true, get: function () { return ssg_validator_2.hashLedger; } });
Object.defineProperty(exports, "diffLedgers", { enumerable: true, get: function () { return ssg_validator_2.diffLedgers; } });
Object.defineProperty(exports, "explainRejection", { enumerable: true, get: function () { return ssg_validator_2.explainRejection; } });
Object.defineProperty(exports, "rejectionToJSON", { enumerable: true, get: function () { return ssg_validator_2.rejectionToJSON; } });
Object.defineProperty(exports, "findProducer", { enumerable: true, get: function () { return ssg_validator_2.findProducer; } });
Object.defineProperty(exports, "findConsumer", { enumerable: true, get: function () { return ssg_validator_2.findConsumer; } });
Object.defineProperty(exports, "findViolations", { enumerable: true, get: function () { return ssg_validator_2.findViolations; } });
Object.defineProperty(exports, "findTransition", { enumerable: true, get: function () { return ssg_validator_2.findTransition; } });
Object.defineProperty(exports, "listAllStates", { enumerable: true, get: function () { return ssg_validator_2.listAllStates; } });
// ── ID生成工具 ──
function generateAttemptId() {
    return `att_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}
function generateSessionId() {
    return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}
function generatePlannerSeed(prompt, model) {
    return crypto.createHash("md5").update(`${prompt}|${model}|${Date.now()}`).digest("hex").slice(0, 8);
}
