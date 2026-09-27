/**
 * §46 ② owner_self_assigned —— 资源属主被赋值为当前主体
 *
 * 背景：`Authorization (Ownership Check)` 报「改了别人的东西」，但合成语料上有 12 条
 * FP，成因一致：函数**新建**资源并把属主设为当前主体
 * （`const item = { ..., ownerId: user.id }`）—— 被操作对象就是自己，谈不上越权。
 *
 * 机制：extract-ir 注入 `__progmune_owner_self_assigned__` 标记（对象字面量里的
 * `<属主字段>: <主体>.id`），Ownership Check 的 safeguard 消费它。
 *
 * 本文件钉住：
 *   1. 有标记 ⇒ 豁免
 *   2. 无标记 ⇒ 仍报（反向对照，防止无条件抑制）
 *   3. **不认**「主体标识作实参」形态 —— 那是 R66 否决的形状（见下）
 *
 * ⚠ R66 的边界（为什么不做 `<调用>(…, user.id, …)`）：
 *   真实池 `deletePAT(id, user.uid)` 是 FP（已按属主过滤），
 *   合成语料 `deleteWidget` 里 `canSendEmail(user.id)` 是 TP（user.id 与 deleteWidget 无关）。
 *   同形状、相反真值 ⇒ 主体标识作实参这一轴不具备判别力，不得落地。
 *   只认对象字面量里的**绑定**（`userId:` 后跟主体），不认调用实参。
 */
import { describe, it, expect } from "vitest";
import { detectSafeguardViolations } from "./protocol-detector";

const own = (calls: string[], name: string) =>
  detectSafeguardViolations(calls, name, "typescript", ["user"], false, ["AuthUser"])
    .filter((v) => v.rule === "Authorization (Ownership Check)");

const MARK = "__progmune_owner_self_assigned__";

describe("§46 ② owner_self_assigned —— 属主即主体", () => {
  it("带标记 ⇒ 豁免（新建资源属主 = 当前主体）", () => {
    expect(own(["getUser", "push", MARK], "createTransfer")).toHaveLength(0);
  });

  it("反向对照：无标记 ⇒ 仍报", () => {
    expect(own(["getUser", "push"], "createTransfer")).toHaveLength(1);
  });

  it("反向对照：删除类无标记 ⇒ 仍报（不能被顺带压掉）", () => {
    expect(own(["getUser", "findIndex", "splice"], "deleteTransfer")).toHaveLength(1);
  });
});

describe("§46 ② 边界 —— 只认绑定形态，不认实参形态（R66）", () => {
  it("主体标识作实参、但无标记 ⇒ 仍报", () => {
    // deleteWidget(widgetId, user) { canSendEmail(user.id); repo.deleteWidget(widgetId); }
    // 这是真 TP：user.id 与 deleteWidget 无关。没有标记 ⇒ 不得豁免。
    expect(own(["canSendEmail", "deleteWidget"], "deleteWidget")).toHaveLength(1);
  });

  it("带标记时豁免，与函数名无关", () => {
    expect(own(["canSendEmail", "deleteWidget", MARK], "deleteWidget")).toHaveLength(0);
  });
});

describe("§46 ② 既有 ownership 证据不受影响", () => {
  it("内联属主比较（__progmune_ownership_checked__）仍然豁免", () => {
    expect(
      own(["getUser", "__progmune_ownership_checked__"], "deleteTransfer")
    ).toHaveLength(0);
  });

  it("ownerId 比较写法仍然豁免（不加标记也行）", () => {
    expect(
      own(["getUser", "checkOwner"], "deleteTransfer")
    ).toHaveLength(0);
  });
});
