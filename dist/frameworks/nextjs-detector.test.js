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
 * nextjs-detector.test.ts — Next.js App Router 适配器规则回归（文件系统 I/O，
 * 使用临时目录夹具——与 express-detector.test.ts 同款风格）
 */
const vitest_1 = require("vitest");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const nextjs_detector_1 = require("./nextjs-detector");
let dir;
(0, vitest_1.beforeEach)(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "nextjs-det-"));
});
(0, vitest_1.afterEach)(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});
function writeRoute(rel, code) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, code);
}
const MUTATION_ROUTE = `export async function POST(req: Request) {
  return Response.json({ ok: true });
}
`;
const AUTHED_ROUTE = `import { getServerSession } from "next-auth";
export async function POST(req: Request) {
  const session = await getServerSession();
  return Response.json({ ok: true });
}
`;
const AUTH_MIDDLEWARE = `import { withAuth } from "next-auth/middleware";
export default withAuth(function middleware(req) {});
`;
(0, vitest_1.describe)("nextjs-detector", () => {
    (0, vitest_1.it)("R1：无认证 mutation 路由文件 → NEXT_ROUTE_NO_AUTH", () => {
        writeRoute("app/api/transfer/route.ts", MUTATION_ROUTE);
        const { hasNext, issues } = (0, nextjs_detector_1.analyzeNextApp)(dir);
        (0, vitest_1.expect)(hasNext).toBe(true);
        (0, vitest_1.expect)(issues.map((i) => i.rule)).toContain("NEXT_ROUTE_NO_AUTH");
    });
    (0, vitest_1.it)("R1：路由内 getServerSession 认证调用保护不报", () => {
        writeRoute("app/api/transfer/route.ts", AUTHED_ROUTE);
        const { issues } = (0, nextjs_detector_1.analyzeNextApp)(dir);
        (0, vitest_1.expect)(issues).toHaveLength(0);
    });
    (0, vitest_1.it)("R1：认证 middleware 全局保护不报", () => {
        writeRoute("app/api/transfer/route.ts", MUTATION_ROUTE);
        writeRoute("middleware.ts", AUTH_MIDDLEWARE);
        const mw = (0, nextjs_detector_1.readNextMiddleware)(dir);
        const { issues } = (0, nextjs_detector_1.analyzeNextApp)(dir, mw);
        (0, vitest_1.expect)(issues).toHaveLength(0);
    });
    (0, vitest_1.it)("R1：GET 导出不报（公开读）", () => {
        writeRoute("app/api/articles/route.ts", `export async function GET() { return Response.json([]); }`);
        const { issues } = (0, nextjs_detector_1.analyzeNextApp)(dir);
        (0, vitest_1.expect)(issues).toHaveLength(0);
    });
    (0, vitest_1.it)("R1 豁免：login/auth 认证入口路径不报", () => {
        writeRoute("app/api/auth/login/route.ts", MUTATION_ROUTE);
        const { issues } = (0, nextjs_detector_1.analyzeNextApp)(dir);
        (0, vitest_1.expect)(issues).toHaveLength(0);
    });
    (0, vitest_1.it)("pages/api 旧式路由同样覆盖", () => {
        writeRoute("pages/api/transfer.ts", `export default function handler(req, res) { res.json({ok:true}); }`);
        // 无 export function POST 的旧式 handler 不识别方法 → 无 flag（口径如实）
        writeRoute("pages/api/transfer2.ts", `export default async function POST(req: Request) { return Response.json({}); }`);
        const { hasNext, issues } = (0, nextjs_detector_1.analyzeNextApp)(dir);
        (0, vitest_1.expect)(hasNext).toBe(true);
        // transfer2 无 POST 导出匹配（default 导出非具名）——旧式页路由方法不可静态区分，如实
        (0, vitest_1.expect)(issues).toHaveLength(0);
    });
    (0, vitest_1.it)("无 Next.js 结构的目录不产生问题", () => {
        const { hasNext, issues } = (0, nextjs_detector_1.analyzeNextApp)(dir);
        (0, vitest_1.expect)(hasNext).toBe(false);
        (0, vitest_1.expect)(issues).toHaveLength(0);
    });
    (0, vitest_1.it)("V5 修复回归：Stripe webhook 签名校验（constructEvent）视为端点认证——不报", () => {
        writeRoute("app/api/webhooks/stripe/route.ts", `
import { stripe } from "@/lib/stripe";
export async function POST(req: Request) {
  const body = await req.text();
  const signature = req.headers.get("stripe-signature") as string;
  const event = stripe.webhooks.constructEvent(body, signature, process.env.SECRET!);
  return Response.json({ received: true });
}
`);
        const { issues } = (0, nextjs_detector_1.analyzeNextApp)(dir);
        (0, vitest_1.expect)(issues).toHaveLength(0);
    });
    (0, vitest_1.it)("V5 修复回归：webhook 无签名校验仍报（保留对真缺失认证的敏感性）", () => {
        writeRoute("app/api/webhooks/stripe/route.ts", `
export async function POST(req: Request) {
  const body = await req.text();
  return Response.json({ received: true });
}
`);
        const { issues } = (0, nextjs_detector_1.analyzeNextApp)(dir);
        (0, vitest_1.expect)(issues.map((i) => i.rule)).toContain("NEXT_ROUTE_NO_AUTH");
    });
    (0, vitest_1.it)("V5 修复回归：next-auth v5 / clerk 裸 auth() 调用视为认证——不报", () => {
        writeRoute("app/api/transfer/route.ts", `
import { auth } from "@/auth";
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return new Response(null, { status: 403 });
  return Response.json({ ok: true });
}
`);
        const { issues } = (0, nextjs_detector_1.analyzeNextApp)(dir);
        (0, vitest_1.expect)(issues).toHaveLength(0);
    });
});
