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
exports.replayLedger = exports.replaySession = exports.getMinimalFixSet = exports.generateRepairSummary = exports.validateProposal = exports.applyProposalAsBranch = exports.suggestInvariantRepair = exports.suggestProtocolRepair = exports.suggestRepairs = exports.describeBranchTree = exports.unwrapBranchTree = exports.wrapAsBranch = exports.findRootBranch = exports.buildBranchMap = exports.replayBranch = exports.getBranchPath = exports.flattenBranch = exports.mergeBranches = exports.forkBranch = exports.createBranch = exports.createRootBranch = exports.registerAllMissingFingerprints = exports.verifyAllFingerprints = exports.verifyFingerprint = exports.getFingerprintRegistry = exports.getFingerprint = exports.registerFingerprint = exports.assertLedgerInvariants = exports.assertTransitionOrder = exports.assertRuleHashMatch = exports.assertDeltaConsistency = exports.assertLedgerConsistency = exports.InvariantViolationError = exports.listAllStates = exports.findTransition = exports.findViolations = exports.findConsumer = exports.findProducer = exports.rejectionToJSON = exports.explainRejection = exports.diffLedgers = exports.hashLedger = exports.hashRules = exports.findFixPathStatic = exports.checkLedgerConsistency = exports.validateTransition = exports.applyTransitionDelta = exports.rebuildState = exports.parseProtocolsFromJSON = exports.StateMachineValidator = void 0;
exports.replayWithDetail = void 0;
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
// Phase 4: Invariant assertion layer
var runtime_invariants_1 = require("./runtime-invariants");
Object.defineProperty(exports, "InvariantViolationError", { enumerable: true, get: function () { return runtime_invariants_1.InvariantViolationError; } });
Object.defineProperty(exports, "assertLedgerConsistency", { enumerable: true, get: function () { return runtime_invariants_1.assertLedgerConsistency; } });
Object.defineProperty(exports, "assertDeltaConsistency", { enumerable: true, get: function () { return runtime_invariants_1.assertDeltaConsistency; } });
Object.defineProperty(exports, "assertRuleHashMatch", { enumerable: true, get: function () { return runtime_invariants_1.assertRuleHashMatch; } });
Object.defineProperty(exports, "assertTransitionOrder", { enumerable: true, get: function () { return runtime_invariants_1.assertTransitionOrder; } });
Object.defineProperty(exports, "assertLedgerInvariants", { enumerable: true, get: function () { return runtime_invariants_1.assertLedgerInvariants; } });
// Phase 4: Fingerprint Registry
var ledger_registry_1 = require("./ledger-registry");
Object.defineProperty(exports, "registerFingerprint", { enumerable: true, get: function () { return ledger_registry_1.registerFingerprint; } });
Object.defineProperty(exports, "getFingerprint", { enumerable: true, get: function () { return ledger_registry_1.getFingerprint; } });
Object.defineProperty(exports, "getFingerprintRegistry", { enumerable: true, get: function () { return ledger_registry_1.getFingerprintRegistry; } });
Object.defineProperty(exports, "verifyFingerprint", { enumerable: true, get: function () { return ledger_registry_1.verifyFingerprint; } });
Object.defineProperty(exports, "verifyAllFingerprints", { enumerable: true, get: function () { return ledger_registry_1.verifyAllFingerprints; } });
Object.defineProperty(exports, "registerAllMissingFingerprints", { enumerable: true, get: function () { return ledger_registry_1.registerAllMissingFingerprints; } });
// Phase 4: Branch Ledger
var branch_ledger_1 = require("./branch-ledger");
Object.defineProperty(exports, "createRootBranch", { enumerable: true, get: function () { return branch_ledger_1.createRootBranch; } });
Object.defineProperty(exports, "createBranch", { enumerable: true, get: function () { return branch_ledger_1.createBranch; } });
Object.defineProperty(exports, "forkBranch", { enumerable: true, get: function () { return branch_ledger_1.forkBranch; } });
Object.defineProperty(exports, "mergeBranches", { enumerable: true, get: function () { return branch_ledger_1.mergeBranches; } });
Object.defineProperty(exports, "flattenBranch", { enumerable: true, get: function () { return branch_ledger_1.flattenBranch; } });
Object.defineProperty(exports, "getBranchPath", { enumerable: true, get: function () { return branch_ledger_1.getBranchPath; } });
Object.defineProperty(exports, "replayBranch", { enumerable: true, get: function () { return branch_ledger_1.replayBranch; } });
Object.defineProperty(exports, "buildBranchMap", { enumerable: true, get: function () { return branch_ledger_1.buildBranchMap; } });
Object.defineProperty(exports, "findRootBranch", { enumerable: true, get: function () { return branch_ledger_1.findRootBranch; } });
Object.defineProperty(exports, "wrapAsBranch", { enumerable: true, get: function () { return branch_ledger_1.wrapAsBranch; } });
Object.defineProperty(exports, "unwrapBranchTree", { enumerable: true, get: function () { return branch_ledger_1.unwrapBranchTree; } });
Object.defineProperty(exports, "describeBranchTree", { enumerable: true, get: function () { return branch_ledger_1.describeBranchTree; } });
// Phase 4: Repair Proposal Engine
var repair_proposal_1 = require("./repair-proposal");
Object.defineProperty(exports, "suggestRepairs", { enumerable: true, get: function () { return repair_proposal_1.suggestRepairs; } });
Object.defineProperty(exports, "suggestProtocolRepair", { enumerable: true, get: function () { return repair_proposal_1.suggestProtocolRepair; } });
Object.defineProperty(exports, "suggestInvariantRepair", { enumerable: true, get: function () { return repair_proposal_1.suggestInvariantRepair; } });
Object.defineProperty(exports, "applyProposalAsBranch", { enumerable: true, get: function () { return repair_proposal_1.applyProposalAsBranch; } });
Object.defineProperty(exports, "validateProposal", { enumerable: true, get: function () { return repair_proposal_1.validateProposal; } });
Object.defineProperty(exports, "generateRepairSummary", { enumerable: true, get: function () { return repair_proposal_1.generateRepairSummary; } });
Object.defineProperty(exports, "getMinimalFixSet", { enumerable: true, get: function () { return repair_proposal_1.getMinimalFixSet; } });
// Phase 4: Deterministic Replay
var deterministic_replay_1 = require("./deterministic-replay");
Object.defineProperty(exports, "replaySession", { enumerable: true, get: function () { return deterministic_replay_1.replaySession; } });
Object.defineProperty(exports, "replayLedger", { enumerable: true, get: function () { return deterministic_replay_1.replayLedger; } });
Object.defineProperty(exports, "replayWithDetail", { enumerable: true, get: function () { return deterministic_replay_1.replayWithDetail; } });
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
