"use strict";
/**
 * Phase 9: Scaffold Engine
 *
 * Template-based code generation for full project files.
 * Complements the function-call-chain model (planner) for
 * architecture-level code: Express servers, CLI tools, static sites.
 *
 * Registered as `progmune_scaffold` MCP tool.
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
exports.SCAFFOLD_TYPES = void 0;
exports.scaffold = scaffold;
exports.listScaffolds = listScaffolds;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const llm_1 = require("./llm");
const extract_ir_1 = require("./extract-ir");
const feedback_1 = require("./feedback");
const execute_1 = require("./execute");
// ── Scaffold types ──
exports.SCAFFOLD_TYPES = [
    "express-api", // Express REST API with SQLite
    "cli-tool", // CLI tool with argument parsing
    "static-site", // HTML/CSS/JS static site
];
const TEMPLATES = {
    "express-api": {
        description: "Express REST API server with SQLite database",
        systemPrompt: `You are a TypeScript Express server generator. Generate complete, production-ready code.

RULES:
- Use express, better-sqlite3
- Include input validation, proper HTTP status codes, error handling
- Use TypeScript types everywhere
- Generate ONLY the server file content, no explanation
- The code must be complete and runnable
- Use async/await where appropriate`,
        prerequisiteHint: "Project should have database functions (init, CRUD) and validation utilities defined in separate files.",
    },
    "cli-tool": {
        description: "CLI tool with argument parsing",
        systemPrompt: `You are a TypeScript CLI tool generator. Generate complete, production-ready code.

RULES:
- Parse command-line arguments (process.argv or a simple arg parser)
- Support --help, --version flags
- Clear error messages for invalid input
- Use TypeScript types everywhere
- Generate ONLY the CLI file content, no explanation
- The code must be complete and runnable`,
        prerequisiteHint: "Project should have utility functions for the CLI's domain logic.",
    },
    "static-site": {
        description: "Static HTML site with CSS and vanilla JavaScript",
        systemPrompt: `You are a frontend HTML/CSS/JS generator. Generate a complete, self-contained single-file HTML page.

RULES:
- Inline all CSS in <style> and JS in <script> tags
- Dark theme by default
- Mobile-responsive (max-width 640px)
- No external dependencies (no CDN, no framework)
- No social features, no images, no audio/video
- Clean, minimal design
- Generate ONLY the HTML file content, no explanation`,
        prerequisiteHint: "Page should interact with a backend API if specified in the intent.",
    },
};
// ── Scaffold engine ──
async function scaffold(scaffoldType, intent, projectPath, filePath) {
    const template = TEMPLATES[scaffoldType];
    if (!template) {
        return {
            success: false,
            code: "",
            scaffoldType,
            error: `Unknown scaffold type: ${scaffoldType}. Available: ${exports.SCAFFOLD_TYPES.join(", ")}`,
        };
    }
    // 1. Extract IR to understand project context
    let irContext = "";
    try {
        const ir = (0, extract_ir_1.extractIR)(projectPath);
        if (ir.length > 0) {
            const funcList = ir
                .map((f) => `  - ${f.name}(${(f.params || []).map((p) => `${p.name}: ${p.type || "any"}`).join(", ")}): ${f.returnType || "void"}`)
                .join("\n");
            irContext = `\n\nAvailable project functions (from IR):\n${funcList}\n\nYou MUST use these functions where applicable. For imports, use relative paths appropriate for the project structure.`;
        }
    }
    catch { /* IR extraction is best-effort */ }
    // 2. Build prompt
    const fileHint = filePath
        ? `Write the generated code to: ${filePath}`
        : "Return the generated code as the response.";
    const prompt = `${template.systemPrompt}

Project: ${path.basename(projectPath)}
File: ${filePath || "(auto-detect)"}
Intent: ${intent}
${irContext}

${fileHint}

Generate the complete file content now. Output ONLY the code, no markdown fences, no explanation.`;
    // 3. Call LLM
    let code;
    try {
        code = await (0, llm_1.generate)(prompt);
        // Strip markdown fences if LLM adds them anyway
        code = code.replace(/^```(?:typescript|javascript|html|ts|js)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
    }
    catch (e) {
        return {
            success: false,
            code: "",
            scaffoldType,
            error: `LLM generation failed: ${e.message}`,
        };
    }
    if (!code || code.length < 50) {
        return {
            success: false,
            code: "",
            scaffoldType,
            error: "LLM returned empty or too-short response",
        };
    }
    // 4. Add Progmune marker
    const sessionId = `scaffold_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let marker = "";
    if (filePath && (filePath.endsWith(".ts") || filePath.endsWith(".tsx"))) {
        marker = `// @progmune-scaffolded type=${scaffoldType} session=${sessionId} timestamp=${new Date().toISOString()}\n\n`;
    }
    else if (filePath && filePath.endsWith(".html")) {
        marker = `<!-- @progmune-scaffolded type=${scaffoldType} session=${sessionId} timestamp=${new Date().toISOString()} -->\n`;
    }
    code = marker + code;
    // 5. Write to file
    if (filePath) {
        const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(projectPath, filePath);
        const dir = path.dirname(resolved);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(resolved, code, "utf-8");
        // Record generation for metrics
        (0, execute_1.recordGeneration)({
            sessionId,
            timestamp: Date.now(),
            filePath: resolved,
            repaired: false,
            repairCount: 0,
            irFunctionCount: irContext ? irContext.split("\n").filter(l => l.includes(" - ")).length : 0,
        });
    }
    // Record for immune memory
    try {
        (0, feedback_1.recordRun)(intent, [{ kind: "scaffold", scaffoldType, filePath: filePath || "" }], true);
    }
    catch { /* non-critical */ }
    return {
        success: true,
        code,
        filePath: filePath || undefined,
        scaffoldType,
    };
}
/** List available scaffold types with descriptions */
function listScaffolds() {
    return exports.SCAFFOLD_TYPES.map((t) => ({
        type: t,
        description: TEMPLATES[t].description,
    }));
}
