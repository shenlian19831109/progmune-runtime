import { describe, it, expect } from "vitest";
import { computeGuardPropagatedSet } from "./protocol-detector";

/**
 * 守卫传播（修冤枉第五刀，2026-10-10）单元测试。
 *
 * 保守判据（R1-R4，fail-safe 方向）：全部调用方已守卫才豁免、
 * ≤3 跳、只认 __progmune_auth_machinery__ 标记、歧义调用按未守卫处理。
 * 消费方（engine）负责 R5/R6：只压 authorization 类、且不压直接标记函数。
 */

const M = "__progmune_auth_machinery__";

describe("computeGuardPropagatedSet（守卫传播保守判据）", () => {
  it("全部调用方已守卫 ⇒ 传播（controller→service）", () => {
    const fns = [
      { name: "PageController.create", file: "a.ts", calls: [M, "createPage"] },
      { name: "PageService.createPage", file: "b.ts", calls: ["insertPage"] },
      { name: "PageRepo.insertPage", file: "c.ts", calls: [] },
    ];
    const g = computeGuardPropagatedSet(fns);
    expect(g.has("PageService.createPage")).toBe(true);
  });

  it("传递两跳（controller→service→repo）", () => {
    const fns = [
      { name: "PageController.create", file: "a.ts", calls: [M, "createPage"] },
      { name: "PageService.createPage", file: "b.ts", calls: ["insertPage"] },
      { name: "PageRepo.insertPage", file: "c.ts", calls: [] },
    ];
    const g = computeGuardPropagatedSet(fns);
    expect(g.has("PageRepo.insertPage")).toBe(true);
  });

  it("任一调用方未守卫 ⇒ 不豁免（fail-safe）", () => {
    const fns = [
      { name: "PageController.create", file: "a.ts", calls: [M, "createPage"] },
      { name: "ImportProcessor.run", file: "q.ts", calls: ["createPage"] },
      { name: "PageService.createPage", file: "b.ts", calls: [] },
    ];
    const g = computeGuardPropagatedSet(fns);
    expect(g.has("PageService.createPage")).toBe(false);
  });

  it("无调用方（入口函数）⇒ 不豁免", () => {
    const fns = [{ name: "bootstrap", file: "m.ts", calls: [] }];
    const g = computeGuardPropagatedSet(fns);
    expect(g.has("bootstrap")).toBe(false);
  });

  it("同名多处定义 ⇒ 歧义 fail-safe ⇒ 不豁免", () => {
    const fns = [
      { name: "AController.do", file: "a.ts", calls: [M, "update"] },
      { name: "UserRepo.update", file: "r1.ts", calls: [] },
      { name: "SpaceRepo.update", file: "r2.ts", calls: [] },
    ];
    const g = computeGuardPropagatedSet(fns);
    // "update" 有两个候选，调用方 AController.do 的调用无法唯一解析
    expect(g.has("UserRepo.update")).toBe(false);
    expect(g.has("SpaceRepo.update")).toBe(false);
  });

  it("歧义时同文件唯一候选 ⇒ 消歧成立", () => {
    const fns = [
      { name: "AController.do", file: "a.ts", calls: [M, "update"] },
      // UserRepo.update 与调用方同文件（helpers 场景）
      { name: "UserRepo.update", file: "a.ts", calls: [] },
      { name: "SpaceRepo.update", file: "r2.ts", calls: [] },
    ];
    const g = computeGuardPropagatedSet(fns);
    expect(g.has("UserRepo.update")).toBe(true);
    expect(g.has("SpaceRepo.update")).toBe(false);
  });

  it("歧义时同目录唯一候选 ⇒ 消歧成立", () => {
    const fns = [
      { name: "AController.do", file: "d1/x.ts", calls: [M, "update"] },
      { name: "UserRepo.update", file: "d1/y.ts", calls: [] },
      { name: "SpaceRepo.update", file: "d2/z.ts", calls: [] },
    ];
    const g = computeGuardPropagatedSet(fns);
    expect(g.has("UserRepo.update")).toBe(true);
    expect(g.has("SpaceRepo.update")).toBe(false);
  });

  it("歧义时类根对齐唯一候选 ⇒ 消歧成立（MVC 命名惯例）", () => {
    const fns = [
      { name: "PageController.create", file: "c/page.controller.ts", calls: [M, "create"] },
      { name: "PageService.create", file: "s/page.service.ts", calls: [] },
      { name: "SpaceService.create", file: "s/space.service.ts", calls: [] },
    ];
    const g = computeGuardPropagatedSet(fns);
    expect(g.has("PageService.create")).toBe(true);
    expect(g.has("SpaceService.create")).toBe(false);
  });

  it("类根不唯一 ⇒ 保持 fail-safe", () => {
    const fns = [
      { name: "PageController.create", file: "c.ts", calls: [M, "create"] },
      { name: "PageService.create", file: "s1.ts", calls: [] },
      { name: "PageRepo.create", file: "r1.ts", calls: [] },
    ];
    // 类根 "Page" 命中两个候选（Service+Repo）⇒ 不唯一 ⇒ 不解析
    const g = computeGuardPropagatedSet(fns);
    expect(g.has("PageService.create")).toBe(false);
    expect(g.has("PageRepo.create")).toBe(false);
  });

  it("深度限制：第 4 跳不传播", () => {
    const fns = [
      { name: "C0", file: "f.ts", calls: [M, "C1"] },
      { name: "C1", file: "f.ts", calls: ["C2"] },
      { name: "C2", file: "f.ts", calls: ["C3"] },
      { name: "C3", file: "f.ts", calls: ["C4"] },
      { name: "C4", file: "f.ts", calls: [] },
    ];
    // C1 = 跳1, C2 = 跳2, C3 = 跳3, C4 = 跳4（maxDepth=3 传播 3 轮：C1,C2,C3）
    const g = computeGuardPropagatedSet(fns, { maxDepth: 3 });
    expect(g.has("C1")).toBe(true);
    expect(g.has("C2")).toBe(true);
    expect(g.has("C3")).toBe(true);
    expect(g.has("C4")).toBe(false);
  });

  it("自定义标记通道", () => {
    const fns = [
      { name: "A", file: "f.ts", calls: ["__custom_mark__", "B"] },
      { name: "B", file: "f.ts", calls: [] },
    ];
    const g = computeGuardPropagatedSet(fns, { marker: "__custom_mark__" });
    expect(g.has("B")).toBe(true);
    // 默认标记下不传播
    const g2 = computeGuardPropagatedSet(fns);
    expect(g2.has("B")).toBe(false);
  });

  it("直接标记函数在返回集合中（种子语义，R6 由消费方过滤）", () => {
    const fns = [{ name: "AController.do", file: "a.ts", calls: [M] }];
    const g = computeGuardPropagatedSet(fns);
    expect(g.has("AController.do")).toBe(true);
  });
});
