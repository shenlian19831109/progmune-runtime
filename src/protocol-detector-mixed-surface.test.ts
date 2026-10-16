import { describe, it, expect } from "vitest";
import {
  computeGuardPropagatedSet,
  computeJobSurfacePropagatedSet,
  computeMixedSurfacePropagatedSet,
} from "./protocol-detector";

/**
 * 调用方混合并集豁免（修冤枉第九刀，2026-10-16）单元测试。
 *
 * 判据（见 computeMixedSurfacePropagatedSet 注释）：
 *   函数 F 的每个直接调用方都 ∈ {已守卫传播集} ∪ {作业面传播集} ⇒
 *   F 无未鉴权请求面（每条到达 F 的路径要么已过守卫、要么源起作业）。
 * R1-R5：调用方非空 / 边全解析 / 全部落在并集内 / 快照轮次默认 1 /
 * 返回集合只含并集新增成员。
 * 消费方（engine）负责 R5/R6：只压 authorization 类、且不压直接标记函数。
 */

const MG = "__progmune_auth_machinery__";
const MJ = "__progmune_no_request_surface__";

/** 便捷：guard/job 集 + 混合集一并算 */
function sets(fns: Array<{ name: string; file?: string; calls?: string[] }>, opts?: { maxRounds?: number }) {
  const guard = computeGuardPropagatedSet(fns);
  const job = computeJobSurfacePropagatedSet(fns);
  const mixed = computeMixedSurfacePropagatedSet(fns, guard, job, opts);
  return { guard, job, mixed };
}

