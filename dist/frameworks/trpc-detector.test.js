"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * trpc-detector.test.ts — tRPC 检测器回归（纯函数，无文件 I/O）
 *
 * 覆盖 V4 真实语料（netflx-web）暴露的两项缺陷：
 *  1. 链匹配正则不跨嵌套括号 → 标准 .input(z.object({...})) 过程失明
 *  2. PROCEDURE_TYPE_PATTERN /g lastIndex 泄漏 → 逐文件扫描漂移
 */
const vitest_1 = require("vitest");
const trpc_detector_1 = require("./trpc-detector");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
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
(0, vitest_1.describe)("trpc extractProcedures — 括号感知链", () => {
    (0, vitest_1.it)("标准多行 .input(z.object({...})) mutation 可见且有 input schema（V4 缺陷回归）", () => {
        const procs = (0, trpc_detector_1.extractProcedures)(ROUTER_WITH_INPUT);
        const add = procs.find((p) => p.name === "addComment");
        (0, vitest_1.expect)(add).toBeDefined();
        (0, vitest_1.expect)(add.kind).toBe("mutation");
        (0, vitest_1.expect)(add.procedureType).toBe("protected");
        (0, vitest_1.expect)(add.hasInputSchema).toBe(true);
        // 无 schema 的 query 也照常可见
        (0, vitest_1.expect)(procs.some((p) => p.name === "list" && p.hasInputSchema === false)).toBe(true);
    });
    (0, vitest_1.it)("单行 .input(z.string()) 链可见", () => {
        const procs = (0, trpc_detector_1.extractProcedures)(`
export const r = t.router({
  getOne: protectedProcedure.input(z.string()).query(async ({ ctx, input }) => {
    return ctx.db.get(input);
  }),
});`);
        const p = procs.find((x) => x.name === "getOne");
        (0, vitest_1.expect)(p).toBeDefined();
        (0, vitest_1.expect)(p.hasInputSchema).toBe(true);
    });
    (0, vitest_1.it)("裸链 mutation（无 input）仍可见并可触发规则", () => {
        const procs = (0, trpc_detector_1.extractProcedures)(ROUTER_WITH_BARE_MUTATION);
        const del = procs.find((p) => p.name === "deleteAll");
        (0, vitest_1.expect)(del).toBeDefined();
        (0, vitest_1.expect)(del.kind).toBe("mutation");
        (0, vitest_1.expect)(del.hasInputSchema).toBe(false);
        (0, vitest_1.expect)(del.doesDbWrite).toBe(true);
    });
    (0, vitest_1.it)("完整分析：合规 router 0 issues，裸 public mutation 报 TRPC_PUBLIC_MUTATION", () => {
        const tmp = path.join(os.tmpdir(), "trpc-good-router.ts");
        fs.writeFileSync(tmp, ROUTER_WITH_INPUT);
        try {
            const good = (0, trpc_detector_1.analyzeTRPCFile)(tmp);
            (0, vitest_1.expect)(good.issues).toHaveLength(0);
            (0, vitest_1.expect)(good.procedures.length).toBe(2);
        }
        finally {
            fs.unlinkSync(tmp);
        }
        const tmp2 = path.join(os.tmpdir(), "trpc-bad-router.ts");
        fs.writeFileSync(tmp2, ROUTER_WITH_BARE_MUTATION);
        try {
            const bad = (0, trpc_detector_1.analyzeTRPCFile)(tmp2);
            (0, vitest_1.expect)(bad.issues.map((i) => i.rule)).toContain("TRPC_PUBLIC_MUTATION");
            (0, vitest_1.expect)(bad.issues.map((i) => i.rule)).toContain("TRPC_MUTATION_WITHOUT_INPUT_SCHEMA");
        }
        finally {
            fs.unlinkSync(tmp2);
        }
    });
});
// ── 修复 2：lastIndex 泄漏回归 ──
(0, vitest_1.describe)("detectTRPCApp — 无 /g lastIndex 泄漏", () => {
    (0, vitest_1.it)("连续多次调用结果稳定（旧 /g 实现会漂移）", () => {
        const trpcCode = `const t = initTRPC.create(); export const r = t.router({ a: publicProcedure.query(() => 1) });`;
        const plainCode = `export const sum = (a: number, b: number) => a + b;`;
        // 交替调用多次：泄漏时第二次起结果不稳定
        const results = [];
        for (let i = 0; i < 6; i++) {
            results.push((0, trpc_detector_1.detectTRPCApp)(trpcCode)); // 应为 true
            results.push((0, trpc_detector_1.detectTRPCApp)(plainCode)); // 应为 false
        }
        (0, vitest_1.expect)(results.filter(Boolean)).toHaveLength(6); // 恰好 6 个 true
        (0, vitest_1.expect)(results).toEqual([
            true, false, true, false, true, false, true, false, true, false, true, false,
        ]);
    });
});
// ── tRPC v11：内联 t.procedure 形态（V4 遗留缺口）──
(0, vitest_1.describe)("trpc v11 t.procedure 支持", () => {
    (0, vitest_1.it)("t.procedure.input(z.object).mutation 可见且视为公开（默认语义）", () => {
        const procs = (0, trpc_detector_1.extractProcedures)(`
import { initTRPC } from "@trpc/server";
const t = initTRPC.create();
export const r = t.router({
  ping: t.procedure
    .input(z.object({ msg: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.log.create({ data: { msg: input.msg } });
    }),
  list: t.procedure.query(async () => []),
});`);
        const ping = procs.find((p) => p.name === "ping");
        (0, vitest_1.expect)(ping).toBeDefined();
        (0, vitest_1.expect)(ping.kind).toBe("mutation");
        (0, vitest_1.expect)(ping.procedureType).toBe("public");
        (0, vitest_1.expect)(ping.hasInputSchema).toBe(true);
        (0, vitest_1.expect)(procs.some((p) => p.name === "list")).toBe(true);
    });
    (0, vitest_1.it)("裸 t.procedure mutation（无 input）触发规则（敏感性与命名包装一致）", () => {
        const procs = (0, trpc_detector_1.extractProcedures)(`
export const r = t.router({
  nuke: t.procedure.mutation(async ({ ctx }) => {
    await ctx.prisma.post.deleteMany();
  }),
});`);
        const nuke = procs.find((p) => p.name === "nuke");
        (0, vitest_1.expect)(nuke).toBeDefined();
        (0, vitest_1.expect)(nuke.hasInputSchema).toBe(false);
        (0, vitest_1.expect)(nuke.doesDbWrite).toBe(true);
    });
    (0, vitest_1.it)("netflx v10 命名包装形态不受影响（19/19 保持）", () => {
        const procs = (0, trpc_detector_1.extractProcedures)(ROUTER_WITH_INPUT);
        (0, vitest_1.expect)(procs.length).toBe(2);
    });
});
