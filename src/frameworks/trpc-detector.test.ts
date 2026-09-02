/**
 * trpc-detector.test.ts — tRPC 检测器回归（纯函数，无文件 I/O）
 *
 * 覆盖 V4 真实语料（netflx-web）暴露的两项缺陷：
 *  1. 链匹配正则不跨嵌套括号 → 标准 .input(z.object({...})) 过程失明
 *  2. PROCEDURE_TYPE_PATTERN /g lastIndex 泄漏 → 逐文件扫描漂移
 */
import { describe, it, expect } from "vitest";
import { detectTRPCApp, extractProcedures, analyzeTRPCFile } from "./trpc-detector";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// ── 修复 1：标准 .input 链（嵌套括号/多行）必须可见 ──

const ROUTER_WITH_INPUT = `
const t = initTRPC.context<{ db: Db }>().create();
export const postRouter = t.router({
  addComment: protectedProcedure
    .input(
      z.object({
        articleId: z.string(),
        body: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db.comment.create({ data: { articleId: input.articleId } });
    }),
  list: publicProcedure.query(async ({ ctx }) => ctx.db.comment.findMany()),
});`;

const ROUTER_WITH_BARE_MUTATION = `
export const appRouter = t.router({
  deleteAll: publicProcedure.mutation(async ({ ctx, input }) => {
    await ctx.prisma.post.deleteMany();
  }),
});`;

describe("trpc extractProcedures — 括号感知链", () => {
  it("标准多行 .input(z.object({...})) mutation 可见且有 input schema（V4 缺陷回归）", () => {
    const procs = extractProcedures(ROUTER_WITH_INPUT);
    const add = procs.find((p) => p.name === "addComment");
    expect(add).toBeDefined();
    expect(add!.kind).toBe("mutation");
    expect(add!.procedureType).toBe("protected");
    expect(add!.hasInputSchema).toBe(true);
    // 无 schema 的 query 也照常可见
    expect(procs.some((p) => p.name === "list" && p.hasInputSchema === false)).toBe(true);
  });

  it("单行 .input(z.string()) 链可见", () => {
    const procs = extractProcedures(`
export const r = t.router({
  getOne: protectedProcedure.input(z.string()).query(async ({ ctx, input }) => {
    return ctx.db.get(input);
  }),
});`);
    const p = procs.find((x) => x.name === "getOne");
    expect(p).toBeDefined();
    expect(p!.hasInputSchema).toBe(true);
  });

  it("裸链 mutation（无 input）仍可见并可触发规则", () => {
    const procs = extractProcedures(ROUTER_WITH_BARE_MUTATION);
    const del = procs.find((p) => p.name === "deleteAll");
    expect(del).toBeDefined();
    expect(del!.kind).toBe("mutation");
    expect(del!.hasInputSchema).toBe(false);
    expect(del!.doesDbWrite).toBe(true);
  });

  it("完整分析：合规 router 0 issues，裸 public mutation 报 TRPC_PUBLIC_MUTATION", () => {
    const tmp = path.join(os.tmpdir(), "trpc-good-router.ts");
    fs.writeFileSync(tmp, ROUTER_WITH_INPUT);
    try {
      const good = analyzeTRPCFile(tmp);
      expect(good.issues).toHaveLength(0);
      expect(good.procedures.length).toBe(2);
    } finally {
      fs.unlinkSync(tmp);
    }
    const tmp2 = path.join(os.tmpdir(), "trpc-bad-router.ts");
    fs.writeFileSync(tmp2, ROUTER_WITH_BARE_MUTATION);
    try {
      const bad = analyzeTRPCFile(tmp2);
      expect(bad.issues.map((i) => i.rule)).toContain("TRPC_PUBLIC_MUTATION");
      expect(bad.issues.map((i) => i.rule)).toContain("TRPC_MUTATION_WITHOUT_INPUT_SCHEMA");
    } finally {
      fs.unlinkSync(tmp2);
    }
  });
});

// ── 修复 2：lastIndex 泄漏回归 ──

describe("detectTRPCApp — 无 /g lastIndex 泄漏", () => {
  it("连续多次调用结果稳定（旧 /g 实现会漂移）", () => {
    const trpcCode = `const t = initTRPC.create(); export const r = t.router({ a: publicProcedure.query(() => 1) });`;
    const plainCode = `export const sum = (a: number, b: number) => a + b;`;
    // 交替调用多次：泄漏时第二次起结果不稳定
    const results = [];
    for (let i = 0; i < 6; i++) {
      results.push(detectTRPCApp(trpcCode)); // 应为 true
      results.push(detectTRPCApp(plainCode)); // 应为 false
    }
    expect(results.filter(Boolean)).toHaveLength(6); // 恰好 6 个 true
    expect(results).toEqual([
      true, false, true, false, true, false, true, false, true, false, true, false,
    ]);
  });
});