describe("computeMixedSurfacePropagatedSet（调用方混合并集，第九刀）", () => {
  it("混合调用方（已守卫 + 作业）⇒ 豁免", () => {
    const fns = [
      { name: "GuardedController.create", file: "c/page.controller.ts", calls: [MG, "log"] },
      { name: "AuditService.log", file: "s/audit.service.ts", calls: ["fn"] },
      { name: "DigestJob.run", file: "q/digest.job.ts", calls: [MJ, "fn"] },
      { name: "MixedTarget.fn", file: "m/target.ts", calls: [] },
    ];
    // AuditService.log：全部调用方已守卫 ⇒ 守卫集成员；
    // MixedTarget.fn 调用方 = {AuditService.log[g], DigestJob.run[j]} ⇒ 混合豁免
    const { guard, job, mixed } = sets(fns);
    expect(guard.has("AuditService.log")).toBe(true);
    expect(job.has("DigestJob.run")).toBe(true);
    expect(mixed.has("MixedTarget.fn")).toBe(true);
  });

  it("全部调用方已守卫但超过守卫传播深度（第 4 跳）⇒ 并集豁免", () => {
    const fns = [
      { name: "AuthRoot", file: "f.ts", calls: [MG, "b"] },
      { name: "b", file: "f.ts", calls: ["c"] },
      { name: "c", file: "f.ts", calls: ["d"] },
      { name: "d", file: "f.ts", calls: ["e"] },
      { name: "e", file: "f.ts", calls: [] },
    ];
    const { guard, mixed } = sets(fns);
    expect(guard.has("d")).toBe(true); // 第 3 跳：在守卫集内
    expect(guard.has("e")).toBe(false); // 第 4 跳：守卫传播边界外
    expect(mixed.has("e")).toBe(true); // 并集判据罩住（调用方 d ∈ 守卫集）
  });

  it("作业调用方与作业面集族级保守的差异：按边解析只豁免作业链成员", () => {
    // docmost 实测形态：作业处理器与被调方同「类根」（processExpiring
    // → getPageContext），逐边消歧可解析。B 判据（第七刀）在裸名族含
    // HTTP 调用方时全族不豁免；并集判据按边解析——只豁免作业链上
    // 那个成员，HTTP 面成员照报。
    const fns = [
      { name: "VerificationNotificationService.processExpiring", file: "s/verification.service.ts", calls: [MJ, "getPageContext"] },
      { name: "VerificationNotificationService.getPageContext", file: "s/verification.service.ts", calls: [] },
      { name: "PageNotificationService.getPageContext", file: "s/page.service.ts", calls: [] },
      { name: "PageNotificationService.notify", file: "s/page.service.ts", calls: ["getPageContext"] }, // 同文件 HTTP 面调用方
    ];
    const { job, mixed } = sets(fns);
    // 第七刀 B 判据：裸名族含非作业调用方 ⇒ 全族不豁免
    expect(job.has("VerificationNotificationService.getPageContext")).toBe(false);
    expect(job.has("PageNotificationService.getPageContext")).toBe(false);
    // 第九刀并集：边解析逐条——Verification 成员只被作业调用 ⇒ 豁免；
    // Page 成员被 notify（并集外）调用 ⇒ 不豁免
    expect(mixed.has("VerificationNotificationService.getPageContext")).toBe(true);
    expect(mixed.has("PageNotificationService.getPageContext")).toBe(false);
  });

  it("任一调用方在并集外 ⇒ 不豁免（fail-safe）", () => {
    const fns = [
      { name: "GuardedController.create", file: "c.ts", calls: [MG, "write"] },
      { name: "PublicController.import", file: "c2.ts", calls: ["write"] },
      { name: "write", file: "r.ts", calls: [] },
    ];
    const { mixed } = sets(fns);
    expect(mixed.has("write")).toBe(false);
  });

  it("无调用方（入口/未连通）⇒ 不豁免（R1）", () => {
    const fns = [{ name: "orphanEntry", file: "m.ts", calls: [] }];
    const { mixed } = sets(fns);
    expect(mixed.has("orphanEntry")).toBe(false);
  });

  it("歧义调用边 ⇒ 不豁免（R2 fail-safe）", () => {
    // 同名裸名两个候选、调用方无法消歧（不同文件不同目录不同类根）
    const fns = [
      { name: "GuardedController.create", file: "c/ctrl.ts", calls: [MG, "load"] },
      { name: "XxxService.load", file: "x/x.service.ts", calls: [] },
      { name: "YyyService.load", file: "y/y.service.ts", calls: [] },
    ];
    const { mixed } = sets(fns);
    expect(mixed.has("XxxService.load")).toBe(false);
    expect(mixed.has("YyyService.load")).toBe(false);
  });

  it("默认 1 轮：并集下游的下游不豁免（传递闭包未开）", () => {
    const fns = [
      { name: "Job.run", file: "q.ts", calls: [MJ, "b"] },
      { name: "b", file: "f.ts", calls: ["c"] },
      { name: "c", file: "f.ts", calls: ["d"] },
      { name: "d", file: "f.ts", calls: [] },
    ];
    const { job, mixed } = sets(fns);
    expect(job.has("b")).toBe(true); // b 已在作业面集（第七刀，第 1 跳）
    expect(mixed.has("b")).toBe(false); // R5：既有成员不重复进 mixed
    expect(mixed.has("c")).toBe(true); // c 调用方 {b[j]} ⊆ 并集 ⇒ 混合豁免
    expect(mixed.has("d")).toBe(false); // d 调用方 {c} 不在并集（1 轮）⇒ 不豁免
  });

  it("maxRounds=2 ⇒ 传递两跳成立（快照轮次语义）", () => {
    const fns = [
      { name: "Job.run", file: "q.ts", calls: [MJ, "b"] },
      { name: "b", file: "f.ts", calls: ["c"] },
      { name: "c", file: "f.ts", calls: ["d"] },
      { name: "d", file: "f.ts", calls: [] },
    ];
    const { mixed } = sets(fns, { maxRounds: 2 });
    expect(mixed.has("c")).toBe(true);
    expect(mixed.has("d")).toBe(true); // 第 2 轮：d 调用方 {c} ⊆ 并集∪第 1 轮新增
  });

  it("返回集合只含并集新增成员（R5：种子/既有成员由各自刀处理）", () => {
    const fns = [
      { name: "GuardedController.create", file: "c.ts", calls: [MG, "service"] },
      { name: "Job.run", file: "q.ts", calls: [MJ, "jobOnly"] },
      { name: "service", file: "s.ts", calls: ["target"] },
      { name: "jobOnly", file: "s.ts", calls: ["target"] },
      { name: "target", file: "s.ts", calls: [] },
    ];
    const { guard, job, mixed } = sets(fns);
    // 种子/既有成员（GuardedController.create、Job.run、service、jobOnly）不重复进 mixed
    expect(guard.has("service")).toBe(true); // service 全部调用方已守卫 ⇒ 守卫集成员
    expect(job.has("jobOnly")).toBe(true); // jobOnly 只被作业调用 ⇒ 作业面成员
    expect(mixed.has("GuardedController.create")).toBe(false);
    expect(mixed.has("Job.run")).toBe(false);
    expect(mixed.has("service")).toBe(false);
    expect(mixed.has("jobOnly")).toBe(false);
    // 新增成员：target 调用方 = {service[g], jobOnly[j]} ⇒ 混合豁免
    expect(mixed.has("target")).toBe(true);
  });

  it("自调不提供豁免证据", () => {
    const fns = [{ name: "CleanupService.cleanup", file: "s.ts", calls: ["cleanup"] }];
    const { mixed } = sets(fns);
    expect(mixed.has("CleanupService.cleanup")).toBe(false);
  });

  it("直接标记函数不进入混合新增集合（自身已是守卫/作业种子）", () => {
    const fns = [
      { name: "GuardedController.create", file: "c.ts", calls: [MG, "self2"] },
      { name: "self2", file: "c.ts", calls: [] },
    ];
    const { mixed } = sets(fns);
    expect(mixed.has("GuardedController.create")).toBe(false);
    expect(mixed.has("self2")).toBe(false); // self2 已在守卫集（第 1 跳）
  });
});
