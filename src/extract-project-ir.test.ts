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
import { collectProjectFunctionNames } from "./call-sequence";

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

  it("三语言合并（TS + Python + C）按注册表顺序", () => {
    const tsFns = [{ name: "getSession", file: "src/auth.ts" }];
    const pyFns = [{ name: "verify_password", file: "auth_service.py" }];
    const cFns = [{ name: "authenticate", file: "src/auth_flow.c" }];
    const extractors: LanguageExtractor[] = [
      { language: "typescript", detect: () => true, extract: () => tsFns as any },
      { language: "python", detect: () => true, extract: () => pyFns as any },
      { language: "c", detect: () => true, extract: () => cFns as any },
    ];

    const ir = extractProjectIR("/tmp/fake", extractors);

    expect(ir).toEqual([...tsFns, ...pyFns, ...cFns]);
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

  it("C 提取器失败被吞，其余语言结果保留", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const extractors: LanguageExtractor[] = [
      { language: "typescript", detect: () => true, extract: () => [{ name: "f" }] as any },
      { language: "c", detect: () => true, extract: () => { throw new Error("broken c parse"); } },
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

  it("纯 C 项目（.c）被检测", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-lang3-"));
    try {
      fs.writeFileSync(path.join(dir, "main.c"), "int main(void) { return 0; }\n");

      expect(detectLanguages(dir)).toEqual(["c"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("仅头文件（.h）也算 C 项目", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-lang4-"));
    try {
      fs.writeFileSync(path.join(dir, "header.h"), "int add(int a, int b);\n");

      expect(detectLanguages(dir)).toEqual(["c"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("TS + C 混合项目两种语言都被检测", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-lang5-"));
    try {
      fs.writeFileSync(path.join(dir, "main.ts"), "export function f() {}");
      fs.writeFileSync(path.join(dir, "helper.c"), "void helper(void) {}\n");

      expect(detectLanguages(dir).sort()).toEqual(["c", "typescript"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("benchmarks/ 下的 C 源不计入检测（vendored 基准仓库，与 extract 口径一致）", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-lang6-"));
    try {
      fs.mkdirSync(path.join(dir, "benchmarks", "curl"), { recursive: true });
      fs.writeFileSync(path.join(dir, "benchmarks", "curl", "lib.c"), "void f(void) {}\n");

      expect(detectLanguages(dir)).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("TS + C 混合项目：真实注册表合并 IR 含两语言函数，词段门控集合为并集", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-mix-"));
    try {
      // ts-morph 需要 tsconfig（无 tsconfig 时 TS 提取抛错、按设计被注册表吞掉）
      fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify({
        compilerOptions: { target: "es2020", module: "commonjs" },
        include: ["**/*.ts"],
      }));
      fs.writeFileSync(path.join(dir, "auth.ts"), "export function verifySession(t: string) { return t; }\n");
      fs.writeFileSync(path.join(dir, "helper.c"), "void authenticate(void) { verify_password(); generate_jwt(); }\n");

      const ir = extractProjectIR(dir);
      const names = ir.map((f) => `${f.file}:${f.name}`).sort();
      expect(names).toEqual(["auth.ts:verifySession", "helper.c:authenticate"]);

      // 词段匹配门控集合（ssg-bridge projectFunctions）为两语言并集——
      // C 函数名进入集合是设计行为（混合项目 C 侧才参与词段匹配）
      const gate = collectProjectFunctionNames(ir);
      expect(gate.has("verifySession")).toBe(true);
      expect(gate.has("authenticate")).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
