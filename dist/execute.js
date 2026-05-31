"use strict";
/**
 * Phase 5: Semantic Execution Kernel
 *
 * Single entry point: intent → validated code → file written → audit verified.
 * Wires together: IR extraction → Planner → EmitCode → Fingerprint.
 *
 * This is what progmune_execute MCP tool calls internally.
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
exports.execute = execute;
exports.verifyFileMarker = verifyFileMarker;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const planner_1 = require("./planner");
const extract_ir_1 = require("./extract-ir");
const emitter_1 = require("./emitter");
/**
 * Execute the full Progmune pipeline: intent → validated code → file.
 *
 * @param intent - Natural language programming intent
 * @param projectPath - Absolute path to project root
 * @param filePath - Optional: write generated code to this file
 */
async function execute(intent, projectPath, filePath) {
    // 1. IR extraction
    let ir;
    try {
        ir = (0, extract_ir_1.extractIR)(projectPath);
    }
    catch (e) {
        return { success: false, code: "", sessionId: "", hash: "", ruleHash: "", irFunctionCount: 0, protocolRuleCount: 0, violations: 0, error: `IR extraction failed: ${e.message}` };
    }
    // 2. Protocol rule count
    let protocolRuleCount = 0;
    try {
        const protoPath = path.resolve(projectPath, "protocols.json");
        if (fs.existsSync(protoPath)) {
            protocolRuleCount = Object.keys(JSON.parse(fs.readFileSync(protoPath, "utf-8")).rules || {}).length;
        }
    }
    catch { }
    // 3. Plan (LLM + immune constraints)
    let planResult;
    try {
        planResult = await (0, planner_1.plan)(intent);
    }
    catch (e) {
        return { success: false, code: "", sessionId: "", hash: "", ruleHash: "", irFunctionCount: ir.length, protocolRuleCount, violations: 0, error: `Planning failed: ${e.message}` };
    }
    if (!planResult.actions || planResult.actions.length === 0) {
        return { success: false, code: "", sessionId: planResult.sessionId, hash: "", ruleHash: planResult.ruleHash || "", irFunctionCount: ir.length, protocolRuleCount, violations: 0, error: "Planner returned empty action sequence" };
    }
    // 4. Emit code with generation marker
    const code = (0, emitter_1.emitCode)(planResult.actions, {
        sessionId: planResult.sessionId,
        ruleHash: planResult.ruleHash,
        irFunctionCount: ir.length,
        protocolRuleCount,
    });
    // 5. Write to file if requested
    if (filePath) {
        const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(projectPath, filePath);
        const dir = path.dirname(resolvedPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(resolvedPath, code, "utf-8");
    }
    // 6. Compute hash (from code content)
    const crypto = require("crypto");
    const hash = crypto.createHash("sha256").update(code).digest("hex").slice(0, 16);
    const ruleHash = planResult.ruleHash || "";
    // Fingerprint registration is NOT done here.
    // plan() internally calls recordSession() which writes real transitions to
    // .progmune_corpus/sessions/. The fingerprint is registered later by
    // `npm run check` → registerAllMissingFingerprints() which reads the
    // actual session file with real StateTransition[].
    return {
        success: true,
        code,
        sessionId: planResult.sessionId,
        filePath: filePath || undefined,
        hash,
        ruleHash,
        irFunctionCount: ir.length,
        protocolRuleCount,
        violations: 0,
    };
}
/** Quick audit: check whether a file has the @progmune-generated marker. */
function verifyFileMarker(filePath) {
    try {
        const content = fs.readFileSync(filePath, "utf-8");
        const head = content.split("\n").slice(0, 5).join("\n");
        const match = head.match(/@progmune-generated\s+session=(\S+)(?:\s+timestamp=(\S+))?/);
        if (match) {
            return { marked: true, sessionId: match[1], timestamp: match[2] };
        }
    }
    catch { }
    return { marked: false };
}
