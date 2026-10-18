import { describe, it, expect } from "vitest";
import { computeBareFamilyPropagatedSet } from "./protocol-detector";

/**
 * 裸名族兜底传播内核（修冤枉第十一刀，2026-10-17）单元测试。
 *
 * B 判据（见 computeBareFamilyPropagatedSet 注释）：
 *   裸名族调用方并集全 ⊆ base ⇒ 族内每个成员豁免。
 * 正确性（R75 正向证据）：裸化只增候选 ⇒ 真实调用方必在并集中 ⇒
 *   并集全豁免蕴含真实调用方全豁免——不需要边解析。
 * 比逐边消歧更保守：族内任一成员被并集外调用则全族不豁免。
 * 第七刀经 includeBase=true 与本内核共享（既有 11 例锁定）。
 */

describe("computeBareFamilyPropagatedSet（裸名族兜底，B 判据内核）", () => {
  it("歧义族（同名两候选）+ 调用方并集全在 base ⇒ 全族豁免（逐边消歧失败的形态）", () => {
    // 第五/九/十刀的逐边消歧在此形态挂未解析边 fail-safe；
    // 族级兜底不需要边解析——最坏归因也落在并集内。
    const fns = [
      { name: "GuardedController.get", file: "c/page.controller.ts", calls: ["getData"] },
      { name: "OtherGuardedController.get", file: "c/space.controller.ts", calls: ["getData"] },
      { name: "PageService.getData", file: "s/page.service.ts", calls: [] },
      { name: "SpaceService.getData", file: "s/space.service.ts", calls: [] },
    ];
    const base = new Set(["GuardedController.get", "OtherGuardedController.get"]);
    const g = computeBareFamilyPropagatedSet(fns, base);
    expect(g.has("PageService.getData")).toBe(true);
    expect(g.has("SpaceService.getData")).toBe(true);
  });

  it("族内任一成员被并集外调用 ⇒ 全族不豁免（族级保守）", () => {
    const fns = [
      { name: "GuardedController.get", file: "c1.ts", calls: ["getData"] },
      { name: "PublicController.get", file: "c2.ts", calls: ["getData"] }, // 并集外
      { name: "PageService.getData", file: "s1.ts", calls: [] },
      { name: "SpaceService.getData", file: "s2.ts", calls: [] },
    ];
    const base = new Set(["GuardedController.get"]);
    const g = computeBareFamilyPropagatedSet(fns, base);
    expect(g.has("PageService.getData")).toBe(false);
    expect(g.has("SpaceService.getData")).toBe(false);
  });

  it("无调用方（入口/未连通）⇒ 不豁免", () => {
    const fns = [{ name: "orphanEntry", file: "m.ts", calls: [] }];
    const g = computeBareFamilyPropagatedSet(fns, new Set());
    expect(g.has("orphanEntry")).toBe(false);
  });

  it("默认 1 轮：族豁免成员的下游不豁免（传递闭包未开）", () => {
    const fns = [
      { name: "GuardedController.get", file: "c.ts", calls: ["getData"] },
      { name: "PageService.getData", file: "s.ts", calls: ["loadMore"] },
      { name: "loadMore", file: "s.ts", calls: [] },
    ];
    const g = computeBareFamilyPropagatedSet(fns, new Set(["GuardedController.get"]));
    expect(g.has("PageService.getData")).toBe(true);
    expect(g.has("loadMore")).toBe(false);
  });

  it("maxRounds=2 ⇒ 传递两跳成立（快照轮次语义）", () => {
    const fns = [
      { name: "GuardedController.get", file: "c.ts", calls: ["getData"] },
      { name: "PageService.getData", file: "s.ts", calls: ["loadMore"] },
      { name: "loadMore", file: "s.ts", calls: [] },
    ];
    const g = computeBareFamilyPropagatedSet(fns, new Set(["GuardedController.get"]), { maxRounds: 2 });
    expect(g.has("PageService.getData")).toBe(true);
    expect(g.has("loadMore")).toBe(true);
  });

  it("默认返回只含 base 新增成员（R5）；includeBase=true 返回全集（第七刀语义）", () => {
    const fns = [
      { name: "GuardedController.get", file: "c.ts", calls: ["getData"] },
      { name: "PageService.getData", file: "s.ts", calls: [] },
    ];
    const base = new Set(["GuardedController.get"]);
    const added = computeBareFamilyPropagatedSet(fns, base);
    expect(added.has("GuardedController.get")).toBe(false); // base 不重复
    expect(added.has("PageService.getData")).toBe(true);
    const full = computeBareFamilyPropagatedSet(fns, base, { includeBase: true });
    expect(full.has("GuardedController.get")).toBe(true);
    expect(full.has("PageService.getData")).toBe(true);
  });

  it("自调不提供豁免证据", () => {
    const fns = [{ name: "CleanupService.cleanup", file: "s.ts", calls: ["cleanup"] }];
    const g = computeBareFamilyPropagatedSet(fns, new Set());
    expect(g.has("CleanupService.cleanup")).toBe(false);
  });

  it("限定形态调用名（Class.method）按裸名并入并集（裸化只增候选，保守方向）", () => {
    const fns = [
      { name: "GuardedController.get", file: "c.ts", calls: ["PageService.getData"] },
      { name: "PageService.getData", file: "s.ts", calls: [] },
    ];
    const g = computeBareFamilyPropagatedSet(fns, new Set(["GuardedController.get"]));
    expect(g.has("PageService.getData")).toBe(true);
  });

  it("空 base ⇒ 无人豁免（无正向证据不豁免，R75）", () => {
    const fns = [
      { name: "A", file: "a.ts", calls: ["b"] },
      { name: "b", file: "a.ts", calls: [] },
    ];
    const g = computeBareFamilyPropagatedSet(fns, new Set());
    expect(g.has("b")).toBe(false);
  });
});
