import { describe, it, expect } from "vitest";
import { detectSafeguardViolations } from "./protocol-detector";

/**
 * No Input Sanitization 触发词收窄（修冤枉第四刀，2026-10-09）锁定。
 *
 * 数据：docmost 补标注 30/30 FP（Kysely insertInto）、Python 盲测
 * 270/270 FP（list.append）、TS 盲测 33/33 FP（writeFileSync 族）——
 * 「输出系」通用词系统性词撞，本意是 XSS sink 却从没在真实语料
 * 命中过一条 XSS。收窄后 trigger 只留真实 sink 语义：
 * render/display/output/innerHTML/dangerouslySetInnerHTML/echo/
 * printf/sprintf + 显式 DOM sink 原始名 insertAdjacentHTML。
 *
 * 已知代价：document.write 的提取名是裸 "write"，与文件写入不可分，
 * 不再命中（盲测/语料里 0 条由 document.write 驱动，如实记录）。
 */

const RULE = "No Input Sanitization";
const has = (vs: Array<{ rule: string }>) => vs.some((v) => v.rule === RULE);

describe("No Input Sanitization：触发词收窄（修冤枉第四刀）", () => {
  it("数据库写入 insertInto 不再触发（docmost 30/30 FP 根因）", () => {
    const vs = detectSafeguardViolations(
      ["dbOrTx", "executeTakeFirst", "returningAll", "values", "insertInto", "__progmune_input_effect__"],
      "PageRepo.insertPage",
      "typescript"
    );
    expect(has(vs)).toBe(false);
  });

  it("文件写入 writeFileSync 不再触发（TS 盲测 8 项目 FP 根因）", () => {
    const vs = detectSafeguardViolations(["writeFileSync", "mkdirSync"], "uploadFile", "typescript");
    expect(has(vs)).toBe(false);
  });

  it("Python list.append 不再触发（Python 盲测 45 项目 270 条 FP 根因）", () => {
    const vs = detectSafeguardViolations(["users", "append", "sessions", "append"], "register", "python");
    expect(has(vs)).toBe(false);
  });

  it("真实 DOM sink insertAdjacentHTML 仍触发（XSS 本意保留）", () => {
    const vs = detectSafeguardViolations(["insertAdjacentHTML"], "renderComment", "typescript");
    expect(has(vs)).toBe(true);
  });

  it("真实渲染 sink render 仍触发，带 sanitize 守卫仍抑制", () => {
    const bare = detectSafeguardViolations(["render"], "renderTemplate", "typescript");
    expect(has(bare)).toBe(true);
    const guarded = detectSafeguardViolations(["render", "sanitizeHtml"], "renderTemplate", "typescript");
    expect(has(guarded)).toBe(false);
  });
});
