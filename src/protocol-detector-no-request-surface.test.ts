import { describe, it, expect } from "vitest";
import { detectSafeguardViolations } from "./protocol-detector";

/**
 * 修冤枉第六刀（2026-10-10）：无请求面标记的规则侧接受位锁定。
 *
 * 语义：队列/定时/事件处理器不面向 HTTP 请求，鉴权发生在入队侧——
 * 授权族四条的「缺鉴权/缺属主校验」提问在处理器层不适用（N/A 抑制）。
 * 只抑制 authorization 类；其他族规则不受标记影响。
 */

const M = "__progmune_no_request_surface__";
const has = (vs: Array<{ rule: string }>, rule: string) => vs.some((v) => v.rule === rule);

describe("no_request_surface 标记：授权族四条接受、其他族不受影响", () => {
  const calls = ["getWorkspaceUrl", M];

  it("Unauthenticated Access 被抑制", () => {
    const bare = detectSafeguardViolations(["getWorkspaceUrl"], "NotificationProcessor.getWorkspaceUrl", "typescript", ["job"], true);
    expect(has(bare, "Authorization (Unauthenticated Access)")).toBe(true);
    const withMark = detectSafeguardViolations(calls, "NotificationProcessor.getWorkspaceUrl", "typescript", ["job"], true);
    expect(has(withMark, "Authorization (Unauthenticated Access)")).toBe(false);
  });

  it("Unauthenticated Mutation 被抑制", () => {
    const bare = detectSafeguardViolations(["updateTable"], "HistoryProcessor.process", "typescript", ["job"], true);
    expect(has(bare, "Authorization (Unauthenticated Mutation)")).toBe(true);
    const withMark = detectSafeguardViolations(["updateTable", M], "HistoryProcessor.process", "typescript", ["job"], true);
    expect(has(withMark, "Authorization (Unauthenticated Mutation)")).toBe(false);
  });

  it("Ownership Check 被抑制（queue job 的属主校验提问不适用）", () => {
    const bare = detectSafeguardViolations(["deleteSessions"], "SessionService.cleanupSessions", "typescript", ["job"], true);
    expect(has(bare, "Authorization (Ownership Check)")).toBe(true);
    const withMark = detectSafeguardViolations(["deleteSessions", M], "SessionService.cleanupSessions", "typescript", ["job"], true);
    expect(has(withMark, "Authorization (Ownership Check)")).toBe(false);
  });

  it("Resource Ownership 被抑制", () => {
    const bare = detectSafeguardViolations(["removeIcon"], "AttachmentProcessor.process", "typescript", ["job"], true);
    expect(has(bare, "Authorization (Resource Ownership)")).toBe(true);
    const withMark = detectSafeguardViolations(["removeIcon", M], "AttachmentProcessor.process", "typescript", ["job"], true);
    expect(has(withMark, "Authorization (Resource Ownership)")).toBe(false);
  });

  it("非授权族规则不受标记影响（渲染 sink 照报）", () => {
    const vs = detectSafeguardViolations(["render", M], "EmailProcessor.renderTemplate", "typescript");
    expect(has(vs, "No Input Sanitization")).toBe(true);
  });
});
