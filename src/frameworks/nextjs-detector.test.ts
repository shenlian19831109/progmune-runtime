/**
 * nextjs-detector.test.ts — Next.js App Router 适配器规则回归（文件系统 I/O，
 * 使用临时目录夹具——与 express-detector.test.ts 同款风格）
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { analyzeNextApp, readNextMiddleware } from "./nextjs-detector";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "nextjs-det-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeRoute(rel: string, code: string) {
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

describe("nextjs-detector", () => {
  it("R1：无认证 mutation 路由文件 → NEXT_ROUTE_NO_AUTH", () => {
    writeRoute("app/api/transfer/route.ts", MUTATION_ROUTE);
    const { hasNext, issues } = analyzeNextApp(dir);
    expect(hasNext).toBe(true);
    expect(issues.map((i) => i.rule)).toContain("NEXT_ROUTE_NO_AUTH");
  });

  it("R1：路由内 getServerSession 认证调用保护不报", () => {
    writeRoute("app/api/transfer/route.ts", AUTHED_ROUTE);
    const { issues } = analyzeNextApp(dir);
    expect(issues).toHaveLength(0);
  });

  it("R1：认证 middleware 全局保护不报", () => {
    writeRoute("app/api/transfer/route.ts", MUTATION_ROUTE);
    writeRoute("middleware.ts", AUTH_MIDDLEWARE);
    const mw = readNextMiddleware(dir);
    const { issues } = analyzeNextApp(dir, mw);
    expect(issues).toHaveLength(0);
  });

  it("R1：GET 导出不报（公开读）", () => {
    writeRoute("app/api/articles/route.ts", `export async function GET() { return Response.json([]); }`);
    const { issues } = analyzeNextApp(dir);
    expect(issues).toHaveLength(0);
  });

  it("R1 豁免：login/auth 认证入口路径不报", () => {
    writeRoute("app/api/auth/login/route.ts", MUTATION_ROUTE);
    const { issues } = analyzeNextApp(dir);
    expect(issues).toHaveLength(0);
  });

  it("pages/api 旧式路由同样覆盖", () => {
    writeRoute("pages/api/transfer.ts", `export default function handler(req, res) { res.json({ok:true}); }`);
    // 无 export function POST 的旧式 handler 不识别方法 → 无 flag（口径如实）
    writeRoute("pages/api/transfer2.ts", `export default async function POST(req: Request) { return Response.json({}); }`);
    const { hasNext, issues } = analyzeNextApp(dir);
    expect(hasNext).toBe(true);
    // transfer2 无 POST 导出匹配（default 导出非具名）——旧式页路由方法不可静态区分，如实
    expect(issues).toHaveLength(0);
  });

  it("无 Next.js 结构的目录不产生问题", () => {
    const { hasNext, issues } = analyzeNextApp(dir);
    expect(hasNext).toBe(false);
    expect(issues).toHaveLength(0);
  });

  it("V5 修复回归：Stripe webhook 签名校验（constructEvent）视为端点认证——不报", () => {
    writeRoute("app/api/webhooks/stripe/route.ts", `
import { stripe } from "@/lib/stripe";
export async function POST(req: Request) {
  const body = await req.text();
  const signature = req.headers.get("stripe-signature") as string;
  const event = stripe.webhooks.constructEvent(body, signature, process.env.SECRET!);
  return Response.json({ received: true });
}
`);
    const { issues } = analyzeNextApp(dir);
    expect(issues).toHaveLength(0);
  });

  it("V5 修复回归：webhook 无签名校验仍报（保留对真缺失认证的敏感性）", () => {
    writeRoute("app/api/webhooks/stripe/route.ts", `
export async function POST(req: Request) {
  const body = await req.text();
  return Response.json({ received: true });
}
`);
    const { issues } = analyzeNextApp(dir);
    expect(issues.map((i) => i.rule)).toContain("NEXT_ROUTE_NO_AUTH");
  });

  it("V5 修复回归：next-auth v5 / clerk 裸 auth() 调用视为认证——不报", () => {
    writeRoute("app/api/transfer/route.ts", `
import { auth } from "@/auth";
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return new Response(null, { status: 403 });
  return Response.json({ ok: true });
}
`);
    const { issues } = analyzeNextApp(dir);
    expect(issues).toHaveLength(0);
  });
});
