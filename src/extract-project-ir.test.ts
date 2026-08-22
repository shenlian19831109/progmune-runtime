/**
 * Project IR extraction (merged multi-language registry) — unit tests.
 *
 * Registry injection: tests pass fake extractor entries to extractProjectIR
 * so no real extractor runs; the real detectors are covered by two
 * temp-dir tests (per module convention, FS use is kept minimal).
 */

import { describe, it, expect, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { extractProjectIR, detectLanguages } from "./extract-project-ir";
import type { LanguageExtractor } from "./extract-project-ir";

describe("extractProjectIR（注册表合并）", () => {
  it("合并所有检测到语言的函数", () => {
    const tsFns = [{ name: "getSession", file: "src/auth.ts" }];
    const pyFns = [{ name: "verify_password", file: "auth_service.py" }];
    const extractors: LanguageExtractor[] = [
      { language: "typescript", detect: () => true, extract: () => tsFns as any },
      { language: "python", detect: () => true, extract: () => pyFns as any },
    ];

    const ir = extractProjectIR("/tmp/fake", extractors);

    expect(ir).toEqual([...tsFns, ...pyFns]);
  });

  it("未检测到的语言不运行提取器", () => {
    const ran: string[] = [];
    const extractors: LanguageExtractor[] = [
      { language: "typescript", detect: () => true, extract: () => { ran.push("ts"); return []; } },
      { language: "python", detect: () => false, extract: () => { ran.push("py"); return []; } },
    ];

    extractProjectIR("/tmp/fake", extractors);

    expect(ran).toEqual(["ts"]);
  });

  it("单语言提取失败不拖垮其余语言", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const extractors: LanguageExtractor[] = [
      { language: "typescript", detect: () => true, extract: () => { throw new Error("broken tsconfig"); } },
      { language: "python", detect: () => true, extract: () => [{ name: "f" }] as any },
    ];

    const ir = extractProjectIR("/tmp/fake", extractors);

    expect(ir).toEqual([{ name: "f" }]);
  });

  it("所有检测到的语言都失败时抛错（保留 execute 硬失败语义）", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const extractors: LanguageExtractor[] = [
      { language: "typescript", detect: () => true, extract: () => { throw new Error("broken"); } },
    ];

    expect(() => extractProjectIR("/tmp/fake", extractors)).toThrow();
  });

  it("无任何检测到的语言时返回空数组，不抛错", () => {
    const extractors: LanguageExtractor[] = [
      { language: "typescript", detect: () => false, extract: () => [] },
      { language: "python", detect: () => false, extract: () => [] },
    ];

    expect(extractProjectIR("/tmp/fake", extractors)).toEqual([]);
  });
});

describe("detectLanguages（真实探测器）", () => {
  it("TS/Python 混合项目两种语言都被检测", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-lang-"));
    try {
      fs.writeFileSync(path.join(dir, "main.ts"), "export function f() {}");
      fs.mkdirSync(path.join(dir, "src"));
      fs.writeFileSync(path.join(dir, "src", "app.py"), "def g():\n    pass\n");

      expect(detectLanguages(dir).sort()).toEqual(["python", "typescript"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("依赖目录里的源文件不计入检测（node_modules/.py）", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-lang2-"));
    try {
      fs.mkdirSync(path.join(dir, "node_modules", "pkg"), { recursive: true });
      fs.writeFileSync(path.join(dir, "node_modules", "pkg", "x.py"), "x = 1\n");

      expect(detectLanguages(dir)).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
