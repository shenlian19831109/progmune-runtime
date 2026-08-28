/**
 * annotation-suggest.test.ts — 注解建议引擎回归（纯函数，无文件系统 I/O）
 *
 * 词汇模式来自 3.7.6 金标 5/5 真实注解反推（REALWORLD_C_V6.md）：
 * check_user_pass/auth_password=verify、handle_PASS=establish、
 * do_RETR/do_STOR/new_session_channel=guard、open/close_data_connection=资源生命周期。
 */
import { describe, it, expect } from "vitest";
import { suggestAnnotations } from "./annotation-suggest";
import type { SuggestFunction } from "./annotation-suggest";

const fn = (name: string, extra: Partial<SuggestFunction> = {}): SuggestFunction => ({
  name,
  file: "src/demo.c",
  ...extra,
});

describe("annotation-suggest", () => {
  it("verify：凭证名词 × 比对动词（check_user_pass / auth_password）", () => {
    const s = suggestAnnotations([fn("check_user_pass"), fn("auth_password")]);
    expect(s).toHaveLength(2);
    for (const x of s) {
      expect(x.role).toBe("verify");
      expect(x.namespace).toBe("auth");
      expect(x.pre).toEqual(["UNAUTHENTICATED"]);
      expect(x.post).toEqual(["PASSWORD_VERIFIED"]);
    }
  });

  it("establish：登录完成原语（handle_PASS / authenticate）", () => {
    const s = suggestAnnotations([fn("handle_PASS"), fn("authenticate")]);
    expect(s.map((x) => [x.function, x.role])).toEqual(
      expect.arrayContaining([
        ["handle_PASS", "establish"],
        ["authenticate", "establish"],
      ])
    );
    expect(s[0].pre).toEqual([]);
    expect(s[0].post).toEqual(["AUTHENTICATED"]);
  });

  it("guard：FTP 命令处理器与通道开启回调（do_RETR/do_STOR/new_session_channel）", () => {
    const s = suggestAnnotations([
      fn("do_RETR"),
      fn("do_STOR"),
      fn("new_session_channel"),
    ]);
    for (const x of s) {
      expect(x.role).toBe("guard");
      expect(x.pre).toEqual(["AUTHENTICATED"]);
      expect(x.post).toEqual(["AUTHORIZED"]);
    }
  });

  it("资源生命周期：open/close_data_connection", () => {
    const s = suggestAnnotations([
      fn("open_data_connection"),
      fn("close_data_connection"),
    ]);
    const open = s.find((x) => x.function === "open_data_connection");
    const close = s.find((x) => x.function === "close_data_connection");
    expect(open?.role).toBe("open");
    expect(open?.post).toEqual(["FILE_OPEN"]);
    expect(close?.role).toBe("close");
    expect(close?.pre).toEqual(["FILE_OPEN"]);
    expect(close?.invalidate).toEqual(["FILE_OPEN"]);
  });

  it("已注解函数不再建议", () => {
    const annotated = fn("check_user_pass", {
      protocol: { pre_states: ["UNAUTHENTICATED"], post_states: ["PASSWORD_VERIFIED"], namespace: "auth" },
    });
    expect(suggestAnnotations([annotated])).toHaveLength(0);
  });

  it("规则名函数（按名即命中）不再建议", () => {
    const s = suggestAnnotations([fn("verify_password")], new Set(["verify_password"]));
    expect(s).toHaveLength(0);
  });

  it("外部函数不再建议", () => {
    expect(suggestAnnotations([fn("check_password", { external: true })])).toHaveLength(0);
  });

  it("模板可直接粘贴：完整注释块文本", () => {
    const [s] = suggestAnnotations([fn("check_user_pass")]);
    expect(s.template).toBe(
      '/* @progmune(namespace="auth", pre=["UNAUTHENTICATED"], post=["PASSWORD_VERIFIED"]) */'
    );
  });

  it("确定性 + 上限：同输入同输出，超过 limit 截断（置信度优先）", () => {
    const fns = Array.from({ length: 30 }, (_, i) =>
      fn(`do_RETR_${i}`) // 全部 guard，单证据 medium
    );
    const a = suggestAnnotations(fns, undefined, 10);
    const b = suggestAnnotations(fns, undefined, 10);
    expect(a).toEqual(b);
    expect(a).toHaveLength(10);
    expect(a[0].function).toBe("do_RETR_0");
  });

  it("无命中词汇的函数不产生建议", () => {
    const s = suggestAnnotations([fn("parse_int"), fn("strlcat"), fn("main")]);
    expect(s).toHaveLength(0);
  });

  it("掩蔽风险：函数体调用已有规则原语 → maskRisk=true", () => {
    const [s] = suggestAnnotations(
      [fn("login_flow", { calls: ["verify_password"] })],
      new Set(["verify_password"])
    );
    expect(s.maskRisk).toBe(true);
  });

  it("掩蔽风险：函数体调用本批同被建议的函数 → maskRisk=true（co-suggestion）", () => {
    const s = suggestAnnotations([
      fn("login_flow", { calls: ["start_file_transfer"] }),
      fn("start_file_transfer"),
    ]);
    const flow = s.find((x) => x.function === "login_flow");
    expect(flow?.maskRisk).toBe(true);
  });

  it("叶子函数（体内无规则原语调用）→ maskRisk=false", () => {
    const [s] = suggestAnnotations([fn("check_user_pass", { calls: ["strcmp", "strlcpy"] })]);
    expect(s.maskRisk).toBe(false);
  });

  it("会话工厂 new_session 不再误判为守卫", () => {
    const s = suggestAnnotations([fn("new_session")]);
    expect(s).toHaveLength(0);
  });

  it("通道守卫 new_session_channel 仍命中 guard", () => {
    const s = suggestAnnotations([fn("new_session_channel")]);
    expect(s).toHaveLength(1);
    expect(s[0].role).toBe("guard");
  });
});
