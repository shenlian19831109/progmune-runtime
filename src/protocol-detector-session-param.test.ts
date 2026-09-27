/**
 * §47：签名级会话证据 —— 参数类型以 `Session` 结尾 ⇒ 「未认证」结论不成立。
 *
 * 为什么不是继续在 calls 里找 auth 词：hedgedoc 的 pending-user 三个接口 +
 * OidcController.callback 都是 `@UseGuards(SessionGuard)` 保护的会话类路由，
 * 但它们**一个认证函数都不调用** —— 身份是从 `request.session.*` 上取的，
 * 调用列表里只有 property access，选择器读不到。真实池里这四条全是人工确认的 FP。
 *
 * 改用**参数类型**：签名上存在 session 对象 ⇒ 这次调用必然落在某个会话上下文里。
 * 好处是它来自 AST 签名，不依赖调用图连通（fp-pool 入边 0 的函数占 36%~42%，
 * 依赖 calls 的机制在那里会静默失效）。
 *
 * ⚠ R66 的否命题在本文件 §47 反向② 组：
 *   有会话 ≠ 操作对象属于自己。越权读取的同形状反例必须 Unauthenticated 熄灭
 *   而 **Ownership 继续亮**，否则这一刀就是把越权漏洞洗白。
 */
import { describe, it, expect } from "vitest";
import { detectSafeguardViolations } from "./protocol-detector";

const ACC = "Authorization (Unauthenticated Access)";
const MUT = "Authorization (Unauthenticated Mutation)";
const OWN = "Authorization (Ownership Check)";
const RES = "Authorization (Resource Ownership)";

/** lang 固定 typescript；params/paramTypes 逐用例给定 */
function fire(
  calls: string[],
  name: string,
  params: string[],
  paramTypes: string[]
): Set<string> {
  const vs = detectSafeguardViolations(calls, name, "typescript", params, false, paramTypes);
  return new Set(vs.map((v) => v.rule));
}
const lit = (b: boolean) => (b ? "fires" : "silent");

describe("§47 正向：签名带会话 ⇒ Unauthenticated 两条熄灭（hedgedoc 真实 FP）", () => {
  it("getPendingUserData(request: RequestWithSession) 不再报未认证读取", () => {
    const s = fire(["create"], "getPendingUserData", ["request"], ["RequestWithSession"]);
    expect(lit(s.has(ACC))).toBe("silent");
  });

  it("confirmPendingUserData(request: RequestWithSession, dto) 不再报未认证变更", () => {
    const s = fire(
      ["createUserWithIdentityFromPendingUserConfirmation", "save"],
      "confirmPendingUserData",
      ["request", "pendingUserConfirmationData"],
      ["RequestWithSession", "PendingUserConfirmationDto"]
    );
    expect(lit(s.has(MUT))).toBe("silent");
  });

  it("OidcController.callback —— session 不在第一个参数也算数", () => {
    const s = fire(
      ["extractUserInfoFromCallback", "getExistingOidcIdentity", "mayUpdateIdentity", "save"],
      "OidcController.callback",
      ["oidcIdentifier", "request"],
      ["string", "RequestWithSession"]
    );
    expect(lit(s.has(ACC))).toBe("silent");
    expect(lit(s.has(MUT))).toBe("silent");
  });

  it("裸 Session 类型同样成立（不要求 Request 前缀）", () => {
    const s = fire(["find"], "getProfile", ["session"], ["Session"]);
    expect(lit(s.has(ACC))).toBe("silent");
  });
});

describe("§47 反向①：摘掉这一刀必须重新亮（证明是它在压，不是别机制抢先）", () => {
  it("同函数把 RequestWithSession 换成 Request ⇒ 未认证读取重新报", () => {
    const s = fire(["create"], "getPendingUserData", ["request"], ["Request"]);
    expect(lit(s.has(ACC))).toBe("fires");
  });

  // 注意这里**不是** §47 在压：`request` 的类型退化成标量后，是 §44 的 paramGated
  // 先把规则整体跳过了（标量参数不算身份证据）。单独留一条是为了把两层闸门的关系钉住：
  // 类型通道同时喂给 paramGate（§44）和 paramTypeSafeguards（§47），
  // 断言这一条可以防止以后有人误以为「类型一变就该亮」。
  it("request:string 时由 §44 paramGate 先行跳过 —— 记录两层闸门的先后关系", () => {
    const s = fire(
      ["createUserWithIdentityFromPendingUserConfirmation", "save"],
      "confirmPendingUserData",
      ["request", "pendingUserConfirmationData"],
      ["string", "PendingUserConfirmationDto"]
    );
    expect(lit(s.has(MUT))).toBe("silent");
  });

  it("不传类型通道时退回旧行为（仍报）—— R57 要求通道不可用时不得静默压", () => {
    const vs = detectSafeguardViolations(["create"], "getPendingUserData", "typescript", ["request"]);
    expect(lit(vs.some((v) => v.rule === ACC))).toBe("fires");
  });
});

describe("§47 反向②：有会话 ≠ 有权 —— 越权形态的 Unauthenticated 熄灭但 Ownership 必须继续亮", () => {
  it("removeSharedFile(req: RequestWithSession, id) —— 归属检查不能随会话一起被免掉", () => {
    const s = fire(
      ["findById", "removeFile"],
      "removeSharedFile",
      ["request", "id"],
      ["RequestWithSession", "string"]
    );
    expect(lit(s.has(MUT))).toBe("silent");
    expect(lit(s.has(OWN))).toBe("fires");
  });

  it("deleteOtherUsersNote(session: Session, noteId) —— Resource Ownership 必须继续亮", () => {
    const s = fire(
      ["findNote", "deleteNote"],
      "deleteOtherUsersNote",
      ["session", "noteId"],
      ["Session", "string"]
    );
    expect(lit(s.has(MUT))).toBe("silent");
    expect(lit(s.has(OWN) || s.has(RES))).toBe("fires");
  });
});

describe("§47 边界：类型名不得以 Session 收尾就被误当成会话", () => {
  const cases: Array<[string, string]> = [
    ["Transaction", " mutation"],
    ["SessionOptions", "配置对象不是会话本身"],
    ["Partial<AuthConf>", "verdaccio addAuth 的真类型"],
    ["Knex", "查询构造器"],
  ];
  for (const [type, why] of cases) {
    it(`${type} 不应被当作会话（${why.trim()}）`, () => {
      const s = fire(["merge"], "addAuth", ["auth"], [type]);
      expect(lit(s.has(MUT))).toBe("fires");
    });
  }
});
