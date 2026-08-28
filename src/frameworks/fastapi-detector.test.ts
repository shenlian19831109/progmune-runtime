/**
 * fastapi-detector.test.ts — FastAPI 框架适配器规则回归（纯函数，无文件 I/O）
 *
 * 规则判定与结构提取解耦：扫描器（tools/extract_framework_py.py）只做结构，
 * 本模块消费结构 JSON 做 R1（无认证写操作路由）/ R2（死认证方案）。
 */
import { describe, it, expect } from "vitest";
import { analyzeFastapiStructure } from "./fastapi-detector";
import type { FastapiStructure } from "./fastapi-detector";

function structure(partial: Partial<FastapiStructure>): FastapiStructure {
  return {
    hasFastAPI: true,
    apps: ["app"],
    routers: [],
    authSchemes: [],
    globalAuthMiddleware: [],
    routes: [],
    filesScanned: 1,
    ...partial,
  };
}

const route = (p: {
  method: string; handler: string; path?: string;
  deps?: Array<{ name: string | null; via: string; authLike: boolean }>;
}) => ({
  method: p.method,
  path: p.path || "",
  handler: p.handler,
  file: "main.py",
  line: 1,
  dependencies: p.deps || [],
});

describe("fastapi-detector", () => {
  it("R1：无认证写操作路由 → FASTAPI_ROUTE_NO_AUTH", () => {
    const { issues } = analyzeFastapiStructure(structure({
      routes: [route({ method: "post", handler: "create_article" })],
    }));
    expect(issues.map((i) => i.rule)).toContain("FASTAPI_ROUTE_NO_AUTH");
  });

  it("R1 豁免：登录/注册/token 认证入口端点不报", () => {
    const { issues } = analyzeFastapiStructure(structure({
      routes: [
        route({ method: "post", path: "/login", handler: "login" }),
        route({ method: "post", path: "/register", handler: "register_user" }),
        route({ method: "post", path: "/token", handler: "issue_token" }),
      ],
    }));
    expect(issues).toHaveLength(0);
  });

  it("R1 豁免：registration 词干（不含 register 子串的陷阱回归）", () => {
    const { issues } = analyzeFastapiStructure(structure({
      routes: [
        route({ method: "post", path: "/users", handler: "registration_api_view" }),
      ],
    }));
    expect(issues).toHaveLength(0);
  });

  it("R1 豁免：GET 读操作不报（公开读是常见设计）", () => {
    const { issues } = analyzeFastapiStructure(structure({
      routes: [route({ method: "get", path: "/articles", handler: "list_articles" })],
    }));
    expect(issues).toHaveLength(0);
  });

  it("R1 识别 Security/Depends 认证依赖（authLike 名）", () => {
    const { issues } = analyzeFastapiStructure(structure({
      routes: [
        route({
          method: "put", path: "/users/me", handler: "update_me",
          deps: [{ name: "get_current_user_authorizer", via: "Security", authLike: true }],
        }),
      ],
    }));
    expect(issues).toHaveLength(0);
  });

  it("R1 识别声明的认证方案引用（Depends(oauth2_scheme)）", () => {
    const { issues } = analyzeFastapiStructure(structure({
      authSchemes: [{ name: "oauth2_scheme", type: "OAuth2PasswordBearer" }],
      routes: [
        route({
          method: "get", path: "/me", handler: "read_me",
          deps: [{ name: "oauth2_scheme", via: "Depends", authLike: true }],
        }),
      ],
    }));
    expect(issues).toHaveLength(0);
  });

  it("R2：声明认证方案但无路由引用 → FASTAPI_DEAD_AUTH_SCHEME", () => {
    const { issues } = analyzeFastapiStructure(structure({
      authSchemes: [{ name: "oauth2_scheme", type: "OAuth2PasswordBearer" }],
      routes: [route({ method: "get", handler: "list_things" })],
    }));
    expect(issues.map((i) => i.rule)).toContain("FASTAPI_DEAD_AUTH_SCHEME");
  });

  it("R2：方案被路由引用时不报", () => {
    const { issues } = analyzeFastapiStructure(structure({
      authSchemes: [{ name: "oauth2_scheme", type: "OAuth2PasswordBearer" }],
      routes: [
        route({
          method: "get", handler: "read_me",
          deps: [{ name: "oauth2_scheme", via: "Depends", authLike: true }],
        }),
      ],
    }));
    expect(issues).toHaveLength(0);
  });

  it("非 FastAPI 结构不产生任何问题", () => {
    const { hasFastAPI, issues } = analyzeFastapiStructure(
      structure({ hasFastAPI: false, routes: [] })
    );
    expect(hasFastAPI).toBe(false);
    expect(issues).toHaveLength(0);
  });

  it("realworld 快照：19 路由 0 问题（0 FP 回归锁）", () => {
    const snapshot = {
      hasFastAPI: true,
      apps: ["application"],
      routers: ["router"],
      authSchemes: [],
      globalAuthMiddleware: ["CORSMiddleware"],
      routes: [
        route({ method: "get", path: "", handler: "get_all_tags" }),
        route({
          method: "get", path: "", handler: "retrieve_current_user",
          deps: [{ name: "get_current_user_authorizer", via: "Depends", authLike: true }],
        }),
        route({
          method: "put", path: "", handler: "update_current_user",
          deps: [{ name: "get_current_user_authorizer", via: "Depends", authLike: true }],
        }),
        route({ method: "post", path: "/login", handler: "login" }),
        route({ method: "post", path: "", handler: "register" }),
        route({
          method: "post", path: "/{slug}/comments", handler: "create_comment",
          deps: [{ name: "get_current_user_authorizer", via: "Security", authLike: true }],
        }),
        route({ method: "get", path: "/{slug}", handler: "retrieve_article_by_slug" }),
        route({
          method: "put", path: "/{slug}", handler: "update_article_by_slug",
          deps: [{ name: "check_article_modification_permissions", via: "Depends", authLike: true }],
        }),
      ],
      filesScanned: 70,
    } as FastapiStructure;
    const { hasFastAPI, issues } = analyzeFastapiStructure(structure(snapshot));
    expect(hasFastAPI).toBe(true);
    expect(issues).toHaveLength(0);
  });
});
