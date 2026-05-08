import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

export function extractIRPython(projectRoot: string): any[] {
  const scriptPath = path.resolve(__dirname, "../tools/extract_ir.py");
  const cmd = `python3 "${scriptPath}" "${projectRoot}"`;
  try {
    execSync(cmd, { encoding: "utf-8", stdio: "pipe" });
  } catch (e: any) {
    console.error("Python IR 提取失败:", e.stderr?.toString() || e.toString());
    return [];
  }
  const irPath = path.resolve("ir.json");
  if (fs.existsSync(irPath)) {
    return JSON.parse(fs.readFileSync(irPath, "utf-8"));
  }
  return [];
}
