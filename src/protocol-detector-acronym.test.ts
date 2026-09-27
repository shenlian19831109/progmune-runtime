/**
 * §41 E1（2026-09-25）：token 内嵌 acronym 的**局部**补认 —— 正/反向 fixture
 *
 * 背景：C5 原案是「改主干 identifierParse 让 JWTPayload 拆出 JWT」。
 * `split-probe.ts` 实测否决了它（详见 src 里 ACRONYM_PREFIX 的注释）：
 *   803 个去重标识符里只有 16 个受影响、新增 22 词中仅 2 个（JWT/OIDC）是机制类，
 *   其余是 `OAuthToken→Auth`、`createATeam→A,Team` 这类噪声；
 *   而 identifierParse 还供给 triggerParsedWords ⇒ 动它等于改全局触发面。
 * ⇒ 最终落地的是**只在 isAuthMachineryName 的对象侧**补认 acronym。
 *
 * 为什么必须有这里的 fixture（同 §40，R56）：改动方向是「压掉告警」，
 * 而 generated/ 合成语料里**没有** `verifyJWTPayload` 这类形态 ⇒
 * 盲测零漂移很可能是零触发。**这里是唯一能证明这段判据活着的证据。**
 */
import { describe, it, expect } from "vitest";
import { detectSafeguardViolations, tokenAcronyms } from "./protocol-detector";

/** 只关心 authorization 类目（本轮只影响这一类目） */
const authz = (fnName: string, calls = ["deleteSpace", "findOne"]) =>
  detectSafeguardViolations(calls, fnName, "typescript", ["user", "id"], true).filter(
    (v) => /^Authorization/i.test(v.rule)
  );

describe("§41 E1 正向：acronym 卡在函数名的机制对象里（应该被认成鉴权机制）", () => {
  it("verifyJWTPayload —— §40 剩余池待救的那条（verdaccio packages/auth/src/utils.ts）", () => {
    expect(authz("verifyJWTPayload")).toHaveLength(0);
  });

  it("verifyJWTPayload 带触发 trigger 也一样压", () => {
    expect(authz("verifyJWTPayload", ["getTarball", "readPackage"])).toHaveLength(0);
  });

  it("JWTRemote 类托管的 jwt 机制方法", () => {
    expect(authz("JwtRemote.getJWTRemote")).toHaveLength(0);
  });

  it("类限定形式 AvailabilityService.verifyJWTPayload", () => {
    expect(authz("AvailabilityService.verifyJWTPayload")).toHaveLength(0);
  });

  it("createJWTToken —— 唯有 E1 才救得回来的一条（反向验证揪出来的错误假设）", () => {
    // ⚠ 这条曾经被我标成「BASE 就命中」，是**错的**：
    //   identifierParse("createJWTToken") → ["create","JWTToken"]
    //   ⇒ 对象侧只拿到 "jwttoken"，既 ≠ jwt 也 ≠ token ⇒ BASE **不命中**。
    //   反向验证（把 machineryWords 退回 identifierParse）让它转红才发现。
    //   教训同 R59：凭印象断言既有行为，与口径漂移是同一类错误。
    expect(authz("createJWTToken")).toHaveLength(0);
  });

  it("⚠ verifyOIDCToken 不收 —— oidc 只在**容器侧**名词表，**不在方法对象词表**", () => {
    // §39.8 的收窄是有意的：对象侧一旦放宽到 oauth/oidc/saml，
    // `ApiTokensController.deleteToken` 这类凭据 CRUD 会被误压（V-D 教训）。
    // 剩余池里没有待救的 verifyOIDCToken 形态 ⇒ 按 R50 不为此扩词表。
    expect(authz("verifyOIDCToken").length).toBeGreaterThan(0);
  });

  it("verifySSLSignature 不在机制对象词表 ⇒ 仍报（词表不含 ssl，别幻想）", () => {
    expect(authz("verifySSLSignature").length).toBeGreaterThan(0);
  });
});

