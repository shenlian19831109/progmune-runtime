/**
 * call-sequence (P4.6 跨函数传播) — 单元测试。
 *
 * 重点覆盖 2026-08-27 引入的同翻译单元（文件）绑定语义：
 * 调用解析优先同文件定义（C 跨文件同名 static 函数不再 last-wins 错绑），
 * 入口判定按 文件+名字 粒度。
 *
 * 注意叶子规则：只调外部原语的函数保留名字不内联（S5 改名协议函数的
 * 保护），夹具需用两级项目函数链使绑定可判别。
 */

import { describe, it, expect } from "vitest";
import { buildCallSequences, collectProjectFunctionNames, isProjectFn } from "./call-sequence";
import type { FunctionInfo } from "./extract-ir";

/** 构造最小 FunctionInfo（isProjectFn 契约：external=false + 真实 file） */
function fn(name: string, file: string, calls: string[]): FunctionInfo {
  return { name, params: [], returnType: "void", file, calls, exported: true, external: false };
}

describe("buildCallSequences（文件级绑定）", () => {
  it("跨文件同名 static 函数：调用绑定到同文件定义，而不是 last-wins", () => {
    const ir = [
      // A 文件：static x → distinct_a（本文件项目函数）
      fn("x", "a.c", ["distinct_a"]),
      fn("distinct_a", "a.c", ["g"]),
      fn("entry_a", "a.c", ["x"]),
      // B 文件：static x → distinct_b（若 last-wins 且 B 后注册，entry_a 会错绑到 B 的 x）
      fn("x", "b.c", ["distinct_b"]),
      fn("distinct_b", "b.c", ["h"]),
      fn("entry_b", "b.c", ["x"]),
    ];
    const seqs = buildCallSequences(ir);
    const byFn = new Map(seqs.map((s) => [s.function, s.calls]));

    expect(byFn.get("entry_a")).toEqual(["distinct_a"]);
    expect(byFn.get("entry_b")).toEqual(["distinct_b"]);
  });

  it("文件内回调接回序列：cf->close_one() 产出 close_one，同文件定义被内联", () => {
    // 提取器对 cf->close_one() 只产出调用名 close_one；同文件定义 close_one 时
    // 文件级绑定将其函数体（经 notify_peer）内联进调用方序列
    const ir = [
      fn("close_one", "conn.c", ["notify_peer"]),
      fn("notify_peer", "conn.c", ["send_fin"]),
      fn("shutdown_conn", "conn.c", ["close_one"]),
    ];
    const seqs = buildCallSequences(ir);
    expect(seqs).toHaveLength(1);
    expect(seqs[0].function).toBe("shutdown_conn");
    expect(seqs[0].calls).toEqual(["notify_peer"]);
  });

  it("入口判定按文件粒度：A 的 x 被调用非入口，B 的同名 x 未被调用仍是入口", () => {
    const ir = [
      fn("x", "a.c", ["distinct_a"]),
      fn("distinct_a", "a.c", ["g"]),
      fn("entry_a", "a.c", ["x"]),
      fn("x", "b.c", ["h"]), // B 的 x 无调用者 → 仍是入口
    ];
    const seqs = buildCallSequences(ir);
    const names = seqs.map((s) => s.function).sort();
    expect(names).toEqual(["entry_a", "x"]);
    // 唯一名为 x 的序列来自 b.c（A 的 x 已并入 entry_a）
    const xSeq = seqs.find((s) => s.function === "x")!;
    expect(xSeq.file).toBe("b.c");
    expect(xSeq.calls).toEqual(["h"]);
  });

  it("无同文件定义时回退全局按名（跨文件唯一名的既有行为不变）", () => {
    const ir = [
      fn("helper", "lib.c", ["util"]),
      fn("util", "lib.c", ["primitive"]),
      fn("entry", "app.c", ["helper"]),
    ];
    const seqs = buildCallSequences(ir);
    expect(seqs).toHaveLength(1);
    expect(seqs[0].calls).toEqual(["util"]);
  });

  it("规则名保留单元不内联（keepNames），文件级绑定不影响", () => {
    const ir = [
      fn("verify_password", "auth.c", ["check_hash"]),
      fn("login", "auth.c", ["verify_password"]),
    ];
    const seqs = buildCallSequences(ir, new Set(["verify_password"]));
    expect(seqs).toHaveLength(1);
    expect(seqs[0].function).toBe("login");
    expect(seqs[0].calls).toEqual(["verify_password"]);
  });
});

describe("collectProjectFunctionNames", () => {
  it("全名/裸名/小写三形态收录", () => {
    const ir = [fn("FlowService.svc_x", "a.ts", [])];
    const names = collectProjectFunctionNames(ir);
    expect(names.has("FlowService.svc_x")).toBe(true);
    expect(names.has("svc_x")).toBe(true);
    expect(names.has("flowservice.svc_x")).toBe(true);
    expect(names.has("svc_x".toLowerCase())).toBe(true);
  });

  it("external 条目不收录", () => {
    const external: FunctionInfo = { name: "readFileSync", params: [], returnType: "void", file: "(external)", calls: [], external: true };
    expect(isProjectFn(external)).toBe(false);
    expect(collectProjectFunctionNames([external]).size).toBe(0);
  });
});
