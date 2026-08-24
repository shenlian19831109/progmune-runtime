"use strict";
/**
 * Python IR Extractor — Bridge to tools/extract_ir.py
 *
 * V5: Python IR now matches TypeScript FunctionInfo interface
 * and feeds directly into the SSG validator and protocol discovery pipeline.
 *
 * Protocol annotations via Python decorators:
 *   @progmune(namespace="auth", pre=["UNAUTHENTICATED"], post=["PASSWORD_VERIFIED"])
 *   def verify_password(...): ...
 *
 * Docstring-based metadata:
 *   @purpose, @requires, @produces, @tags, @inputs, @outputs
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
exports.extractIRPython = extractIRPython;
exports.isPythonProject = isPythonProject;
const child_process_1 = require("child_process");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
/**
 * @param projectRoot - Project root to scan
 * @param outPath - Output path for the Python script. Defaults to a temp
 *   file (cleaned up afterwards) so extraction never clobbers the project's
 *   own ir.json — the merged extractProjectIR runs this on TS projects too.
 *   Pass an explicit path when the extracted IR must be persisted.
 */
function extractIRPython(projectRoot, outPath) {
    const scriptPath = path.resolve(__dirname, "..", "tools", "extract_ir.py");
    const irPath = outPath ?? path.join(os.tmpdir(), `progmune-py-ir-${process.pid}-${Date.now()}.json`);
    const cmd = `python3 "${scriptPath}" "${projectRoot}" "${irPath}"`;
    try {
        (0, child_process_1.execSync)(cmd, { encoding: "utf-8", stdio: "pipe" });
    }
    catch (e) {
        console.error("Python IR extraction failed:", e.stderr?.toString() || String(e));
        return [];
    }
    if (!fs.existsSync(irPath))
        return [];
    let raw;
    try {
        raw = JSON.parse(fs.readFileSync(irPath, "utf-8"));
    }
    finally {
        if (!outPath) {
            try {
                fs.unlinkSync(irPath);
            }
            catch { /* 临时文件清理失败无害 */ }
        }
    }
    if (!Array.isArray(raw))
        return [];
    // Map Python IR records to FunctionInfo
    return raw.map((r) => ({
        name: r.name || "",
        params: (r.params || []).map((p) => ({
            name: p.name || "",
            type: p.type || "any",
        })),
        returnType: r.returnType || "any",
        file: r.file || "",
        calls: r.calls || [],
        exported: r.exported !== false,
        external: r.external || false,
        description: r.description || r.purpose || "",
        purpose: r.purpose || "",
        tags: r.tags || (r.language ? [r.language] : []),
        inputs: r.inputs || [],
        outputs: r.outputs || [],
        requires: r.requires || "",
        produces: r.produces || "",
        useWhen: r.useWhen || "",
        protocol: r.protocol || undefined,
    }));
}
/** Auto-detect whether a project is Python (looks for .py files). */
function isPythonProject(projectRoot) {
    try {
        const files = fs.readdirSync(projectRoot);
        return files.some(f => f.endsWith(".py"));
    }
    catch {
        return false;
    }
}
