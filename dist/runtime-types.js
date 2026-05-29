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
exports.parseProtocolsFromJSON = exports.StateMachineValidator = void 0;
exports.generateAttemptId = generateAttemptId;
exports.generateSessionId = generateSessionId;
exports.generatePlannerSeed = generatePlannerSeed;
const crypto = __importStar(require("crypto"));
var ssg_validator_1 = require("./ssg-validator");
Object.defineProperty(exports, "StateMachineValidator", { enumerable: true, get: function () { return ssg_validator_1.StateMachineValidator; } });
Object.defineProperty(exports, "parseProtocolsFromJSON", { enumerable: true, get: function () { return ssg_validator_1.parseProtocolsFromJSON; } });
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
