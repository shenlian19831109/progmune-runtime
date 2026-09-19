/**
 * G1 PATH_GUARD_EVIDENCE —— 路径穿越「校验识别」的定向回归（2026-09-19）。
 *
 * 立项背景：路径穿越标记此前是 `taint → file sink ⇒ 标记`，**不看中间有没有
 * 校验**；SSRF 侧不是这样（无 SSRF_GUARD_EVIDENCE 才标记）。两侧数据流同构、
 * 判别力差一档——这正是根集合不敢放宽的真正原因（fr-012/fr-015 的 MISS 由此
 * 从「词表缺口」升级为「机制缺口」）。
 *
 * G1 把路径侧改成与 SSRF 对齐：`taint → file sink 且无校验证据 ⇒ 标记`。
 *
 * 本文件的每条正例/反例都锚定到**语料里真实存在的一段代码**，不是凭空造的词表：
 *   - fr-007 openhop  `assertValidFlowId(id)`（fix 才出现，G-C）
 *   - fr-012 gitlab-mcp  下载侧 localPath 守卫块（pre/post 同一段，G-B）
 *   - fr-016 Redocly  `assertWithinDir(openapiDir, pathFile, pathName)`（G-C）
 *   - fr-012 pre 实测反例：`path.basename` 在漏洞态就在（N-A）
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { extractIR } from "./extract-ir";

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: "ES2020",
    module: "commonjs",
    moduleResolution: "node",
    strict: false,
    skipLibCheck: true,
    noEmit: true,
  },
  include: ["**/*.ts"],
});

function makeProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-taint-guard-"));
  fs.writeFileSync(path.join(dir, "tsconfig.json"), TSCONFIG);
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "fixture", version: "0.0.0", private: true })
  );
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return dir;
}

function marksFor(dir: string, fnName: string): string[] {
  const fns = extractIR(dir);
  const f = fns.find((x) => x.name === fnName);
  return f ? (f.calls ?? []) : [];
}

const PATH_MARK = "__progmune_path_traversal__";