/**
 * `tokenAcronyms` 的直接单元测试 —— 端到端 fixture 覆盖不到这两条约束，
 * 因为**对象侧 acronym 与 BASE 的重叠度极高**（凡 acronym 等于 jwt/token/…
 * 的，BASE 下独立 token 本来也就命中了），端到端分不出「约束生效」与
 * 「恰好 BASE 也命中」。剩下来真正会被 `${2,}` 拦住的，只有单字母情形。
 */
describe("§41 tokenAcronyms 表驱动：两条约束（≥2 字母 / 贪婪回溯）", () => {
  const cases: Array<[string, string[]]> = [
    ["JWTPayload", ["JWT"]],
    ["OIDCStrategy", ["OIDC"]], // ← 贪婪：非贪婪会停在 "OID"，救不了这条
    ["HTTPErr", ["HTTP"]],
    ["CLIError", ["CLI"]],
    ["JWTToken", ["JWT"]],
    // 以下必须为空：单字母 / 纯 PascalCase / 已有独立词
    ["OAuth", []], // ← 放宽到 {1,} 就会产出 "O"
    ["ATeam", []],
    ["YElement", []],
    ["Token", []],
    ["Payload", []],
    ["payload", []],
    ["JWTPayloadService", ["JWT"]], // 边界：最后一个大写归后词 ⇒ 不会吃成 "JWTP"
  ];
  for (const [input, want] of cases) {
    it(`${input} → ${JSON.stringify(want)}`, () => {
      expect(tokenAcronyms(input)).toEqual(want);
    });
  }
});

describe("§41 E1 反向：不得把非机制名字误认成机制（R57 宽变体约束）", () => {
  it("⚠ validateOAuthToken —— BASE 就会命中（validate × Token），与 acronym 无关", () => {
    // 存在意义：端到端根本测不出「OAuth 被拆出 Auth」—— 因为这条 BASE 下也压。
    // 若有人把 `{2,}` 放宽成 `{1,}`，`OAuth` → "O"，而 "O" 不在任何词表里
    // ⇒ 端到端行为完全不变，**回归无从发现**。单字母噪声只有在表驱动层才可见。
    expect(authz("validateOAuthToken")).toHaveLength(0);
  });

  it("⚠ createATeam 不得拆出 Team 之外的机制词", () => {
    expect(authz("AdminService.createATeam").length).toBeGreaterThan(0);
  });

  it("⚠ throwHTTPErr 不得因 HTTP 被当成机制", () => {
    expect(authz("throwHTTPErr").length).toBeGreaterThan(0);
  });

  it("⚠ createCLIErrorResponse 不得因 CLI/Error 被当成机制", () => {
    expect(authz("createCLIErrorResponse").length).toBeGreaterThan(0);
  });

  it("⚠ 纯 PascalCase 词不得被再切一遍（Token → T/oken 之类的臆想不生效）", () => {
    expect(authz("deleteExpiredToken").length).toBeGreaterThan(0);
  });

  it("⚠ 动词缺失 ⇒ acronym 对象不算（只有对象没有机制动词）", () => {
    // mw 必须同时含 VERB × OBJECT；JWTPayload 单独不是机制
    expect(authz("logJWTPayload").length).toBeGreaterThan(0);
  });

  /**
   * 最要紧的一条反向：**凭据增删改**即使名字里含 JWT 也不能压 —— 与 §39 V-D、
   * §40 W4 同源教训。这条守的是「约束在于组合，不在于 acronym 本身」。
   */
  it("⚠️ createJWTToken 是依赖 E1 的哨兵 ⇒ 反向验证时必须转红", () => {
    // §41 反向验证实测（把 machineryWords 退回 identifierParse）：
    // 全套 76 条里 **6 条**转红，其余 70 条（§38/§39/§40）纹丝不动
    // ⇒ E1 的影响面被严格锁在「机制对象侧 acronym」这一格，没有横向污染。
    // 这条 earlier 被错写成「GENERATE 类动词…既有口径一致」—— 与 R59 同源的
    // 「凭印象断言既有行为」，已据反向验证的实测更正。
    expect(authz("createJWTToken")).toHaveLength(0);
  });

  it("⚠ 与 §40 C4 的分工：容器=Auth 且方法受保护动词开头 ⇒ 不压", () => {
    expect(authz("Auth.changeJWTToken").length).toBeGreaterThan(0);
  });
});
