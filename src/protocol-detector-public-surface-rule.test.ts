import { describe, it, expect } from "vitest";
import { detectSafeguardViolations } from "./protocol-detector";

/**
 * 修冤枉第十刀（2026-10-16）：公开面标记的规则侧接受位锁定。
 *
 * 语义：@Public()/@SkipAuth()/@AllowAnonymous 是开发者显式声明免鉴权
 * （正向证据，R75）——授权族四条的「缺鉴权/缺属主校验」提问在公开
 * 端点上不适用。只抑制 authorization 类；其他族规则不受标记影响。
 */

const M = "__progmune_public_surface__";
const has = (vs: Array<{ rule: string }>, rule: string) => vs.some((v) => v.rule === rule);

describe("public_surface 标记：授权族四条接受、其他族不受影响", () => {
  const calls = ["getShareTree", M];

  it("Unauthenticated Access 被抑制", () => {
    const bare = detectSafeguardViolations(["getShareTree"], "ShareController.getShare", "typescript", ["shareId"], true);
    expect(has(bare, "Authorization (Unauthenticated Access)")).toBe(true);
    const withMark = detectSafeguardViolations(calls, "ShareController.getShare", "typescript", ["shareId"], true);
    expect(has(withMark, "Authorization (Unauthenticated Access)")).toBe(false);
  });

  it("Unauthenticated Mutation 被抑制", () => {
    // updateInvite 直接命中 Mutation 触发词；真实语料里的 acceptInvite
    // 告警靠函数体内调用上下文触发，隔离夹具用直接形态
    const bare = detectSafeguardViolations(["updateInvite"], "WorkspaceController.updateInvite", "typescript", ["token"], true);
    expect(has(bare, "Authorization (Unauthenticated Mutation)")).toBe(true);
    const withMark = detectSafeguardViolations(["updateInvite", M], "WorkspaceController.updateInvite", "typescript", ["token"], true);
    expect(has(withMark, "Authorization (Unauthenticated Mutation)")).toBe(false);
  });

  it("Ownership Check 被抑制（公开端点的属主校验提问不适用）", () => {
    // sharePage 直接命中 Ownership 触发词（share+Page）；真实语料里的
    // getSharedPageInfo 类告警靠同文件级调用上下文触发，隔离夹具用直接形态
    const bare = detectSafeguardViolations(["sharePage"], "ShareController.sharePage", "typescript", ["shareId"], true);
    expect(has(bare, "Authorization (Ownership Check)")).toBe(true);
    const withMark = detectSafeguardViolations(["sharePage", M], "ShareController.sharePage", "typescript", ["shareId"], true);
    expect(has(withMark, "Authorization (Ownership Check)")).toBe(false);
  });

  it("Resource Ownership 被抑制", () => {
    const bare = detectSafeguardViolations(["toggleShare"], "ShareController.toggleShare", "typescript", ["id"], true);
    expect(has(bare, "Authorization (Resource Ownership)")).toBe(true);
    const withMark = detectSafeguardViolations(["toggleShare", M], "ShareController.toggleShare", "typescript", ["id"], true);
    expect(has(withMark, "Authorization (Resource Ownership)")).toBe(false);
  });

  it("非授权族规则不受标记影响（渲染 sink 照报）", () => {
    const vs = detectSafeguardViolations(["render", M], "PublicController.renderTemplate", "typescript");
    expect(has(vs, "No Input Sanitization")).toBe(true);
  });
});
