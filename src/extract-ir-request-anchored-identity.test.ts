/**
 * fr-017 定向回归：授权身份锚点取自请求输入
 * （REALWORLD_FIX_REGRESSION fr-017，tinacms GHSA-g74q-6g2f-874x）
 *
 * 判据在 extract-ir.ts 的 hasRequestAnchoredIdentity（三元组）：
 * ① 从请求取 token（req.headers.authorization / headers().get('authorization')）
 * ② 从请求输入取身份锚点（req.query|body|params.<clientID|clientId|appId…>
 *    或 searchParams.get('<锚点名>')）
 * ③ 无服务端锚点证据（process.env. / getConfig( / config.）
 * 三条件同时成立才注入 __progmune_request_anchored_identity__ 标记。
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { extractIR } from "./extract-ir";
import { detectSafeguardViolations } from "./protocol-detector";

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    target: "ES2020",
    module: "commonjs",
    moduleResolution: "node",
    strict: false,
    skipLibCheck: true,
    noEmit: true,
  },
  include: ["**/*.ts"],
});

function makeProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-fr017-"));
  fs.writeFileSync(path.join(dir, "tsconfig.json"), TSCONFIG);
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "fixture", version: "0.0.0", private: true })
  );
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return dir;
}

const MARKER = "__progmune_request_anchored_identity__";

describe("fr-017 request-anchored identity（提取器标记）", () => {
  it("修复前形态：req.query.clientID 锚点 + authorization header → 注入标记", () => {
    const dir = makeProject({
      "index.ts": `
export const isAuthorized = async (req: any): Promise<any> => {
  const clientID = req.query.clientID;
  const token = req.headers.authorization;
  if (typeof clientID === 'string' && typeof token === 'string') {
    return await isUserAuthorized({ clientID, token });
  }
  return undefined;
};

async function isUserAuthorized(args: { clientID: string; token: string }) {
  return fetch("https://identity.example/verify", {
    headers: { authorization: args.token },
    body: JSON.stringify({ clientID: args.clientID }),
  });
}
`,
    });
    const ir = extractIR(dir);
    const fn = ir.find((f) => f.name === "isAuthorized");
    const callee = ir.find((f) => f.name === "isUserAuthorized");
    expect(fn).toBeDefined();
    expect(fn!.calls).toContain(MARKER);
    // 被调用方没有 req 形态，不误标
    expect(callee).toBeDefined();
    expect(callee!.calls).not.toContain(MARKER);
  });

  it("修复前形态（NextRequest）：searchParams.get('clientID') → 注入标记", () => {
    const dir = makeProject({
      "auth.ts": `
export const isAuthorized = async (req: Request): Promise<any> => {
  const clientID = new URL(req.url).searchParams.get('clientID');
  const token = (await headers()).get('authorization');
  if (typeof clientID === 'string' && typeof token === 'string') {
    return await isUserAuthorized({ clientID, token });
  }
  return undefined;
};

async function isUserAuthorized(args: { clientID: string; token: string }) {
  return fetch("https://identity.example/verify");
}
`,
    });
    const ir = extractIR(dir);
    const fn = ir.find((f) => f.name === "isAuthorized");
    expect(fn).toBeDefined();
    expect(fn!.calls).toContain(MARKER);
  });

  it("修复后形态：expectedClientID ?? process.env → 无标记", () => {
    const dir = makeProject({
      "index.ts": `
export const isAuthorized = async (req: any, expectedClientID?: string): Promise<any> => {
  const token = req.headers.authorization;
  const clientID = (expectedClientID ?? process.env.NEXT_PUBLIC_TINA_CLIENT_ID)?.trim();
  if (typeof clientID !== 'string' || clientID.length === 0) {
    console.error("isAuthorized could not resolve this site's clientID. Refusing to authorize.");
    return undefined;
  }
  if (typeof token !== 'string') return undefined;
  return await isUserAuthorized({ clientID, token });
};

async function isUserAuthorized(args: { clientID: string; token: string }) {
  return fetch("https://identity.example/verify");
}
`,
    });
    const ir = extractIR(dir);
    for (const f of ir) {
      expect(f.calls).not.toContain(MARKER);
    }
  });

  it("负例：OAuth token 端点（req.body.client_id，无 authorization header）→ 无标记", () => {
    const dir = makeProject({
      "token.ts": `
export const tokenEndpoint = async (req: any) => {
  const clientId = req.body.client_id;
  const clientSecret = req.body.client_secret;
  return await exchangeToken({ clientId, clientSecret });
};

async function exchangeToken(args: { clientId: string; clientSecret: string }) {
  return fetch("https://identity.example/token");
}
`,
    });
    const ir = extractIR(dir);
    for (const f of ir) {
      expect(f.calls).not.toContain(MARKER);
    }
  });

  it("负例：锚点有服务端绑定（getConfig）→ 无标记", () => {
    const dir = makeProject({
      "index.ts": `
export const isAuthorized = async (req: any): Promise<any> => {
  const token = req.headers.authorization;
  const clientID = req.query.clientID;
  const expected = getConfig("client-id", "CLIENT_ID");
  if (clientID !== expected) return undefined;
  return await isUserAuthorized({ clientID: expected, token });
};

async function isUserAuthorized(args: { clientID: string; token: string }) {
  return fetch("https://identity.example/verify");
}
`,
    });
    const ir = extractIR(dir);
    for (const f of ir) {
      expect(f.calls).not.toContain(MARKER);
    }
  });

  it("负例：tenantId 从请求解析（多租户合法形态）→ 无标记", () => {
    const dir = makeProject({
      "index.ts": `
export const isAuthorized = async (req: any): Promise<any> => {
  const tenantId = req.query.tenantId;
  const token = req.headers.authorization;
  return await verifyTenantToken({ tenantId, token });
};

async function verifyTenantToken(args: { tenantId: string; token: string }) {
  return fetch("https://identity.example/verify");
}
`,
    });
    const ir = extractIR(dir);
    for (const f of ir) {
      expect(f.calls).not.toContain(MARKER);
    }
  });
});

describe("fr-017 request-anchored identity（规则触发）", () => {
  it("TS 语言：标记命中 Authorization Identity Anchor from Request", () => {
    const svs = detectSafeguardViolations(
      [MARKER],
      "isAuthorized",
      "typescript",
      []
    );
    const hit = svs.find((v) => v.rule === "Authorization Identity Anchor from Request");
    expect(hit).toBeDefined();
  });

  it("python 语言：该规则不触发（languages 门）", () => {
    const svs = detectSafeguardViolations(
      [MARKER],
      "is_authorized",
      "python",
      []
    );
    const hit = svs.find((v) => v.rule === "Authorization Identity Anchor from Request");
    expect(hit).toBeUndefined();
  });
});
