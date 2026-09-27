"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * §40（2026-09-25）剩余池三处判据缺口 —— 正/反向 fixture
 *
 * 与 §38/§39 同因：这三处都是**压掉告警**方向的改动，盲测语料（generated/ 合成项目）
 * 里没有 `Auth.allow_*` / 裸 `can('publish')` / `canRemove` 这类形态 ⇒ 盲测即便
 * 零漂移也可能**一条都没触发**（R56：零漂移 ≠ 验证通过）。没有这里的 fixture，
 * 这三段判据就是零覆盖进主干。
 *
 * 三处缺口的来源（都是人工核剩余池 35 条时逐条读源码读出来的）：
 *   C1 裸 can      — verdaccio `publish()`：`const can = allow(auth, …)`，
 *                    路由上 `can('publish')`。calls 里是**裸** can，
 *                    §38 的谓语要求 `can<动作词>` ⇒ 落空。
 *   C2 自身谓语名  — verdaccio `canRemove` 报 "Ownership Check"：它**就是**那个检查。
 *                    §39 的自指排除只认 AUTH_PATTERN + 机制名，不认 `can<X>`。
 *   C4 容器=Auth   — §39.8 记下的未收项：`Auth.allow_*` / `Auth.setLegacyAuthCacheEntry`。
 *
 * ⚠⚠ 反向 fixture 比正向更要紧（R57）：C4 的**宽变体**（容器放宽到 `Auth*`）实测会吃掉
 *   `AuthController.deletePendingUserData` / `Auth.changePassword` / `Auth.invalidateToken`
 *   —— 对凭据与待处理用户做增删改恰恰是最需要鉴权的地方。所以 C4 必须
 *   「严格等于裸类名」×「方法是授权决策(allow_)或机制名词」两层约束，两条都要。
 */
