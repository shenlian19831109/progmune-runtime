"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * §45：Authorization (Unauthenticated Access) 的 auth_check 词表漂移修复。
 *
 * 病灶：同一族的 Unauthenticated Mutation 认 `getSession` / `validateSession` / `verifyToken`，
 *       Unauthenticated Access 只认 `getSessionUser`，**不认裸 `getSession`**。
 *       于是「先取会话再操作」的读类函数被判成「未认证即可读」—— 真实案例 filestorage 的
 *       uploadFile / deleteFile / createFolder / createShareLink 四条（体里都有
 *       `const user = getSession(token); if (!user) return null;`）。
 *
 * 修复：把三个词补进 Access 规则的 auth_check（与 Mutation 对齐）。
 * 不做：三个 mint 类词（create_access_token / create_jwt_token / create_refresh_token）——
 *       「签发令牌」不是「校验调用者」，语义不同，不在本轮（见设计文档 §45.6）。
 */
const vitest_1 = require("vitest");
const protocol_detector_1 = require("./protocol-detector");
const ACC = "Authorization (Unauthenticated Access)";
const MUT = "Authorization (Unauthenticated Mutation)";
/** 单 LANGUAGE=typescript；paramGate 用 user:User 放行（类型是非标量领域类型） */
function dsv(calls, name) {
    return (0, protocol_detector_1.detectSafeguardViolations)(calls, name, "typescript", ["user"], false, ["User"]);
}
const has = (calls, name, rule) => dsv(calls, name).some((v) => v.rule === rule);
(0, vitest_1.describe)("§45 getSession 漂移：读类函数已取会话 ⇒ 不再报 Unauthenticated Access", () => {
    (0, vitest_1.it)("getSession 应被认作认证检查（filestorage uploadFile 原型）", () => {
        (0, vitest_1.expect)(has(["getSession", "join", "writeFileSync"], "uploadFile", ACC)).toBe(false);
    });
    (0, vitest_1.it)("validateSession 应被认作认证检查", () => {
        (0, vitest_1.expect)(has(["validateSession", "find"], "listDocuments", ACC)).toBe(false);
    });
    (0, vitest_1.it)("verifyToken 应被认作认证检查", () => {
        (0, vitest_1.expect)(has(["verifyToken", "find"], "getDocument", ACC)).toBe(false);
    });
    (0, vitest_1.it)("类限定调用形态 this.auth.getSession() 也成立（identifierParse 拆词后命中）", () => {
        (0, vitest_1.expect)(has(["this", "auth", "getSession", "find"], "deleteFile", ACC)).toBe(false);
    });
});
(0, vitest_1.describe)("§45 反向对照：真正的未认证读取必须仍然报", () => {
    (0, vitest_1.it)("getDocuments 无任何认证调用 ⇒ 仍报", () => {
        (0, vitest_1.expect)(has(["find", "filter"], "getDocuments", ACC)).toBe(true);
    });
    (0, vitest_1.it)("listReports 无任何认证调用 ⇒ 仍报", () => {
        (0, vitest_1.expect)(has(["filter", "map"], "listReports", ACC)).toBe(true);
    });
    (0, vitest_1.it)("downloadExport 无任何认证调用 ⇒ 仍报", () => {
        (0, vitest_1.expect)(has(["readFileSync", "pipe"], "downloadExport", ACC)).toBe(true);
    });
    (0, vitest_1.it)("getSessionUser 之外的无关 get* 不构成认证证据（getConfig 类）", () => {
        // getConfig 走 excludePatterns；这里用 getUniqueId 确保普通取值不算检查
        (0, vitest_1.expect)(has(["getUniqueId", "find"], "listAuditLogs", ACC)).toBe(true);
    });
});
(0, vitest_1.describe)("§45 与 Mutation 规则的对称性：同一形态两条规则都不报", () => {
    const calls = ["getSession", "find"];
    (0, vitest_1.it)("读侧", () => (0, vitest_1.expect)(has(calls, "listInvoices", ACC)).toBe(false));
    (0, vitest_1.it)("写侧", () => (0, vitest_1.expect)(has(["getSession", "push"], "createInvoice", MUT)).toBe(false));
});
(0, vitest_1.describe)("§45 已知未覆盖范围（登记为债，不是 bug）", () => {
    (0, vitest_1.it)("⚠ 只看「是否调用」getSession，不看「是否检查其结果」—— 这是既有宽松", () => {
        // `const u = getSession(t); return data;` （不检查 u）仍会被判为已认证。
        // 单函数视角拿不到数据流，本轮不修；见设计文档 §45.6。
        (0, vitest_1.expect)(has(["getSession", "return"], "getEverything", ACC)).toBe(false);
    });
});
