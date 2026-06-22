/**
 * Phase 9: Scaffold Engine
 *
 * Template-based code generation for full project files.
 * Complements the function-call-chain model (planner) for
 * architecture-level code: Express servers, CLI tools, static sites.
 *
 * Registered as `progmune_scaffold` MCP tool.
 */

import * as fs from "fs";
import * as path from "path";
import { generate } from "./llm";
import { extractIR } from "./extract-ir";
import { recordRun } from "./feedback";
import { recordGeneration } from "./execute";

// ── Scaffold types ──

export const SCAFFOLD_TYPES = [
  "express-api",   // Express REST API with SQLite
  "cli-tool",       // CLI tool with argument parsing
  "static-site",   // HTML/CSS/JS static site
] as const;

export type ScaffoldType = (typeof SCAFFOLD_TYPES)[number];

export interface ScaffoldResult {
  success: boolean;
  code: string;
  filePath?: string;
  scaffoldType: ScaffoldType;
  error?: string;
}

// ── Templates ──

interface Template {
  description: string;
  systemPrompt: string;
  /** Files that should already exist in the project (IR functions the LLM can call) */
  prerequisiteHint: string;
}

const TEMPLATES: Record<ScaffoldType, Template> = {
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
    prerequisiteHint:
      "Project should have database functions (init, CRUD) and validation utilities defined in separate files.",
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
    prerequisiteHint:
      "Project should have utility functions for the CLI's domain logic.",
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
    prerequisiteHint:
      "Page should interact with a backend API if specified in the intent.",
  },
};

// ── Scaffold engine ──

export async function scaffold(
  scaffoldType: ScaffoldType,
  intent: string,
  projectPath: string,
  filePath?: string
): Promise<ScaffoldResult> {
  const template = TEMPLATES[scaffoldType];
  if (!template) {
    return {
      success: false,
      code: "",
      scaffoldType,
      error: `Unknown scaffold type: ${scaffoldType}. Available: ${SCAFFOLD_TYPES.join(", ")}`,
    };
  }

  // 1. Extract IR to understand project context
  let irContext = "";
  try {
    const ir = extractIR(projectPath);
    if (ir.length > 0) {
      const funcList = ir
        .map((f: any) => `  - ${f.name}(${(f.params || []).map((p: any) => `${p.name}: ${p.type || "any"}`).join(", ")}): ${f.returnType || "void"}`)
        .join("\n");
      irContext = `\n\nAvailable project functions (from IR):\n${funcList}\n\nYou MUST use these functions where applicable. For imports, use relative paths appropriate for the project structure.`;
    }
  } catch { /* IR extraction is best-effort */ }

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
  let code: string;
  try {
    code = await generate(prompt);
    // Strip markdown fences if LLM adds them anyway
    code = code.replace(/^```(?:typescript|javascript|html|ts|js)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
  } catch (e: any) {
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
  } else if (filePath && filePath.endsWith(".html")) {
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
    recordGeneration({
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
    recordRun(intent, [{ kind: "scaffold", scaffoldType, filePath: filePath || "" }] as any, true);
  } catch { /* non-critical */ }

  return {
    success: true,
    code,
    filePath: filePath || undefined,
    scaffoldType,
  };
}

/** List available scaffold types with descriptions */
export function listScaffolds(): Array<{ type: ScaffoldType; description: string }> {
  return SCAFFOLD_TYPES.map((t) => ({
    type: t,
    description: TEMPLATES[t].description,
  }));
}
