"use strict";
/**
 * Project IR extraction — merged multi-language entry point.
 *
 * Registry pattern: each supported language contributes a detector +
 * extractor entry. extractProjectIR runs every extractor whose language
 * is detected in the project and merges the results into one FunctionInfo
 * list, so TS + Python coexist in a mixed project.
 *
 * Adding a language later (Go, Java, ...) = register one entry in
 * LANGUAGE_EXTRACTORS. The agent loop (extractIRWithDelta), execute()'s
 * ir.json write and the MCP server all pick it up automatically — no
 * dispatch rewiring anywhere else.
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
exports.LANGUAGE_EXTRACTORS = void 0;
exports.detectLanguages = detectLanguages;
exports.extractProjectIR = extractProjectIR;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const extract_ir_1 = require("./extract-ir");
const extract_ir_python_1 = require("./extract-ir-python");
const extract_ir_c_1 = require("./extract-ir-c");
const extract_ir_go_1 = require("./extract-ir-go");
const extract_ir_java_1 = require("./extract-ir-java");
const SKIP_DIRS = new Set([
    "node_modules", "dist", "build", ".git", ".progmune_corpus",
    "__pycache__", "venv", ".venv",
    "benchmarks", // vendored C 基准仓库（与 extract-ir-c.ts collectCFiles 口径一致）
]);
/** 有界递归扫描：项目是否含指定扩展名源文件（首个命中即返回）。 */
function hasSourceFiles(projectRoot, exts) {
    const stack = [projectRoot];
    const seen = new Set();
    while (stack.length > 0) {
        const dir = stack.pop();
        if (seen.has(dir))
            continue;
        seen.add(dir);
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) {
                if (!SKIP_DIRS.has(e.name) && !e.name.startsWith("."))
                    stack.push(full);
            }
            else if (exts.has(path.extname(e.name))) {
                return true;
            }
        }
    }
    return false;
}
/** 已注册语言提取器（新增语言在此追加一条）。 */
exports.LANGUAGE_EXTRACTORS = [
    {
        language: "typescript",
        detect: (p) => hasSourceFiles(p, new Set([".ts", ".tsx"])),
        extract: (p) => (0, extract_ir_1.extractIR)(p),
    },
    {
        language: "python",
        detect: (p) => hasSourceFiles(p, new Set([".py"])),
        extract: (p) => (0, extract_ir_python_1.extractIRPython)(p),
    },
    {
        language: "c",
        detect: (p) => hasSourceFiles(p, new Set([".c", ".h"])),
        extract: (p) => (0, extract_ir_c_1.extractIRC)(p),
    },
    {
        language: "go",
        detect: (p) => hasSourceFiles(p, new Set([".go"])),
        extract: (p) => (0, extract_ir_go_1.extractIRGo)(p),
    },
    {
        language: "java",
        detect: (p) => hasSourceFiles(p, new Set([".java"])),
        extract: (p) => (0, extract_ir_java_1.extractIRJava)(p),
    },
];
/** 项目检测到的语言列表（审计/标签用）。 */
function detectLanguages(projectRoot) {
    return exports.LANGUAGE_EXTRACTORS.filter((e) => e.detect(projectRoot)).map((e) => e.language);
}
/**
 * Extract the merged project IR across all detected languages.
 *
 * 单语言提取失败不拖垮其余语言（与感知层 best-effort 原则一致）；
 * 仅当所有检测到的语言全部失败时才抛错，保留 execute 的硬失败语义。
 *
 * @param projectRoot - Absolute path to project root
 * @param extractors - Registry override (tests inject fake entries here)
 * @returns Merged FunctionInfo list
 */
function extractProjectIR(projectRoot, extractors = exports.LANGUAGE_EXTRACTORS) {
    const merged = [];
    let anyDetected = false;
    let anySucceeded = false;
    for (const e of extractors) {
        if (!e.detect(projectRoot))
            continue;
        anyDetected = true;
        try {
            merged.push(...e.extract(projectRoot));
            anySucceeded = true;
        }
        catch (err) {
            console.error(`[extractProjectIR] ${e.language} 提取失败: ${err?.message || err}`);
        }
    }
    if (anyDetected && !anySucceeded) {
        throw new Error("所有已检测语言的 IR 提取均失败");
    }
    return merged;
}
