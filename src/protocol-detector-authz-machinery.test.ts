/**
 * §39（2026-09-25）D 类自指排除 —— 正/反向 fixture
 *
 * 为什么必须有这个文件：与 §38 同因。本轮改的是「哪些函数算鉴权机制自身」，
 * 盲测语料（blind-benchmark/generated/ 合成项目）里没有 JwtAuthGuard /
 * AbilityFactory 这类形态 ⇒ 盲测会零漂移，但同时**一条都没触发**（R56：
 * 零漂移 ≠ 验证通过）。没有这里的 fixture，这段判据就是零覆盖进主干。
 *
 * ⚠ 反向 fixture 比正向更要紧：这条判据的作用是**压掉**告警，
 *   压错方向就是真漏报且不可见（R49 的镜像）。所以每一条「不得压掉」的
 *   形态都必须钉死，尤其是**对凭据做增删改**的端点（那是最需要鉴权的地方）。
 *
 * 每条都对应真值集/真实扫描里人工核对过的代码：
 *   JwtAuthGuard.handleRequest        ← docmost src/common/guards/jwt-auth.guard.ts
 *   WorkspaceAbilityFactory.createForUser ← docmost src/core/casl/abilities/
 *   ApiTokensController.deleteToken   ← hedgedoc（凭据 CRUD，不得压）
 *   AccessTokenService.updateLastUsedForPAT ← hoppscotch（凭据 CRUD，不得压）
 */
import { describe, it, expect } from "vitest";
import { detectSafeguardViolations } from "./protocol-detector";

/** 只关心 authorization 类目（本轮只影响这一类目） */
const authz = (fnName: string) =>
  detectSafeguardViolations(["deleteSpace", "findOne"], fnName, "typescript", ["user", "id"], true).filter(
    (v) => /^Authorization/i.test(v.rule)
  );

describe("§39 自指排除 —— 正对照（鉴权机制自身 ⇒ 压掉）", () => {
  it("JwtAuthGuard 守卫本体", () => {
    expect(authz("JwtAuthGuard.handleRequest")).toHaveLength(0);
  });

  it("JwtAuthGuard 里写 cookie", () => {
    expect(authz("JwtAuthGuard.setJoinedWorkspacesCookie")).toHaveLength(0);
  });

  it("Auth 控制器置 cookie（登录流程的一部分）", () => {
    expect(authz("AuthController.setAuthCookie")).toHaveLength(0);
  });

  it("Auth 服务签发协作 token", () => {
    expect(authz("AuthService.getCollabToken")).toHaveLength(0);
  });

  it("Token 服务校验 jwt（纯原语）", () => {
    expect(authz("TokenService.verifyJwt")).toHaveLength(0);
  });

  it("CASL 授权引擎本体", () => {
    expect(authz("WorkspaceAbilityFactory.createForUser")).toHaveLength(0);
  });

  it("签发 JWT", () => {
    expect(authz("UserService.generateJWT")).toHaveLength(0);
  });

  it("从请求里取 token（裸函数名，无类限定）", () => {
    expect(authz("getApiToken")).toHaveLength(0);
  });
});

describe("§39 自指排除 —— 反对照（不是机制 ⇒ 不得压掉）", () => {
  it("业务函数：删收藏（「user 作为实参」的 B 类，不是机制）", () => {
    expect(authz("FavoriteController.removeFavorite").length).toBeGreaterThan(0);
  });

  it("业务函数：删附件图标", () => {
    expect(authz("AttachmentController.removeIcon").length).toBeGreaterThan(0);
  });

  it("业务函数：删空间", () => {
    expect(authz("SpaceController.deleteSpace").length).toBeGreaterThan(0);
  });

  it("⚠ 凭据 CRUD：删 token —— 最需要鉴权，绝不能压", () => {
    expect(authz("ApiTokensController.deleteToken").length).toBeGreaterThan(0);
  });

  it("⚠ 凭据 CRUD：删 PAT —— 绝不能压", () => {
    expect(authz("AccessTokenController.deletePAT").length).toBeGreaterThan(0);
  });

  it("⚠ 凭据 CRUD：改 PAT 使用时间 —— 绝不能压", () => {
    expect(authz("AccessTokenService.updateLastUsedForPAT").length).toBeGreaterThan(0);
  });

  it("限流守卫不是鉴权机制（ThrottlerGuard）", () => {
    expect(authz("ThrottlerGuard.handleRequest").length).toBeGreaterThan(0);
  });

  it("通用设计模式后缀不是鉴权机制（CacheStrategy）", () => {
    // 只看 Strategy 后缀会误吃 —— 必须配凭据名词约束
    expect(authz("CacheStrategy.get").length).toBeGreaterThan(0);
  });

  it("受保护操作：改密码不属于机制", () => {
    expect(authz("AuthService.changePassword").length).toBeGreaterThan(0);
  });

  it("待定用户数据删除不属于机制", () => {
    expect(authz("AuthController.deletePendingUserData").length).toBeGreaterThan(0);
  });
});
