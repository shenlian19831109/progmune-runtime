import { describe, it, expect } from "vitest";
import {
  computeGuardPropagatedSet,
  computeJobSurfacePropagatedSet,
  computePublicSurfacePropagatedSet,
} from "./protocol-detector";

/**
 * 公开表面传播豁免（修冤枉第十刀，2026-10-16）单元测试。
 *
 * 判据（见 computePublicSurfacePropagatedSet 注释）：
 *   函数 F 的每个直接调用方都 ∈ {公开面} ∪ {已守卫传播集} ∪
 *   {作业面传播集} ⇒ F 无未鉴权请求面（公开=开发者显式声明，
 *   已守卫=过了鉴权，作业=无请求面）。
 * R1-R5：调用方非空 / 边全解析 / 全部落在并集内 / 快照轮次默认 1 /
 * 返回集合只含并集新增成员。
 * 直接公开标记函数自身的告警由规则侧 safeguard 接受标记消除（R1 注）。
 */

const MG = "__progmune_auth_machinery__";
const MJ = "__progmune_no_request_surface__";

/** 便捷：guard/job/公开集 + 公开传播集一并算 */
function sets(fns: Array<{ name: string; file?: string; calls?: string[] }>, publicFns: string[], opts?: { maxRounds?: number }) {
  const guard = computeGuardPropagatedSet(fns);
  const job = computeJobSurfacePropagatedSet(fns);
  const pub = new Set(publicFns);
  const propagated = computePublicSurfacePropagatedSet(fns, pub, guard, job, opts);
  return { guard, job, pub, propagated };
}

describe("computePublicSurfacePropagatedSet（公开表面传播，第十刀）", () => {
  it("只被公开端点调用 ⇒ 豁免", () => {
    const fns = [
      { name: "ShareController.getShare", file: "c/share.controller.ts", calls: ["getShareTree"] },
      { name: "ShareService.getShareTree", file: "s/share.service.ts", calls: [] },
    ];
    const { propagated } = sets(fns, ["ShareController.getShare"]);
    expect(propagated.has("ShareService.getShareTree")).toBe(true);
  });

  it("混合调用方（公开 + 已守卫）⇒ 豁免（第九刀够不着的形态）", () => {
    const fns = [
      { name: "GuardedController.create", file: "c/page.controller.ts", calls: [MG, "searchPage"] },
      { name: "SearchController.searchShare", file: "c/search.controller.ts", calls: ["searchPage"] },
      { name: "SearchService.searchPage", file: "s/search.service.ts", calls: [] },
    ];
    const { guard, propagated } = sets(fns, ["SearchController.searchShare"]);
    expect(guard.has("SearchService.searchPage")).toBe(false); // 非全守卫 ⇒ 第五刀不豁免
    expect(propagated.has("SearchService.searchPage")).toBe(true); // 公开∪守卫 并集 ⇒ 豁免
  });

  it("混合调用方（公开 + 作业）⇒ 豁免", () => {
    const fns = [
      { name: "ShareController.getShare", file: "c.ts", calls: ["getShareTree"] },
      { name: "DigestJob.run", file: "q.ts", calls: [MJ, "getShareTree"] },
      { name: "ShareService.getShareTree", file: "s.ts", calls: [] },
    ];
    const { propagated } = sets(fns, ["ShareController.getShare"]);
    expect(propagated.has("ShareService.getShareTree")).toBe(true);
  });

  it("任一调用方在并集外（未守卫的非公开调用方）⇒ 不豁免（fail-safe）", () => {
    const fns = [
      { name: "ShareController.getShare", file: "c.ts", calls: ["getShareTree"] },
      { name: "InternalController.export", file: "c2.ts", calls: ["getShareTree"] }, // 无守卫无公开标记
      { name: "ShareService.getShareTree", file: "s.ts", calls: [] },
    ];
    const { propagated } = sets(fns, ["ShareController.getShare"]);
    expect(propagated.has("ShareService.getShareTree")).toBe(false);
  });

  it("无调用方（入口/未连通）⇒ 不豁免（R1）", () => {
    const fns = [{ name: "orphanEntry", file: "m.ts", calls: [] }];
    const { propagated } = sets(fns, ["orphanEntry"]);
    expect(propagated.has("orphanEntry")).toBe(false);
  });

  it("歧义调用边 ⇒ 不豁免（R2 fail-safe）", () => {
    const fns = [
      { name: "PublicController.get", file: "c/ctrl.ts", calls: ["load"] },
      { name: "XxxService.load", file: "x/x.service.ts", calls: [] },
      { name: "YyyService.load", file: "y/y.service.ts", calls: [] },
    ];
    const { propagated } = sets(fns, ["PublicController.get"]);
    expect(propagated.has("XxxService.load")).toBe(false);
    expect(propagated.has("YyyService.load")).toBe(false);
  });

  it("默认 1 轮：公开下游的下游不豁免（传递闭包未开）", () => {
    const fns = [
      { name: "ShareController.getShare", file: "c.ts", calls: ["getShareTree"] },
      { name: "ShareService.getShareTree", file: "s.ts", calls: ["loadPageData"] },
      { name: "loadPageData", file: "s.ts", calls: [] },
    ];
    const { propagated } = sets(fns, ["ShareController.getShare"]);
    expect(propagated.has("ShareService.getShareTree")).toBe(true);
    expect(propagated.has("loadPageData")).toBe(false);
  });

  it("maxRounds=2 ⇒ 传递两跳成立（快照轮次语义）", () => {
    const fns = [
      { name: "ShareController.getShare", file: "c.ts", calls: ["getShareTree"] },
      { name: "ShareService.getShareTree", file: "s.ts", calls: ["loadPageData"] },
      { name: "loadPageData", file: "s.ts", calls: [] },
    ];
    const { propagated } = sets(fns, ["ShareController.getShare"], { maxRounds: 2 });
    expect(propagated.has("ShareService.getShareTree")).toBe(true);
    expect(propagated.has("loadPageData")).toBe(true);
  });

  it("返回集合只含并集新增成员（R5：公开种子/守卫/作业成员不重复进）", () => {
    const fns = [
      { name: "PublicController.show", file: "c.ts", calls: ["target"] },
      { name: "GuardedController.create", file: "c.ts", calls: [MG, "service"] },
      { name: "Job.run", file: "q.ts", calls: [MJ, "jobOnly"] },
      { name: "service", file: "s.ts", calls: ["target"] },
      { name: "jobOnly", file: "s.ts", calls: ["target"] },
      { name: "target", file: "s.ts", calls: [] },
    ];
    const { propagated } = sets(fns, ["PublicController.show"]);
    // 公开种子自身、守卫/作业成员都不重复进 propagated
    expect(propagated.has("PublicController.show")).toBe(false);
    expect(propagated.has("Job.run")).toBe(false);
    expect(propagated.has("service")).toBe(false); // 守卫传播成员（调用方全守卫）
    expect(propagated.has("jobOnly")).toBe(false); // 作业面成员
    expect(propagated.has("target")).toBe(true); // 调用方 {public[pub], service[g], jobOnly[j]} ⊆ 并集
  });

  it("自调不提供豁免证据", () => {
    const fns = [{ name: "ShareService.getShareTree", file: "s.ts", calls: ["getShareTree"] }];
    const { propagated } = sets(fns, []);
    expect(propagated.has("ShareService.getShareTree")).toBe(false);
  });
});
