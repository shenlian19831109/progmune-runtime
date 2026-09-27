/**
 * §44（2026-09-26）`paramGated` 区分「调用者主体」与「被操作对象」—— 正/反向 fixture
 *
 * 为什么必须有这个文件：§43 已经证明盲测语料对 Authorization 抑制类改动**长期零覆盖**
 * （R62 / R56）。本轮改的是 `paramGated` 这条**门**（6 条规则共用），合成语料里
 * 既没有 `token: string` 这种"被操作对象当身份"的形态，也没有 `user: User` 的对照，
 * ⇒ 光靠闸门会全绿但一条都没触发。这里的 fixture 是它唯一的覆盖。
 *
 * 真值来源（blind-benchmark/reports/paramgate-probe.json，全池 66 条 paramGated 违规）：
 *   压掉的 8 条 = 6 verified FP + 2 heuristic FP，**TP 0 / UNKNOWN 0**
 *     - updateLastUsedForPAT(token: string)      ← 被操作的 PAT（hoppscotch）
 *     - resolveRemoteUser(config: Config, token: string)（verdaccio）
 *     - verifyJWTPayload(token: string, …)       （verdaccio）
 *     - setAuthCookie(res: FastifyReply, token: string)（docmost）
 *   保留的（反例侧）：
 *     - removeUserAvatar(user: User) / createPAT(dto, user: AuthUser) ← 主体是领域对象
 *     - JwtAuthGuard.handleRequest(err: any, user: any, …) ← 类型解析不出来 ⇒ 保守放行
 */
import { describe, it, expect } from "vitest";
import {
  detectSafeguardViolations,
  classifyParamType,
  IDENTITY_PARAM_RE,
} from "./protocol-detector";

/** 只看 4 条 Authorization（本轮 paramGated 收紧影响的就是这几条） */
const authz = (
  calls: string[],
  fnName: string,
  params: string[],
  paramTypes?: string[],
  exposed = false
) =>
  detectSafeguardViolations(calls, fnName, "typescript", params, exposed, paramTypes).filter(
    (v) => v.category === "authorization"
  );

describe("§44 classifyParamType —— 三分类", () => {
  it("标量 ⇒ scalar", () => {
    expect(classifyParamType("string")).toBe("scalar");
    expect(classifyParamType("number")).toBe("scalar");
    expect(classifyParamType("boolean")).toBe("scalar");
    expect(classifyParamType("string[]")).toBe("scalar");
  });
  it("领域类型 ⇒ typed", () => {
    expect(classifyParamType("User")).toBe("typed");
    expect(classifyParamType("AuthUser")).toBe("typed");
    expect(classifyParamType("Admin")).toBe("typed");
    expect(classifyParamType("ExecutionContext")).toBe("typed");
  });
  it("解析不出来 ⇒ unknown（保守，不收紧）", () => {
    expect(classifyParamType("any")).toBe("unknown");
    expect(classifyParamType("unknown")).toBe("unknown");
    expect(classifyParamType("")).toBe("unknown");
    expect(classifyParamType("null")).toBe("unknown");
  });
  it("联合类型按「含领域类型即 typed」处理", () => {
    expect(classifyParamType("User | null")).toBe("typed");
    expect(classifyParamType("AuthenticationType | null")).toBe("typed");
    expect(classifyParamType("string | null")).toBe("scalar");
    // 含 any 的联合不敢判标量 ⇒ typed（保守放行）
    expect(classifyParamType("any | User")).toBe("typed");
  });
});

