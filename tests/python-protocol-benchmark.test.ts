/**
 * Python 协议盲测 harness 回归测试
 *
 * 用生成器在临时目录生成最小语料，走生产 SSG 桥接校验器（无 LLM），断言：
 *   - T1 broken：2 处植入全部检出（file+function 定位）
 *   - T0 clean：0 误报（含分离式清洁链——helper 片段抑制，P4.6）
 *   - T5 endState：2 处资源未释放全部检出（endState 检查已上线）
 *   - T6 cross-function：helper 内违规归因到入口 flow（P4.6 展开）
 *   - S5 renamed：词段匹配覆盖改名协议函数（任意命名验证）
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

  it("T6 cross-function：helper 内违规归因到入口 flow（P4.6 展开）", () => {
    const plants = generateProtocolProject("proto_T6_S1", findType("T6"), STYLES[0], tmpDir);
    expect(plants).toHaveLength(2);

    const result = scanProjectProtocol(path.join(tmpDir, "proto_T6_S1"), "proto_T6_S1");

    expect(result.violations).toHaveLength(2);
    for (const v of result.violations) {
      expect(v.file).toBe("auth.py");
      expect(v.failingFunction).toBe("generate_jwt");
    }
    const fns = result.violations.map((v) => v.function).sort();
    expect(fns).toEqual(["mint_flow_a", "mint_flow_b"]);
  });

  it("T0 分离式清洁链：helper 片段抑制，零误报（P4.6 FP 锁定）", () => {
    generateProtocolProject("proto_T0_S1", findType("T0"), STYLES[0], tmpDir);

    const result = scanProjectProtocol(path.join(tmpDir, "proto_T0_S1"), "proto_T0_S1");

    // safe_login（verify 在 flow、issue 在 helper）与 safe_read（open 在 flow、
    // read+close 在 helper）必须通过——旧模型会在 helper 上产生片段误报
    expect(result.violations).toHaveLength(0);
  });

  it("S5 renamed：词段匹配覆盖改名协议函数（任意命名验证）", () => {
    const plants = generateProtocolProject("proto_T1_S5", findType("T1"), STYLES[4], tmpDir);
    expect(plants).toHaveLength(2);

    const result = scanProjectProtocol(path.join(tmpDir, "proto_T1_S5"), "proto_T1_S5");

    // create_active_session → 词段匹配到内置 create_session 规则（TOKEN_ISSUED 前置）
    expect(result.violations).toHaveLength(2);
    for (const v of result.violations) {
      expect(v.file).toBe("auth.py");
      expect(v.reason).toContain("create_session");
    }
  });
});
