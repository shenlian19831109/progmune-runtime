import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { resolveEndpoint, maskFunctionName, buildHeaders, extractFingerprints } from "./immune-reporter";

/**
 * Immune Reporter 测试——2026-09 修复轮：
 * 默认脱敏、PROGMUNE_HUB=off 开关、语料路径对齐 .progmune_corpus。
 * 涉及文件系统的用例使用临时目录注入（corpusDir 参数），不触碰真实语料。
 */

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "progmune-reporter-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("resolveEndpoint", () => {
  it("未设置 PROGMUNE_HUB 时默认指向中央 hub", () => {
    expect(resolveEndpoint(undefined)).toBe("https://progmune-runtime.fly.dev/report");
  });

  it("PROGMUNE_HUB=off 及其变体（0/false/no/disabled）关闭上报", () => {
    for (const v of ["off", "0", "false", "no", "disabled", "OFF"]) {
      expect(resolveEndpoint(v)).toBeNull();
    }
  });

  it("自定义 URL 原样生效", () => {
    expect(resolveEndpoint("http://localhost:9999/report")).toBe("http://localhost:9999/report");
  });
});

describe("maskFunctionName", () => {
  it("默认脱敏：同名函数产生相同哈希（模式聚合保持有效）", () => {
    const a = maskFunctionName("generate_jwt", false);
    const b = maskFunctionName("generate_jwt", false);
    expect(a).toBe(b);
    expect(a).toMatch(/^fn:[0-9a-f]{12}$/);
    expect(a).not.toContain("generate_jwt");
  });

  it("不同函数名产生不同哈希", () => {
    expect(maskFunctionName("generate_jwt", false)).not.toBe(maskFunctionName("create_session", false));
  });

  it("PROGMUNE_FINGERPRINT_DETAIL=1 时保留原文", () => {
    expect(maskFunctionName("generate_jwt", true)).toBe("generate_jwt");
  });
});

describe("buildHeaders", () => {
  it("无 token 时只带 Content-Type", () => {
    expect(buildHeaders(undefined)).toEqual({ "Content-Type": "application/json" });
  });

  it("设置 PROGMUNE_HUB_TOKEN 时带 Bearer 认证头", () => {
    const h = buildHeaders("secret-token");
    expect(h["Authorization"]).toBe("Bearer secret-token");
    expect(h["Content-Type"]).toBe("application/json");
  });
});

describe("extractFingerprints", () => {
  function writeRecord(date: string, id: string, record: object) {
    const dir = path.join(tmpDir, date);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `fail_${id}.json`), JSON.stringify(record));
  }

  it("从 .progmune_corpus 路径读取并默认脱敏函数名", () => {
    writeRecord("2026-09-09", "1", {
      timestamp: "2026-09-09T10:00:00.000Z",
      violatedSVL: "SVL-4",
      constraintType: "protocol",
      actionSequence: [{ kind: "call", function: "generate_jwt" }],
      ssgState: ["UNAUTHENTICATED"],
    });
    const fps = extractFingerprints({ lastTimestamp: null }, tmpDir);
    expect(fps.length).toBe(1);
    expect(fps[0].functionSequence[0]).toMatch(/^fn:[0-9a-f]{12}$/);
    expect(fps[0].preState).toEqual([["UNAUTHENTICATED"]]);
  });

  it("游标之后的新记录才会上报，旧记录跳过", () => {
    writeRecord("2026-09-01", "old", {
      timestamp: "2026-09-01T10:00:00.000Z",
      violatedSVL: "SVL-4",
      constraintType: "protocol",
      actionSequence: [],
    });
    writeRecord("2026-09-09", "new", {
      timestamp: "2026-09-09T10:00:00.000Z",
      violatedSVL: "SVL-4",
      constraintType: "protocol",
      actionSequence: [],
    });
    const fps = extractFingerprints({ lastTimestamp: "2026-09-05T00:00:00.000Z" }, tmpDir);
    expect(fps.length).toBe(1);
    expect(fps[0].timestamp).toBe("2026-09-09T10:00:00.000Z");
  });

  it("非 fail_ 前缀文件与损坏 JSON 跳过，不中断", () => {
    writeRecord("2026-09-09", "ok", {
      timestamp: "2026-09-09T10:00:00.000Z",
      violatedSVL: "SVL-4",
      constraintType: "protocol",
      actionSequence: [],
    });
    fs.writeFileSync(path.join(tmpDir, "2026-09-09", "trajectory_x.json"), "{}");
    fs.writeFileSync(path.join(tmpDir, "2026-09-09", "fail_broken.json"), "{corrupted");
    const fps = extractFingerprints({ lastTimestamp: null }, tmpDir);
    expect(fps.length).toBe(1);
  });

  it("无调用序列时 functionSequence 为空数组而非报错", () => {
    writeRecord("2026-09-09", "empty", {
      timestamp: "2026-09-09T10:00:00.000Z",
      violatedSVL: "SVL-2",
      constraintType: "types",
    });
    const fps = extractFingerprints({ lastTimestamp: null }, tmpDir);
    expect(fps.length).toBe(1);
    expect(fps[0].functionSequence).toEqual([]);
  });
});
