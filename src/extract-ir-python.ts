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

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import type { FunctionInfo } from "./extract-ir";

export function extractIRPython(projectRoot: string): FunctionInfo[] {
  const scriptPath = path.resolve(__dirname, "..", "tools", "extract_ir.py");
  const irPath = path.resolve(projectRoot, "ir.json");

  const cmd = `python3 "${scriptPath}" "${projectRoot}" "${irPath}"`;
  try {
    execSync(cmd, { encoding: "utf-8", stdio: "pipe" });
  } catch (e: any) {
    console.error("Python IR extraction failed:", e.stderr?.toString() || String(e));
    return [];
  }

  if (!fs.existsSync(irPath)) return [];

  const raw = JSON.parse(fs.readFileSync(irPath, "utf-8"));
  if (!Array.isArray(raw)) return [];

  // Map Python IR records to FunctionInfo
  return raw.map((r: Record<string, any>) => ({
    name: r.name || "",
    params: (r.params || []).map((p: any) => ({
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
  } as FunctionInfo));
}

/** Auto-detect whether a project is Python (looks for .py files). */
export function isPythonProject(projectRoot: string): boolean {
  try {
    const files = fs.readdirSync(projectRoot);
    return files.some(f => f.endsWith(".py"));
  } catch {
    return false;
  }
}
