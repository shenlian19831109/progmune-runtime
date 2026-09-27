/**
 * §38（2026-09-25）组合式授权谓语 safeguard —— 正/反向 fixture
 *
 * 为什么必须有这个文件：3.7.28–3.7.31 的正则死循环溜过 CI，根因就是
 * 「新增的正则路径没有任何 fixture 触发过它」。本轮新增的三条 safeguard 同理：
 * 盲测语料（blind-benchmark/generated/，合成项目）里**根本没有** cannot/canRemove
 * 这类 CASL 形态 ⇒ 盲测 2865 条零漂移，但也**一条都没触发**（§38.8）。
 * 没有这里的 fixture，这三条正则就是**零覆盖**进主干的。
 *
 * 每条正对照都对应真值集里人工核对过的真实代码：
 *   cannot                  ← docmost SpaceController.deleteSpace
 *   canRemove               ← verdaccio StorageViewCommand.deleteEntry
 *   validateCanEdit         ← docmost AttachmentController.uploadFile
 *   checkMediaDeletePermission ← hedgedoc MediaController.deleteMedia
 */
import { describe, it, expect } from "vitest";
import { detectSafeguardViolations } from "./protocol-detector";

/** 只看所有权/资源所有权两条（本轮只改了这两条的 safeguards） */
const own = (calls: string[], fnName: string) =>
  detectSafeguardViolations(calls, fnName, "typescript", ["user", "id"], true).filter((v) =>
    /Ownership/i.test(v.rule)
  );

describe("§38 组合式授权谓语 —— 正对照（有授权 ⇒ 抑制）", () => {
  it("cannot（CASL 否定谓语）应抑制 Ownership Check", () => {
    // docmost: if (ability.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Settings)) throw Forbidden
    expect(own(["createForUser", "cannot", "deleteSpace"], "deleteSpace")).toHaveLength(0);
  });

  it("canRemove 应抑制", () => {
    // verdaccio: storage.canRemove(...)
    expect(own(["canRemove", "removeCachedPackage"], "deleteEntry")).toHaveLength(0);
  });

  it("canPublish 应抑制", () => {
    // verdaccio: auth.allow_publish({packageName}, user, cb) 的包了一层
    expect(own(["canPublish", "remove"], "stage")).toHaveLength(0);
  });

  it("validateCanEdit（带前缀 helper）应抑制", () => {
    // docmost: await this.validateCanEdit(...)
    expect(own(["validateCanEdit", "uploadFile"], "uploadFile")).toHaveLength(0);
  });

  it("checkMediaDeletePermission（A″ 校验动词 + Permission）应抑制", () => {
    // hedgedoc: MediaController.deleteMedia
    expect(own(["checkMediaDeletePermission", "delete"], "deleteMedia")).toHaveLength(0);
  });

  it("validateSpaceAccess 应抑制", () => {
    // docmost: FavoriteController.removeFavorite → resolveAndValidate → validateSpaceAccess
    expect(
      own(["resolveAndValidate", "validateSpaceAccess", "removeFavorite"], "removeFavorite")
    ).toHaveLength(0);
  });
});

describe("§38 —— 负对照（同形噪声 ⇒ 仍须报违规）", () => {
  it("裸 delete 无任何授权 ⇒ 仍报", () => {
    expect(own(["deleteSpace"], "deleteSpace").length).toBeGreaterThan(0);
  });

  it("canSendEmail 是限流器不是权限 ⇒ 仍报", () => {
    // 实测抓到：rateLimiter.canSendEmail(userId) 被第一版误收
    expect(own(["canSendEmail", "update"], "updateThing").length).toBeGreaterThan(0);
  });

  it("isRight 是 fp-ts Either 判定 ⇒ 仍报", () => {
    // 实测抓到：hoppscotch 满仓 fp-ts，一次冒出 2 条假转绿
    // ⚠ 函数名必须能触发 Ownership Check 的 trigger（delete/remove/update…系动词）。
    //   用 addUserToTeam 的话 trigger 不命中 ⇒ 恒 0，测不出东西（第一版就写错了）。
    expect(own(["isRight", "removeMemberFromTeam"], "removeTeamMember").length).toBeGreaterThan(0);
  });

  it("deleteByUsersWithoutSpaceAccess 是数据删除不是校验 ⇒ 仍报", () => {
    expect(own(["deleteByUsersWithoutSpaceAccess"], "removeMember").length).toBeGreaterThan(0);
  });

  /**
   * ⚠ 本条在 §40 被**推翻**（2026-09-25），保留在此是为了留下决策痕迹：
   * §38 当时"裸 can 太宽（cancel/candidate 同形）⇒ 不收"只是一个**担心**，没有真值证据；
   * §40 人工核剩余池时发现 verdaccio `publish()` 用的是 `const can = allow(auth, …)` +
   * `can('publish')`、CASL 用 `ability.can(Action.Update, subj)` —— **裸 can 是主流写法**，
   * 而"太宽"的担心可以用**精确匹配**解决（cancel/candidate 根本不等于 can）。
   * ⇒ 现在裸 can 收，但两条护栏必须守住（都在 §40 fixture 里钉死）：
   *     ① 精确匹配 `^can$` / `.can$`（否则 canSendEmail 拆词出 "can" 会被误收）
   *     ② `callsOnly: true`（否则 identifierParse 拆出的词 "can" 会误命中）
   */
  it("cancel / candidate 不是 can ⇒ 仍报（精确匹配护栏）", () => {
    expect(own(["cancel", "candidate", "remove"], "removeThing").length).toBeGreaterThan(0);
  });
});
