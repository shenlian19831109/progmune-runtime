/**
 * Python 协议盲测 harness 回归测试
 *
 * 用生成器在临时目录生成最小语料（broken / clean / endState 各一个），
 * 走生产 SSG 桥接校验器（无 LLM），断言：
 *   - T1 broken：2 处植入全部检出（file+function 定位）
 *   - T0 clean：0 误报
 *   - T5 endState：2 处资源未释放全部检出（endState 检查已上线）
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  generateProtocolProject,
  VIOLATION_TYPES,
  STYLES,
} from "../blind-benchmark/generate-projects-protocol-python";
import { scanProjectProtocol } from "../blind-benchmark/scan-protocol-python";

let tmpDir: string;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-proto-bench-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function findType(id: string) {
  return VIOLATION_TYPES.find((t) => t.id === id)!;
}

describe("Python 协议盲测 harness", () => {
  it("T1 broken：2 处植入全部检出，定位精确", () => {
    const plants = generateProtocolProject("proto_T1_S1", findType("T1"), STYLES[0], tmpDir);
    expect(plants).toHaveLength(2);

    const result = scanProjectProtocol(path.join(tmpDir, "proto_T1_S1"), "proto_T1_S1");

    expect(result.violations).toHaveLength(2);
    for (const v of result.violations) {
      expect(v.file).toBe("auth.py");
      expect(v.failingFunction).toBe("create_session");
      expect(v.reason).toContain("TOKEN_ISSUED");
    }
    const fns = result.violations.map((v) => v.function).sort();
    expect(fns).toEqual(["issue_session", "start_checkout"]);
  });

  it("T0 clean：完整认证链与文件链零误报", () => {
    generateProtocolProject("proto_T0_S1", findType("T0"), STYLES[0], tmpDir);

    const result = scanProjectProtocol(path.join(tmpDir, "proto_T0_S1"), "proto_T0_S1");

    expect(result.sequenceCount).toBeGreaterThan(0);
    expect(result.violations).toHaveLength(0);
  });

  it("T5 endState：open 后不 close 全部检出（资源未释放）", () => {
    const plants = generateProtocolProject("proto_T5_S1", findType("T5"), STYLES[0], tmpDir);
    expect(plants.every((p) => p.detectionExpected === true)).toBe(true);

    const result = scanProjectProtocol(path.join(tmpDir, "proto_T5_S1"), "proto_T5_S1");

    expect(result.violations).toHaveLength(2);
    for (const v of result.violations) {
      expect(v.file).toBe("files.py");
      expect(v.reason).toContain("end-state");
      expect(v.reason).toContain("FILE_OPEN");
    }
    const fns = result.violations.map((v) => v.function).sort();
    expect(fns).toEqual(["read_config_only", "read_log_only"]);
  });
});
