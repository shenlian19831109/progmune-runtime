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

describe("buildCallSequences（调用预算 / 截断，兆级序列防护）", () => {
  it("超预算截断：序列长度 = maxCalls，truncated 标记", () => {
    const ext = Array.from({ length: 15 }, (_, i) => `ext_${i}`);
    const ir = [fn("entry", "a.c", ext)];
    const seqs = buildCallSequences(ir, undefined, 10);
    expect(seqs).toHaveLength(1);
    expect(seqs[0].calls).toHaveLength(10);
    expect(seqs[0].calls).toEqual(ext.slice(0, 10)); // 入口自身调用按序优先
    expect(seqs[0].truncated).toBe(true);
  });

  it("预算内序列：无 truncated 标记（现有语料零影响）", () => {
    const ir = [fn("entry", "a.c", ["g", "h"])];
    const seqs = buildCallSequences(ir, undefined, 2000);
    expect(seqs).toHaveLength(1);
    expect(seqs[0].calls).toEqual(["g", "h"]);
    expect(seqs[0].truncated).toBeUndefined();
  });

  it("内联超预算：已发出的调用保留，入口后续调用被截（召回边界语义）", () => {
    const bigBody = Array.from({ length: 20 }, (_, i) => `big_call_${i}`);
    const ir = [
      fn("helper", "a.c", ["ext"]), // 项目函数：big 因调它而可内联（叶子规则）
      fn("big", "a.c", ["helper", ...bigBody]),
      fn("entry", "a.c", ["big", "tail_call"]),
    ];
    const seqs = buildCallSequences(ir, undefined, 5);
    expect(seqs).toHaveLength(1);
    expect(seqs[0].calls).toEqual(["helper", "big_call_0", "big_call_1", "big_call_2", "big_call_3"]);
    expect(seqs[0].truncated).toBe(true);
  });

  it("多入口各自独立预算", () => {
    const ext = Array.from({ length: 8 }, (_, i) => `ext_${i}`);
    const ir = [fn("e1", "a.c", ext), fn("e2", "b.c", ext)];
    const seqs = buildCallSequences(ir, undefined, 5);
    expect(seqs).toHaveLength(2);
    for (const s of seqs) {
      expect(s.calls).toHaveLength(5);
      expect(s.truncated).toBe(true);
    }
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

// ── 限定调用末段回退解析（Java 接收者限定输出，2026-09-06）──

/** 带 className 的最小 FunctionInfo（Java 接收者限定语义） */
function fnQ(name: string, file: string, calls: string[], className?: string): FunctionInfo {
  return { name, params: [], returnType: "void", file, calls, exported: true, external: false, className };
}

describe("buildCallSequences（限定调用回退解析）", () => {
  it("限定调用末段回退：无注解项目 helper 经接收者解析后被内联（P4.6 深度恢复）", () => {
    const ir = [
      fnQ("save", "MyBatisUserRepository.java", ["insertUser"], "MyBatisUserRepository"),
      fnQ("insertUser", "MyBatisUserRepository.java", ["db.execute"]),
      fnQ("updateUser", "UserService.java", ["userRepository.save"]),
    ];
    const seqs = buildCallSequences(ir);
    expect(seqs).toHaveLength(1);
    expect(seqs[0].function).toBe("updateUser");
    // save 被解析并内联 → insertUser（叶子）保留
    expect(seqs[0].calls).toEqual(["insertUser"]);
  });

  it("限定调用命中保留集（大小写不敏感）：规则 token 不解析不内联", () => {
    const ir = [
      fnQ("update", "User.java", ["audit"], "User"),
      fnQ("audit", "User.java", ["db.write"]),
      fnQ("updateUser", "UserService.java", ["user.update"]),
    ];
    // 规则键 = 类限定（User.update）；调用 = 变量限定（user.update）——大小写差异
    const seqs = buildCallSequences(ir, new Set(["User.update"]));
    expect(seqs).toHaveLength(1);
    expect(seqs[0].function).toBe("updateUser");
    // 保留 token 而非内联（audit 不得出现）
    expect(seqs[0].calls).toEqual(["user.update"]);
  });

  it("接收者-类名后缀偏好：同名 save 绑定到接收者对应类（userRepository → MyBatisUserRepository）", () => {
    const ir = [
      fnQ("save", "MyBatisUserRepository.java", ["insertUser"], "MyBatisUserRepository"),
      fnQ("save", "MyBatisArticleRepository.java", ["insertArticle"], "MyBatisArticleRepository"),
      fnQ("insertUser", "MyBatisUserRepository.java", ["db.execute"]),
      fnQ("insertArticle", "MyBatisArticleRepository.java", ["db.execute"]),
      fnQ("updateUser", "UserService.java", ["userRepository.save"]),
      fnQ("updateArticle", "ArticleCommandService.java", ["articleRepository.save"]),
    ];
    const seqs = buildCallSequences(ir);
    const byFn = new Map(seqs.map((s) => [s.function, s.calls]));
    expect(byFn.get("updateUser")).toEqual(["insertUser"]);
    expect(byFn.get("updateArticle")).toEqual(["insertArticle"]);
  });

  it("入口判定：仅被限定名调用的函数不是入口", () => {
    const ir = [
      fnQ("save", "MyBatisUserRepository.java", ["db.execute"]),
      fnQ("updateUser", "UserService.java", ["userRepository.save"]),
    ];
    const seqs = buildCallSequences(ir);
    expect(seqs.filter((s) => s.function === "save")).toHaveLength(0);
    expect(seqs).toHaveLength(1);
  });
});
