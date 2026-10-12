import { describe, it, expect } from "vitest";
import { computeJobSurfacePropagatedSet } from "./protocol-detector";

/**
 * 作业调用方传播（修冤枉第七刀，2026-10-11）单元测试。
 *
 * B 判据（裸名并集，见 computeJobSurfacePropagatedSet 注释）：
 *   函数的调用方并集（调用名=裸名的所有函数）非空且全部带
 *   __progmune_no_request_surface__ 标记 ⇒ 豁免；默认 1 轮。
 * 正确性前提：IR 调用名即裸名 ⇒ 真实调用方必在并集中 ⇒
 *   并集全作业蕴含真实调用方全作业（R75 正向证据）。
 * 与第五刀的差别：歧义不阻断——同名族任一成员被非作业调用，
 *   整个裸名族都不豁免（比逐边消歧更保守的族级行为）。
 * 消费方（engine）负责 R5/R6：只压 authorization 类、且不压直接标记函数。
 */

const M = "__progmune_no_request_surface__";

describe("computeJobSurfacePropagatedSet（作业调用方传播，B 判据）", () => {
  it("全部调用方是作业 ⇒ 传播（Processor→Service）", () => {
    const fns = [
      { name: "NotificationProcessor.process", file: "q/notification.processor.ts", calls: [M, "processPageUpdate"] },
      { name: "PageNotificationService.processPageUpdate", file: "s/page-notification.service.ts", calls: ["insertNotification"] },
    ];
    const g = computeJobSurfacePropagatedSet(fns);
    expect(g.has("PageNotificationService.processPageUpdate")).toBe(true);
  });

  it("同名裸名多候选且调用方全作业 ⇒ 并集判据豁免（第五刀此处会阻断）", () => {
    // processDigest 裸名有两个定义；调用方是两个不同的作业
    // 处理器。逐边消歧（第五刀）会挂未解析边阻断；并集判据
    // 检查「所有可能调用方全作业」⇒ 豁免。
    const fns = [
      { name: "EmailProcessor.process", file: "q/email.processor.ts", calls: [M, "processDigest"] },
      { name: "DigestProcessor.process", file: "q/digest.processor.ts", calls: [M, "processDigest"] },
      { name: "PageNotificationService.processDigest", file: "s/page.service.ts", calls: [] },
      { name: "CommentNotificationService.processDigest", file: "s/comment.service.ts", calls: [] },
    ];
    const g = computeJobSurfacePropagatedSet(fns);
    expect(g.has("PageNotificationService.processDigest")).toBe(true);
    expect(g.has("CommentNotificationService.processDigest")).toBe(true);
  });

  it("同名族任一成员被非作业调用 ⇒ 整个裸名族不豁免（保守族级）", () => {
    const fns = [
      { name: "EmailProcessor.process", file: "q.ts", calls: [M, "processDigest"] },
      { name: "PageController.show", file: "c.ts", calls: ["processDigest"] },
      { name: "PageNotificationService.processDigest", file: "s1.ts", calls: [] },
      { name: "CommentNotificationService.processDigest", file: "s2.ts", calls: [] },
    ];
    const g = computeJobSurfacePropagatedSet(fns);
    expect(g.has("PageNotificationService.processDigest")).toBe(false);
    expect(g.has("CommentNotificationService.processDigest")).toBe(false);
  });

  it("调用方含非作业 ⇒ 不豁免（fail-safe）", () => {
    const fns = [
      { name: "EmailProcessor.process", file: "q.ts", calls: [M, "markAsEmailed"] },
      { name: "NotificationService.markAsEmailedDirect", file: "s.ts", calls: ["markAsEmailed"] },
      { name: "NotificationRepo.markAsEmailed", file: "r.ts", calls: [] },
    ];
    const g = computeJobSurfacePropagatedSet(fns);
    expect(g.has("NotificationRepo.markAsEmailed")).toBe(false);
  });

  it("无调用方（入口/未连通）⇒ 不豁免", () => {
    const fns = [
      { name: "orphanJobHelper", file: "m.ts", calls: [] },
    ];
    const g = computeJobSurfacePropagatedSet(fns);
    expect(g.has("orphanJobHelper")).toBe(false);
  });

  it("默认 1 轮：作业下游的下游不豁免（传递闭包未开）", () => {
    const fns = [
      { name: "NotificationProcessor.process", file: "q.ts", calls: [M, "processPageUpdate"] },
      { name: "PageNotificationService.processPageUpdate", file: "s.ts", calls: ["insertNotification"] },
      { name: "NotificationRepo.insertNotification", file: "r.ts", calls: [] },
    ];
    const g = computeJobSurfacePropagatedSet(fns);
    expect(g.has("PageNotificationService.processPageUpdate")).toBe(true);
    expect(g.has("NotificationRepo.insertNotification")).toBe(false);
  });

  it("maxHops=2 ⇒ 传递两跳成立（快照轮次语义）", () => {
    const fns = [
      { name: "NotificationProcessor.process", file: "q.ts", calls: [M, "processPageUpdate"] },
      { name: "PageNotificationService.processPageUpdate", file: "s.ts", calls: ["insertNotification"] },
      { name: "NotificationRepo.insertNotification", file: "r.ts", calls: [] },
    ];
    const g = computeJobSurfacePropagatedSet(fns, { maxHops: 2 });
    expect(g.has("NotificationRepo.insertNotification")).toBe(true);
  });

  it("自调不提供豁免证据（自己不是作业 ⇒ 不能靠自调豁免）", () => {
    const fns = [
      { name: "CleanupService.cleanup", file: "s.ts", calls: ["cleanup"] },
    ];
    const g = computeJobSurfacePropagatedSet(fns);
    expect(g.has("CleanupService.cleanup")).toBe(false);
  });

  it("限定形态调用名（Class.method）按裸名命中（裸化只增候选，保守方向）", () => {
    const fns = [
      { name: "Job.run", file: "q.ts", calls: [M, "PageService.processUpdate"] },
      { name: "PageService.processUpdate", file: "s.ts", calls: [] },
    ];
    const g = computeJobSurfacePropagatedSet(fns);
    expect(g.has("PageService.processUpdate")).toBe(true);
  });

  it("直接标记函数在返回集合中（种子语义，R6 由消费方过滤）", () => {
    const fns = [{ name: "Job.run", file: "q.ts", calls: [M] }];
    const g = computeJobSurfacePropagatedSet(fns);
    expect(g.has("Job.run")).toBe(true);
  });

  it("自定义标记通道", () => {
    const fns = [
      { name: "A", file: "f.ts", calls: ["__custom_mark__", "B"] },
      { name: "B", file: "f.ts", calls: [] },
    ];
    const g = computeJobSurfacePropagatedSet(fns, { marker: "__custom_mark__" });
    expect(g.has("B")).toBe(true);
    // 默认标记下不传播
    const g2 = computeJobSurfacePropagatedSet(fns);
    expect(g2.has("B")).toBe(false);
  });
});
