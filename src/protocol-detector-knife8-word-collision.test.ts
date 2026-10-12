import { describe, it, expect } from "vitest";
import { detectSafeguardViolations } from "./protocol-detector";

/**
 * 修冤枉第八刀（2026-10-12）词撞类回归测试。
 *
 * 根因：mutation/access trigger 的 /i 标志让 [A-Z]\w* 退化为 [A-Za-z]\w*，
 * 「for+Update」「create+Cipheriv」「Last+UpdatedBy」等非变更词段全数命中。
 * 修法：excludePatterns 增补四个形状（docmost 12 条告警逐条核过 TP 0——
 * forUpdate=Kysely 悲观锁 SELECT、createCipheriv/Decipheriv=crypto 构造器、
 * withLastUpdatedBy=select 子查询构建器、getConfig=存储驱动配置读取）。
 * 已知 FN 边界（记录在案）：函数若同时含撞词与真实写调用（锁后写/
 * 加密后存），excludePatterns 会整体豁免该函数——docmost 与盲测语料
 * 均无此形态（knife8-replay-probe.ts 复核）。
 */

describe("修冤枉第八刀：词撞类 excludePatterns", () => {
  it("forUpdate（Kysely 悲观锁 SELECT）不再触发 Unauthenticated Mutation", () => {
    const v = detectSafeguardViolations(
      ["select", "selectFrom", "where", "forUpdate"],
      "PageRepo.findById",
      "typescript"
    );
    expect(v.some((x) => x.rule === "Authorization (Unauthenticated Mutation)")).toBe(false);
  });

  it("createCipheriv/createDecipheriv（crypto 构造器）不再触发 Mutation", () => {
    const v = detectSafeguardViolations(
      ["randomBytes", "createCipheriv", "concat", "update", "final"],
      "EncryptionService.encrypt",
      "typescript"
    );
    expect(v.some((x) => x.rule === "Authorization (Unauthenticated Mutation)")).toBe(false);
    const v2 = detectSafeguardViolations(
      ["createDecipheriv", "setAuthTag", "concat", "update"],
      "EncryptionService.decrypt",
      "typescript"
    );
    expect(v2.some((x) => x.rule === "Authorization (Unauthenticated Mutation)")).toBe(false);
  });

  it("withLastUpdatedBy（select 子查询构建器）不再触发 Mutation", () => {
    const v = detectSafeguardViolations(
      ["as", "jsonObjectFrom", "whereRef", "select"],
      "PageRepo.withLastUpdatedBy",
      "typescript"
    );
    expect(v.some((x) => x.rule === "Authorization (Unauthenticated Mutation)")).toBe(false);
  });

  it("getConfig（存储驱动配置读取）不再触发 Unauthenticated Access", () => {
    const v = detectSafeguardViolations([], "S3Driver.getConfig", "typescript");
    expect(v.some((x) => x.rule === "Authorization (Unauthenticated Access)")).toBe(false);
  });

  it("反例：真实写调用（updateTable/insertInto）照常触发 Mutation", () => {
    const v = detectSafeguardViolations(
      ["dbOrTx", "updateTable", "set", "where", "execute"],
      "PageRepo.updatePages",
      "typescript"
    );
    expect(v.some((x) => x.rule === "Authorization (Unauthenticated Mutation)")).toBe(true);
  });

  it("反例：真实数据读取（getUserData）照常触发 Access", () => {
    const v = detectSafeguardViolations(
      ["selectFrom", "where", "executeTakeFirst"],
      "UserRepo.getUserData",
      "typescript"
    );
    expect(v.some((x) => x.rule === "Authorization (Unauthenticated Access)")).toBe(true);
  });
});
