import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

/** @requires COMMAND @produces EXECUTION_RESULT */
export function runAndCheck(code: string): { success: boolean; error?: string } {
  // 把临时文件写入 test-login 目录，使用它的 tsconfig 编译
  const tmpDir = path.resolve("test-login");
  const tmpFile = path.join(tmpDir, "_temp_check.ts");
  fs.writeFileSync(tmpFile, code);
  try {
    execSync(`npx ts-node --project ${tmpDir}/tsconfig.json ${tmpFile}`, {
      timeout: 5000,
      encoding: "utf-8",
    });
    fs.unlinkSync(tmpFile);
    return { success: true };
  } catch (e: any) {
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    return { success: false, error: e.stderr?.toString() || e.toString() };
  }
}