describe("G1 基线：无校验证据时必须照旧标记（不得因加判别力而失召回）", () => {
  it("taint → 文件 sink，全程无校验 → 标记", () => {
    const dir = makeProject({
      "a.ts": `
import * as fs from "fs";
export function read(req: any) {
  const name = req.params.name;
  return fs.readFileSync("/data/" + name, "utf-8");
}
`,
    });
    try {
      expect(marksFor(dir, "read")).toContain(PATH_MARK);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("G-B：上跳/绝对路径拒绝（种子=fr-012 gitlab-mcp 下载侧 localPath 守卫块）", () => {
  // index.ts:7968-7977 —— pre 与 post 完全一致的一段既有守卫。
  // 它不能当「修复形态种子」，但它是真实世界的「已校验」样本。
  //
  // ⚠️ 写法约束（踩过坑）：污点必须**直接出现在 sink 实参窗口里**。
  // 「污点经 path.normalize(x) / path.join(x) 包装后仍传播」是另一条独立的
  // 传播缺口（C4，见文末已知边界）—— 若让污点先被包装再进 sink，
  // 「不得标记」会**假通过**（污点压根没到 sink，与守卫无关）。
  // 故本组用例让 sink 直接使用污点名，守卫块则照抄真实代码。
  const GUARD_BLOCK = `
    const normalizedLocalPath = path.normalize(localPath);
    if (
      path.isAbsolute(normalizedLocalPath) ||
      normalizedLocalPath === ".." ||
      normalizedLocalPath.startsWith(".." + path.sep) ||
      normalizedLocalPath.includes(path.sep + ".." + path.sep)
    ) {
      throw new Error("Invalid local_path: directory traversal is not allowed.");
    }
`;

  const wrap = (guard: string) => `
import * as fs from "fs";
import * as path from "path";
export function save(req: any, buffer: any) {
  const localPath = req.params.local_path;
${guard}  fs.writeFileSync(localPath, buffer);
}
`;

  it("去掉守卫块后必须标记（正对照：证明这条用例真的锁住了判别力）", () => {
    const dir = makeProject({ "a.ts": wrap("") });
    try {
      expect(marksFor(dir, "save")).toContain(PATH_MARK);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("真实守卫块存在时不得标记", () => {
    const dir = makeProject({ "a.ts": wrap(GUARD_BLOCK) });
    try {
      expect(marksFor(dir, "save")).not.toContain(PATH_MARK);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("G-C：独立校验函数（种子=fr-007 openhop / fr-016 Redocly）", () => {
  // fr-007 的修复形态：把 assertValidFlowId(id) 放进 filePath()，
  // 真正含 sink 的 get/save 与外层 flowRoutes 里一个校验词汇都没有
  // —— 只看函数体等于没做，必须向调用方传播。
  const BASE = `
import * as fs from "fs";
import * as path from "path";
export class FlowStore {
  private dir = "/data";
  private filePath(id: string): string {
    PATHIDGUARD
    return path.join(this.dir, id + ".yaml");
  }
  async get(id: string) {
    return fs.readFileSync(this.filePath(id), "utf-8");
  }
}
export function flowRoutes(req: any, store: FlowStore) {
  const id = req.params.id;
  return store.get(id);
}
`;

  it("pre（无校验函数）：含 sink 的方法与外层调用点都要标记", () => {
    const dir = makeProject({ "a.ts": BASE.replace("PATHIDGUARD", "") });
    try {
      expect(marksFor(dir, "flowRoutes")).toContain(PATH_MARK);
      expect(marksFor(dir, "FlowStore.get")).toContain(PATH_MARK);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("post（fr-007 真修复形态 assertValidFlowId）：两侧都不得标记", () => {
    const dir = makeProject({
      "flow-id.ts": `
export function assertValidFlowId(id: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) { throw new Error("Invalid flow id: " + id); }
}
`,
      "a.ts": BASE.replace("PATHIDGUARD", "assertValidFlowId(id);"),
    });
    try {
      expect(marksFor(dir, "flowRoutes")).not.toContain(PATH_MARK);
      expect(marksFor(dir, "FlowStore.get")).not.toContain(PATH_MARK);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fr-016 Redocly 形态 assertWithinDir：不得标记", () => {
    const dir = makeProject({
      "a.ts": `
import * as fs from "fs";
import * as path from "path";
// 同上：让污点直接进 sink 实参窗口，避免假通过
export function iteratePathItems(req: any, openapiDir: string, outDir: string) {
  const pathName = req.params.name;
  assertWithinDir(openapiDir, path.join(outDir, pathName) + ".yaml", pathName);
  fs.writeFileSync(path.join(outDir, pathName) + ".yaml", "x");
}
`,
    });
    try {
      expect(marksFor(dir, "iteratePathItems")).not.toContain(PATH_MARK);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("G-A：目录包含性校验（canonical 形态）", () => {
  const wrap = (guard: string) => `
import * as fs from "fs";
import * as path from "path";
export function read(req: any) {
  const name = req.params.name;
  const baseDir = path.resolve("/data");
  const target = path.resolve(baseDir, name);
${guard}  return fs.readFileSync(path.join(baseDir, name), "utf-8");
}
`;

  it("去掉包含性判断后必须标记（正对照）", () => {
    const dir = makeProject({ "a.ts": wrap("") });
    try {
      expect(marksFor(dir, "read")).toContain(PATH_MARK);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolve + startsWith(baseDir) → 不得标记", () => {
    const dir = makeProject({
      "a.ts": wrap(
        `  if (!target.startsWith(baseDir)) { throw new Error("outside"); }\n`
      ),
    });
    try {
      expect(marksFor(dir, "read")).not.toContain(PATH_MARK);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("G-D：锚定字符集白名单（种子=fr-007 FLOW_ID_PATTERN）", () => {
  const wrap = (guard: string) => `
import * as fs from "fs";
export function read(req: any) {
  const name = req.params.name;
${guard}  return fs.readFileSync("/data/" + name, "utf-8");
}
`;

  it("去掉白名单校验后必须标记（正对照）", () => {
    const dir = makeProject({ "a.ts": wrap("") });
    try {
      expect(marksFor(dir, "read")).toContain(PATH_MARK);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("/^[A-Za-z0-9_-]+$/ 参与校验 → 不得标记", () => {
    const dir = makeProject({
      "a.ts": wrap(
        `  if (!/^[A-Za-z0-9_-]+$/.test(name)) { throw new Error("bad id"); }\n`
      ),
    });
    try {
      expect(marksFor(dir, "read")).not.toContain(PATH_MARK);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("反例清单：这些形态**不算**守卫（N-A 是头号陷阱）", () => {
  it("N-A path.basename —— fr-012 pre 实测反例：漏洞态就有 basename，必须照旧标记", () => {
    // 注意：污点直接写进 sink 实参窗口（不经 `const x = path.basename(...)` 赋值），
    // 因为「污点经表达式包装后仍传播」是另一条独立的传播缺口（见文末已知边界），
    // 本用例只锁「basename 是否算守卫」这一件事。
    const dir = makeProject({
      "a.ts": `
import * as fs from "fs";
import * as path from "path";
export function read(req: any) {
  const name = req.params.name;
  return fs.readFileSync("/data/" + path.basename(name), "utf-8");
}
`,
    });
    try {
      expect(marksFor(dir, "read")).toContain(PATH_MARK);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("N-B 单独出现的 join/resolve —— 拼接本身不阻止上跳，必须标记", () => {
    const dir = makeProject({
      "a.ts": `
import * as fs from "fs";
import * as path from "path";
export function read(req: any) {
  const name = req.params.name;
  return fs.readFileSync(path.resolve("/data", name), "utf-8");
}
`,
    });
    try {
      expect(marksFor(dir, "read")).toContain(PATH_MARK);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("N-C 长度检查 —— 无法阻止上跳，必须标记", () => {
    const dir = makeProject({
      "a.ts": `
import * as fs from "fs";
export function read(req: any) {
  const name = req.params.name;
  if (name.length > 100) { throw new Error("too long"); }
  return fs.readFileSync("/data/" + name, "utf-8");
}
`,
    });
    try {
      expect(marksFor(dir, "read")).toContain(PATH_MARK);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("N-D 空值检查 —— 空值检查 ≠ 路径包含性检查，必须标记", () => {
    const dir = makeProject({
      "a.ts": `
import * as fs from "fs";
export function read(req: any) {
  const name = req.params.name;
  if (!name) { throw new Error("missing"); }
  return fs.readFileSync("/data/" + name, "utf-8");
}
`,
    });
    try {
      expect(marksFor(dir, "read")).toContain(PATH_MARK);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * ── 已知边界（本次写用例时实测踩到，记录以免后人重复踩）──
 *
 * C4：污点经表达式包装后不再传播。
 *   `const q = path.normalize(x)` / `path.join(x)` / `path.basename(x)` 之后，
 *   q **不在** tainted 集合里（collectTaintedNames 的单跳只认 `= <name>` 直赋）。
 *   后果有二：
 *     ① 召回缺口（这是 C 组的事，本条目不修）；
 *     ② **测试陷阱**：写「不得标记」类用例时，若污点被包装后再进 sink，
 *        用例会**假通过**——不是守卫生效，是污点压根没到 sink。
 *   因此本文件所有 `not.toContain` 用例都配了一条同形状的正对照
 *   （去掉守卫后必须重新标记），缺了正对照的负向断言一律视为无效。
 *   本轮就有 3 条用例最初因此假通过（G-A / G-D / fr-016 形态）。
 */
