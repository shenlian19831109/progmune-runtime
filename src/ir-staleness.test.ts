import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { inspectIrFreshness, reextractMode, reextractEnabled } from "./ir-staleness";

/**
 * ir.json 陈旧性判定的回归测试（2026-09-19）。
 *
 * 锁三件事：
 * 1. ir.json 缺失 → missing（需提取）——保住原有的自动提取语义；
 * 2. 源码比 ir.json 新 → source-newer（需重提）——本次新增的判别力；
 * 3. ir.json 不早于源码 → fresh（沿用磁盘文件）——不做无谓的全量重提，
 *    否则 skyvern 级项目每次扫描要多付分钟级成本。
 */

function tmpdir(tag: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `pm-ir-stale-${tag}-`));
}

/** 把文件的 mtime 显式钉到某个 epoch ms（避免同一毫秒内写完两文件的歧义）。 */
function touch(file: string, content: string, mtimeMs: number): void {
  fs.writeFileSync(file, content);
  fs.utimesSync(file, mtimeMs / 1000, mtimeMs / 1000);
}

describe("inspectIrFreshness", () => {
  it("ir.json 缺失 → missing，stale=true（触发自动提取）", () => {
    const dir = tmpdir("missing");
    try {
      touch(path.join(dir, "app.ts"), "export const x = 1;", 1_700_000_000_000);
      const r = inspectIrFreshness(dir);
      expect(r.exists).toBe(false);
      expect(r.stale).toBe(true);
      expect(r.reason).toBe("missing");
      expect(r.irMtimeMs).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("源码比 ir.json 新 → source-newer（本次修复的核心：原先会被静默沿用）", () => {
    const dir = tmpdir("newer");
    try {
      const irFile = path.join(dir, "ir.json");
      const srcFile = path.join(dir, "app.ts");
      touch(irFile, "[]", 1_700_000_000_000);
      touch(srcFile, "export const x = 1;", 1_700_000_100_000); // 晚 100s
      const r = inspectIrFreshness(dir);
      expect(r.exists).toBe(true);
      expect(r.stale).toBe(true);
      expect(r.reason).toBe("source-newer");
      expect(r.newestSourcePath).toBe(srcFile);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ir.json 比源码新 → fresh（不重提，避免分钟级全量重提）", () => {
    const dir = tmpdir("fresh");
    try {
      touch(path.join(dir, "app.ts"), "export const x = 1;", 1_700_000_000_000);
      touch(path.join(dir, "ir.json"), "[]", 1_700_000_100_000);
      const r = inspectIrFreshness(dir);
      expect(r.stale).toBe(false);
      expect(r.reason).toBe("fresh");
      expect(r.scannedFiles).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("同刻写出（源码→ir.json 的常见顺序）→ fresh（不得推入全量重提）", () => {
    const dir = tmpdir("same");
    try {
      touch(path.join(dir, "app.ts"), "export const x = 1;", 1_700_000_000_000);
      touch(path.join(dir, "ir.json"), "[]", 1_700_000_000_000);
      const r = inspectIrFreshness(dir);
      expect(r.stale).toBe(false);
      expect(r.reason).toBe("fresh");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("子目录源码也算源码（只看根目录下的话会漏判）", () => {
    const dir = tmpdir("nested");
    try {
      touch(path.join(dir, "ir.json"), "[]", 1_700_000_000_000);
      const nested = path.join(dir, "src", "deep");
      fs.mkdirSync(nested, { recursive: true });
      touch(
        path.join(nested, "handler.ts"),
        "export function handle() {}",
        1_700_000_500_000
      );
      const r = inspectIrFreshness(dir);
      expect(r.stale).toBe(true);
      expect(r.newestSourcePath).toContain(path.join("src", "deep", "handler.ts"));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("node_modules 等非源码目录被跳过（成本约束：不得遍历依赖树）", () => {
    const dir = tmpdir("skip");
    try {
      touch(path.join(dir, "ir.json"), "[]", 1_700_000_500_000);
      const nm = path.join(dir, "node_modules", "pkg");
      fs.mkdirSync(nm, { recursive: true });
      touch(path.join(nm, "index.js"), "module.exports = 1;", 1_700_000_900_000);
      const r = inspectIrFreshness(dir);
      expect(r.stale).toBe(false);
      expect(r.reason).toBe("no-sources");
      expect(r.scannedFiles).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("非源码后缀（png/md/json）不影响判定", () => {
    const dir = tmpdir("ext");
    try {
      touch(path.join(dir, "ir.json"), "[]", 1_700_000_500_000);
      touch(path.join(dir, "README.md"), "hello", 1_700_000_900_000);
      touch(path.join(dir, "logo.png"), "x", 1_700_000_900_000);
      const r = inspectIrFreshness(dir);
      expect(r.stale).toBe(false);
      expect(r.reason).toBe("no-sources");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("源码规模超预算 → exceedsAutoBudget（auto 模式只警告，不自动全量重提）", () => {
    const dir = tmpdir("budget");
    try {
      touch(path.join(dir, "ir.json"), "[]", 1_700_000_000_000);
      for (let i = 0; i < 5; i++) {
        touch(path.join(dir, `f${i}.ts`), "export const x = 1;", 1_700_000_100_000);
      }
      const r = inspectIrFreshness(dir, undefined, { autoBudget: 3 });
      expect(r.stale).toBe(true);       // 陈旧判定不受预算影响
      expect(r.exceedsAutoBudget).toBe(true);
      expect(r.scannedFiles).toBe(5);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("遍历被上限截断时标记 evidenceComplete=false（超大仓库不得静默全量重提）", () => {
    const dir = tmpdir("trunc");
    try {
      touch(path.join(dir, "ir.json"), "[]", 1_700_000_000_000);
      for (let i = 0; i < 5; i++) {
        touch(path.join(dir, `f${i}.ts`), "export const x = 1;", 1_700_000_100_000);
      }
      // maxStats=2：扫到 2 个就停 —— stale 仍为真（证据已经够），但 fresh 不可信
      const r = inspectIrFreshness(dir, undefined, { maxStats: 2 });
      expect(r.stale).toBe(true);
      expect(r.truncated).toBe(true);
      expect(r.evidenceComplete).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("正常仓库（未截断）fresh 判定证据完整", () => {
    const dir = tmpdir("complete");
    try {
      touch(path.join(dir, "app.ts"), "export const x = 1;", 1_700_000_000_000);
      touch(path.join(dir, "ir.json"), "[]", 1_700_000_100_000);
      const r = inspectIrFreshness(dir);
      expect(r.evidenceComplete).toBe(true);
      expect(r.reason).toBe("fresh");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("逃逸阀：默认 auto", () => {
    const prev = process.env.PROGMUNE_IR_REEXTRACT;
    delete process.env.PROGMUNE_IR_REEXTRACT;
    expect(reextractMode()).toBe("auto");
    expect(reextractEnabled()).toBe(true);
    if (prev !== undefined) process.env.PROGMUNE_IR_REEXTRACT = prev;
  });

  it("逃生阀：always / never 语义", () => {
    const prev = process.env.PROGMUNE_IR_REEXTRACT;
    process.env.PROGMUNE_IR_REEXTRACT = "always";
    expect(reextractMode()).toBe("always");
    process.env.PROGMUNE_IR_REEXTRACT = "never";
    expect(reextractMode()).toBe("never");
    expect(reextractEnabled()).toBe(false);
    if (prev === undefined) delete process.env.PROGMUNE_IR_REEXTRACT;
    else process.env.PROGMUNE_IR_REEXTRACT = prev;
  });
});
