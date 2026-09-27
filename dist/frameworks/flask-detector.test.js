"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * flask-detector.test.ts — Flask 框架适配器规则回归（纯函数，无文件 I/O）
 */
const vitest_1 = require("vitest");
const flask_detector_1 = require("./flask-detector");
function structure(partial) {
    return {
        hasFlask: true,
        apps: ["app"],
        blueprints: [],
        routes: [],
        beforeRequestAuth: [],
        filesScanned: 1,
        ...partial,
    };
}
const route = (p) => ({
    methods: p.methods,
    path: p.path || "",
    handler: p.handler,
    file: "app.py",
    line: 1,
    target: "app",
    authDecorators: p.authDecorators || [],
});
(0, vitest_1.describe)("flask-detector", () => {
    (0, vitest_1.it)("R1：无保护 mutation 路由 → FLASK_ROUTE_NO_AUTH", () => {
        const { issues } = (0, flask_detector_1.analyzeFlaskStructure)(structure({
            routes: [route({ methods: ["POST"], handler: "transfer_money" })],
        }));
        (0, vitest_1.expect)(issues.map((i) => i.rule)).toContain("FLASK_ROUTE_NO_AUTH");
    });
    (0, vitest_1.it)("R1：@login_required 保护不报", () => {
        const { issues } = (0, flask_detector_1.analyzeFlaskStructure)(structure({
            routes: [route({
                    methods: ["POST"], handler: "transfer_money",
                    authDecorators: ["login_required"],
                })],
        }));
        (0, vitest_1.expect)(issues).toHaveLength(0);
    });
    (0, vitest_1.it)("R1：before_request 认证守卫存在时不报（全局保护）", () => {
        const { issues } = (0, flask_detector_1.analyzeFlaskStructure)(structure({
            beforeRequestAuth: ["authenticate"],
            routes: [route({ methods: ["POST"], handler: "transfer_money" })],
        }));
        (0, vitest_1.expect)(issues).toHaveLength(0);
    });
    (0, vitest_1.it)("R1：缺省 methods 的 GET 路由不报（Flask 缺省=GET only）", () => {
        const { issues } = (0, flask_detector_1.analyzeFlaskStructure)(structure({
            routes: [route({ methods: ["GET"], handler: "home" })],
        }));
        (0, vitest_1.expect)(issues).toHaveLength(0);
    });
    (0, vitest_1.it)("R1 豁免：login/regist 认证入口端点不报", () => {
        const { issues } = (0, flask_detector_1.analyzeFlaskStructure)(structure({
            routes: [
                route({ methods: ["POST"], path: "/login", handler: "login" }),
                route({ methods: ["POST"], path: "/register", handler: "register_user" }),
            ],
        }));
        (0, vitest_1.expect)(issues).toHaveLength(0);
    });
    (0, vitest_1.it)("非 Flask 结构不产生任何问题", () => {
        const { hasFlask, issues } = (0, flask_detector_1.analyzeFlaskStructure)(structure({ hasFlask: false, routes: [] }));
        (0, vitest_1.expect)(hasFlask).toBe(false);
        (0, vitest_1.expect)(issues).toHaveLength(0);
    });
});