describe("§44 正对照 —— 唯一的身份线索是标量 ⇒ 那是被操作对象，不是调用者", () => {
  it("updateLastUsedForPAT(token: string) 应被 paramGated 挡下", () => {
    // hoppscotch：被操作的是要更新 lastUsed 的那个 PAT，不是调用者凭证
    expect(
      authz(["extractUUID", "left", "update", "right", "cast"], "updateLastUsedForPAT", ["token"], ["string"])
    ).toHaveLength(0);
  });

  // ⚠ 两条曾用真名 `resolveRemoteUser` / `verifyJWTPayload`，反向验证时**没转红**
  //   ⇒ 它们是被 safeguard（`jwtVerify` / 自身名里的 `verify`）压掉的，不是被
  //   paramGated 压掉的 —— 按 R64/R65 是**假绿**，必须换成能真正压在门上的形态。
  it("updateRemoteUser(config: Config, token: string) 应被挡下", () => {
    // 形态同 verdaccio resolveRemoteUser：token 是待解析的入参，不是调用者凭证
    expect(
      authz(["readFileSync", "split", "at"], "updateRemoteUser", ["config", "token"], ["Config", "string"])
    ).toHaveLength(0);
  });

  // ⚠ 第二版曾用 `rotateSecretValue` —— 反向验证也没转红：`rotate` 不在
  //   Authorization 的 trigger 动词表里，规则压根没触发 ⇒ 恒绿，还是假绿。
  it("updateSecretValue(token: string, secret: string) 应被挡下", () => {
    expect(
      authz(["split", "at", "concat"], "updateSecretValue", ["token", "secret"], ["string", "string"])
    ).toHaveLength(0);
  });
});

describe("§44 反向对照 —— 主体参数必须仍然放行（不能变成无条件抑制）", () => {
  it("removeUserAvatar(user: User) 仍应报 —— 主体是领域对象", () => {
    expect(
      authz(["getAttachmentFolderPath", "deleteRedundantFile", "updateUser"], "removeUserAvatar", ["user"], ["User"])
    ).not.toHaveLength(0);
  });

  it("createPAT(dto, user: AuthUser) 仍应报", () => {
    expect(
      authz(["isValidLength", "create", "cast"], "createPAT", ["dto", "user"], ["CreateAccessTokenDto", "AuthUser"])
    ).not.toHaveLength(0);
  });

  it("user: any 仍应报 —— 类型解析不出来时保守放行（R57：退回旧行为，不是一律压）", () => {
    // ⚠ 函数名不能用 generateJWT —— 它是 isAuthFunctionName 的鉴权机制自身，
    //    authorization 规则对它整体跳过，测不出 paramGated 的门。
    expect(
      authz(["findOne", "save"], "updateProfile", ["user"], ["any"])
    ).not.toHaveLength(0);
  });

  it("user 是标量 string 但函数 exposed ⇒ 仍应报（exposed 是独立的入口证据）", () => {
    expect(
      authz(["update", "save"], "updateProfile", ["user"], ["string"], true)
    ).not.toHaveLength(0);
  });

  it("不传 paramTypes ⇒ 完全保持旧行为（零漂移）", () => {
    // 旧行为：参数名命中 identity 词表即通过门 ⇒ token 也放行
    expect(authz(["update", "save"], "updateLastUsedForPAT", ["token"])).not.toHaveLength(0);
  });
});

describe("§44 IDENTITY_PARAM_RE —— 与旧内联正则同源", () => {
  it("命中身份词（必须是**独立单词**）", () => {
    for (const n of ["user", "token", "session", "role", "request", "credential", "identity"]) {
      expect(IDENTITY_PARAM_RE.test(n)).toBe(true);
    }
  });
  it("复合词一律不算 —— 词边界使然，这是**既有行为**不是本轮引入", () => {
    // ⚠ 顺带记一笔项目债：最地道的 NestJS 主体参数名 `authUser` / `currentUser`
    //   **也不命中**（\buser\b 在 authUser 里没有左边界）。也就是说 paramGated
    //   目前只认 `user` / `token` / `auth` 这类裸标识符。本轮不改（避免与收紧
    //   混在一起），但它是"主体识别"这条轴的下一处缺口。
    for (const n of ["userEmail", "userId", "userRepo", "authUser", "currentUser", "req", "ctx"]) {
      expect(IDENTITY_PARAM_RE.test(n)).toBe(false);
    }
  });
});