const vitest_1 = require("vitest");
const protocol_detector_1 = require("./protocol-detector");
/** 只关心 authorization 类目（本轮只影响这一类目） */
const authz = (fnName, calls = ["deleteSpace", "findOne"]) => (0, protocol_detector_1.detectSafeguardViolations)(calls, fnName, "typescript", ["user", "id"], true).filter((v) => /^Authorization/i.test(v.rule));
(0, vitest_1.describe)("§40 C1 裸 can（CASL ability.can / verdaccio can('publish')）", () => {
    (0, vitest_1.it)("函数体里调用裸 can ⇒ 认为做了授权判定（verdaccio publish 同形）", () => {
        // publish 的 trigger 来自 publishPackage / removePackage 等，这里用等价形态
        (0, vitest_1.expect)(authz("publish", ["can", "put", "publishPackage", "removePackage"])).toHaveLength(0);
    });
    (0, vitest_1.it)("裸 cannot 同形", () => {
        (0, vitest_1.expect)(authz("publish", ["cannot", "put", "publishPackage"])).toHaveLength(0);
    });
    (0, vitest_1.it)("限定形式 ability.can（CASL 标准用法）", () => {
        (0, vitest_1.expect)(authz("publish", ["ability.can", "publishPackage"])).toHaveLength(0);
    });
    (0, vitest_1.it)("⚠ cancel 不是 can —— 精确匹配，不得因同形被收", () => {
        (0, vitest_1.expect)(authz("publish", ["cancel", "publishPackage"]).length).toBeGreaterThan(0);
    });
    (0, vitest_1.it)("⚠ candidate / canary 也不是 —— 精确匹配钉死", () => {
        (0, vitest_1.expect)(authz("publish", ["candidate", "canary", "publishPackage"]).length).toBeGreaterThan(0);
    });
});
(0, vitest_1.describe)("§40 C2 函数名自身就是授权谓语（自指）", () => {
    (0, vitest_1.it)("canRemove 报「缺所有权检查」是自指谬误", () => {
        (0, vitest_1.expect)(authz("canRemove")).toHaveLength(0);
    });
    (0, vitest_1.it)("canPublish 同理", () => {
        (0, vitest_1.expect)(authz("canPublish")).toHaveLength(0);
    });
    (0, vitest_1.it)("cannotDelete 同理（cannot 分支）", () => {
        (0, vitest_1.expect)(authz("cannotDelete")).toHaveLength(0);
    });
    (0, vitest_1.it)("类限定的 Auth.canRemove 同理", () => {
        (0, vitest_1.expect)(authz("StorageViewCommand.canRemove")).toHaveLength(0);
    });
    (0, vitest_1.it)("⚠ canSendEmail 是限流器不是权限判定 —— 不得收（§38.4 ② 的老反例）", () => {
        (0, vitest_1.expect)(authz("canSendEmail").length).toBeGreaterThan(0);
    });
    (0, vitest_1.it)("⚠ 名字像谓语但动作词不在表内（canRenderPreview）不得收", () => {
        (0, vitest_1.expect)(authz("canRenderPreview").length).toBeGreaterThan(0);
    });
});
(0, vitest_1.describe)("§40 C4 容器严格等于鉴权类 × 授权决策/机制方法", () => {
    (0, vitest_1.it)("Auth.allow_publish —— 授权决策本体（verdaccio）", () => {
        (0, vitest_1.expect)(authz("Auth.allow_publish")).toHaveLength(0);
    });
    (0, vitest_1.it)("Auth.allow_access / allow_unpublish / allow_stage 同族", () => {
        (0, vitest_1.expect)(authz("Auth.allow_access")).toHaveLength(0);
        (0, vitest_1.expect)(authz("Auth.allow_unpublish")).toHaveLength(0);
        (0, vitest_1.expect)(authz("Auth.allow_stage")).toHaveLength(0);
    });
    (0, vitest_1.it)("Auth.setLegacyAuthCacheEntry —— 鉴权缓存内部", () => {
        (0, vitest_1.expect)(authz("Auth.setLegacyAuthCacheEntry")).toHaveLength(0);
    });
    (0, vitest_1.it)("Authorization.allow_access 同形", () => {
        (0, vitest_1.expect)(authz("Authorization.allow_access")).toHaveLength(0);
    });
    (0, vitest_1.it)("⚠ Auth.changePassword —— 受保护操作，绝不能压", () => {
        (0, vitest_1.expect)(authz("Auth.changePassword").length).toBeGreaterThan(0);
    });
    /**
     * ⚠ 这里踩到一个「测不出来」的坑，记录清楚免得后人以为 C4 放行了它：
     * `Auth.invalidateToken` **在 C4 层确实被 PROTECTED_VERB（invalidate）拦下**，
     * 但 §39 的 AUTH_PATTERN 里本来就有 `invalidate`（登出/会话失效入口），
     * 且它按 identifierParse **逐词**匹配 ⇒ "invalidateToken" 拆出 invalidate ⇒ 先命中。
     * 所以整条链路的结果是"压掉"，但**不是 C4 压的**。
     * ⇒ 改成直接断言 C4 这一层，避免把别人的行为记到自己账上。
     */
    (0, vitest_1.it)("⚠ Auth.invalidateToken —— C4 层必须拦下（受保护动词）", () => {
        (0, vitest_1.expect)((0, protocol_detector_1.isAuthDecisionName)("Auth.invalidateToken")).toBe(false);
    });
    (0, vitest_1.it)("⚠ Auth.add_user —— 用户管理操作，绝不能压", () => {
        (0, vitest_1.expect)(authz("Auth.add_user").length).toBeGreaterThan(0);
    });
    (0, vitest_1.it)("⚠ AuthController.deletePendingUserData —— 容器不是裸 Auth，绝不能压（§39 V-D 教训）", () => {
        (0, vitest_1.expect)(authz("AuthController.deletePendingUserData").length).toBeGreaterThan(0);
    });
    (0, vitest_1.it)("⚠ AuthService.getCollabToken 之外的业务方法不受影响（AuthService.updateToken）", () => {
        // AuthService 不在"严格等于裸类名"集合里 ⇒ 只有 §39 的机制动词×对象能救
        (0, vitest_1.expect)(authz("AuthService.updateToken").length).toBeGreaterThan(0);
    });
});
