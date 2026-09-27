/**
 * §46 ① 凭签发入口豁免（credential_issuance）—— 语义与对称性
 *
 * 背景：`create_access_token|create_refresh_token|create_jwt_token` 只存在于
 * `Authorization (Unauthenticated Mutation)` 的 auth_check 词表里，`Access` 没有。
 * §45 做集合 diff 时发现过，当时以「签发 ≠ 校验调用者」为由没有补进去。§46 把这三个词
 * 从 auth_check **移出**，单独成立一条 `credential_issuance` safeguard（行为不变，语义自洽）。
 *
 * 本文件钉住三件事：
 *   1. 写类函数调用签发函数 ⇒ 豁免（login/register 入口天然不需要事前认证）
 *   2. 读类函数调用签发函数 ⇒ **仍报**（不对称 —— R66：同形状存在相反真值）
 *   3. 它压的是「入口」而非「认证」：与真正的 auth_check 不是一回事
 *
 * ⚠ 名字必须避开 §39 AUTH_PATTERN：ownName/calls 含 User/Token/Auth 会被
 *   「鉴权机制自身」抢先压掉，测不出本机制（R65 唯一压制来源）。
 */
import { describe, it, expect } from "vitest";
import { detectSafeguardViolations } from "./protocol-detector";

/** 只取 Authorization 族，避免别的规则干扰断言 */
const az = (calls: string[], own: string) =>
  detectSafeguardViolations(calls, own, "typescript", ["user"], false, ["AuthUser"])
    .filter((v) => v.rule.startsWith("Authorization"))
    .map((v) => v.rule);

describe("§46 ① credential_issuance —— 写类豁免", () => {
  it("写类 + create_access_token ⇒ 免（登录/注册入口天然无需事前认证）", () => {
    expect(az(["create_access_token", "save"], "createThing")).toHaveLength(0);
  });

  it("写类 + create_jwt_token ⇒ 免", () => {
    expect(az(["create_jwt_token", "save"], "createThing")).toHaveLength(0);
  });

  it("写类 + create_refresh_token ⇒ 免", () => {
    expect(az(["create_refresh_token", "save"], "createThing")).toHaveLength(0);
  });

  it("反向对照：写类 + 无签发/无认证 ⇒ 仍报", () => {
    expect(az(["save", "insert"], "createThing")).toContain(
      "Authorization (Unauthenticated Mutation)"
    );
  });
});

describe("§46 ① credential_issuance —— 不得对称补进读类（R66）", () => {
  it("读类 + create_access_token ⇒ 仍报 Unauthenticated Access", () => {
    // 若将来有人按「词表对齐」把 mint 补进 Access 词表，这条会转红 —— 那正是要拦的改动。
    // 理由：调用 create_access_token 说明该函数**在签发**令牌，而不是校验调用者；
    //       getRefreshToken(userId) 与 getUserToken(userId) 在这个轴上完全同形。
    expect(az(["create_access_token", "query"], "getThing")).toContain(
      "Authorization (Unauthenticated Access)"
    );
  });

  it("读类 + create_jwt_token ⇒ 仍报", () => {
    expect(az(["create_jwt_token", "query"], "getThing")).toContain(
      "Authorization (Unauthenticated Access)"
    );
  });

  it("读类 + 无认证 ⇒ 仍报（口径不变）", () => {
    expect(az(["query", "find"], "getThing")).toContain(
      "Authorization (Unauthenticated Access)"
    );
  });
});

describe("§46 ① 签发 ≠ 认证 —— 机制归属", () => {
  it("真正的认证调用在读写两类上都豁免（对照）", () => {
    expect(az(["getSession", "save"], "createThing")).toHaveLength(0);
    expect(az(["getSession", "query"], "getThing")).toHaveLength(0);
  });

  it("签发调用只在写类上豁免 ⇒ 两者不是同一类证据", () => {
    const mutation = az(["create_access_token", "save"], "createThing");
    const access = az(["create_access_token", "query"], "getThing");
    expect(mutation).toHaveLength(0);
    expect(access.length).toBeGreaterThan(0);
  });
});
