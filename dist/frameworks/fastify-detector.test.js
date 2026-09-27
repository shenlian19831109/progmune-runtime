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
 * fastify-detector.test.ts — Fastify 框架适配器规则回归（纯函数，无文件 I/O）
 *
 * 代码串级分析（镜像 express-detector）：路由注册 + preHandler/preValidation
 * 认证选项 + addHook 认证钩子。
 */
const vitest_1 = require("vitest");
const fastify_detector_1 = require("./fastify-detector");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const app = (routes, hooks = "") => `
import Fastify from "fastify";
const fastify = Fastify();
${routes}
${hooks}
`;
(0, vitest_1.describe)("fastify-detector", () => {
    (0, vitest_1.it)("R1：无保护 mutation 路由 → FASTIFY_ROUTE_NO_AUTH", () => {
        const { issues } = (0, fastify_detector_1.analyzeFastifyApp)(app(`
fastify.post("/transfer", async (req, reply) => ({ ok: true }));
`));
        (0, vitest_1.expect)(issues.map((i) => i.rule)).toContain("FASTIFY_ROUTE_NO_AUTH");
    });
    (0, vitest_1.it)("R1：preHandler 认证选项保护不报", () => {
        const { issues } = (0, fastify_detector_1.analyzeFastifyApp)(app(`
fastify.post("/transfer", { preHandler: [authenticate] }, async (req, reply) => ({ ok: true }));
`));
        (0, vitest_1.expect)(issues).toHaveLength(0);
    });
    (0, vitest_1.it)("R1：preValidation 认证选项保护不报", () => {
        const { issues } = (0, fastify_detector_1.analyzeFastifyApp)(app(`
fastify.put("/update", { preValidation: [checkToken] }, async (req, reply) => ({ ok: true }));
`));
        (0, vitest_1.expect)(issues).toHaveLength(0);
    });
    (0, vitest_1.it)("R1：addHook 认证钩子全局保护不报", () => {
        const { issues } = (0, fastify_detector_1.analyzeFastifyApp)(app(`fastify.post("/transfer", async (req, reply) => ({ ok: true }));`, `fastify.addHook("preHandler", authenticate);`));
        (0, vitest_1.expect)(issues).toHaveLength(0);
    });
    (0, vitest_1.it)("R1：非认证 addHook（如日志）不视为保护", () => {
        const { issues } = (0, fastify_detector_1.analyzeFastifyApp)(app(`fastify.post("/transfer", async (req, reply) => ({ ok: true }));`, `fastify.addHook("onRequest", logRequest);`));
        (0, vitest_1.expect)(issues.map((i) => i.rule)).toContain("FASTIFY_ROUTE_NO_AUTH");
    });
    (0, vitest_1.it)("R1：GET 读操作不报", () => {
        const { issues } = (0, fastify_detector_1.analyzeFastifyApp)(app(`
fastify.get("/articles", async (req, reply) => ({ items: [] }));
`));
        (0, vitest_1.expect)(issues).toHaveLength(0);
    });
    (0, vitest_1.it)("R1 豁免：login/regist/token 认证入口路径不报", () => {
        const { issues } = (0, fastify_detector_1.analyzeFastifyApp)(app(`
fastify.post("/login", async (req, reply) => ({ token: "t" }));
fastify.post("/register", async (req, reply) => ({ ok: true }));
`));
        (0, vitest_1.expect)(issues).toHaveLength(0);
    });
    (0, vitest_1.it)("非 Fastify 代码不产生任何问题", () => {
        const { hasFastify, issues } = (0, fastify_detector_1.analyzeFastifyApp)(`import express from "express"; const app = express(); app.post("/x", h);`);
        (0, vitest_1.expect)(hasFastify).toBe(false);
        (0, vitest_1.expect)(issues).toHaveLength(0);
    });
});
// ── V2 结构性重写回归：object-form / onRequest / plugin 门 / register 豁免 ──
(0, vitest_1.describe)("fastify-detector object-form 路由（V2 修复回归）", () => {
    (0, vitest_1.it)("server.route({method,path,onRequest:[server.authenticate]}) 受保护不报", () => {
        const { issues, routes } = (0, fastify_detector_1.analyzeFastifyApp)(app(`
server.route({
  method: 'POST',
  path: options.prefix + 'articles',
  onRequest: [server.authenticate],
  handler: onCreate
});
`));
        (0, vitest_1.expect)(routes.find((r) => r.path === "articles").protected).toBe(true);
        (0, vitest_1.expect)(issues).toHaveLength(0);
    });
    (0, vitest_1.it)("object-form 无认证 mutation → 报", () => {
        const { issues } = (0, fastify_detector_1.analyzeFastifyApp)(app(`
server.route({
  method: 'POST',
  path: options.prefix + 'payments',
  handler: onPay
});
`));
        (0, vitest_1.expect)(issues.map((i) => i.route)).toContain("POST payments");
    });
    (0, vitest_1.it)("点限定 server.authenticate 在 onRequest 数组被识别（词表含 auth）", () => {
        const { routes } = (0, fastify_detector_1.analyzeFastifyApp)(app(`
server.route({ method: 'DELETE', path: 'x', onRequest: [server.authenticate], handler: h });
`));
        (0, vitest_1.expect)(routes[0].protected).toBe(true);
    });
    (0, vitest_1.it)("register 集合豁免：POST users（有 users/login 姊妹）不报", () => {
        const { issues } = (0, fastify_detector_1.analyzeFastifyApp)(app(`
server.route({ method: 'POST', path: options.prefix + 'users/login', handler: onLogin });
server.route({ method: 'POST', path: options.prefix + 'users', handler: onRegister });
`));
        (0, vitest_1.expect)(issues.map((i) => i.route)).not.toContain("POST users");
        (0, vitest_1.expect)(issues.map((i) => i.route)).not.toContain("POST users/login");
    });
});
(0, vitest_1.describe)("fastify-detector plugin 门（V2 修复回归）", () => {
    (0, vitest_1.it)("fastify-plugin 模块（fp(plugin) 路由文件）现可被分析", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fastify-det-"));
        try {
            const fp = path.join(dir, "routes-users.js");
            fs.writeFileSync(fp, `
const fp = require('fastify-plugin')
async function users (server, options, done) {
  server.route({ method: 'POST', path: 'articles', onRequest: [server.authenticate], handler: h })
  server.route({ method: 'POST', path: 'open', handler: h })
}
module.exports = fp(users)
`);
            const a = (0, fastify_detector_1.analyzeFastifyFile)(fp);
            (0, vitest_1.expect)(a).not.toBeNull();
            (0, vitest_1.expect)(a.routes.length).toBe(2);
            (0, vitest_1.expect)(a.issues.map((i) => i.route)).toContain("POST open");
            (0, vitest_1.expect)(a.issues.map((i) => i.route)).not.toContain("POST articles");
        }
        finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
