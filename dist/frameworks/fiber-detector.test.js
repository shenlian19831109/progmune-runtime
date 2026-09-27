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
 * fiber-detector.test.ts — Fiber 框架适配器规则回归（纯函数，无文件 I/O）
 */
const vitest_1 = require("vitest");
const fiber_detector_1 = require("./fiber-detector");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const app = (routes, extra = "") => `
import "github.com/gofiber/fiber/v2"

func main() {
	app := fiber.New()
	${extra}
	${routes}
}
`;
(0, vitest_1.describe)("fiber-detector", () => {
    (0, vitest_1.it)("R1：无认证中间件的 mutation 路由 → FIBER_ROUTE_NO_AUTH", () => {
        const { issues } = (0, fiber_detector_1.analyzeFiberApp)(app(`
	app.Post("/transfer", func(c *fiber.Ctx) error { return nil })
`));
        (0, vitest_1.expect)(issues.map((i) => i.rule)).toContain("FIBER_ROUTE_NO_AUTH");
    });
    (0, vitest_1.it)("R1：路由级认证中间件保护不报", () => {
        const { issues } = (0, fiber_detector_1.analyzeFiberApp)(app(`
	app.Post("/transfer", authMiddleware, func(c *fiber.Ctx) error { return nil })
`));
        (0, vitest_1.expect)(issues).toHaveLength(0);
    });
    (0, vitest_1.it)("R1：全局 Use 认证中间件保护不报", () => {
        const { issues } = (0, fiber_detector_1.analyzeFiberApp)(app(`app.Post("/transfer", func(c *fiber.Ctx) error { return nil })`, `app.Use(authMiddleware)`));
        (0, vitest_1.expect)(issues).toHaveLength(0);
    });
    (0, vitest_1.it)("R1：非认证中间件不视为保护", () => {
        const { issues } = (0, fiber_detector_1.analyzeFiberApp)(app(`
	app.Post("/transfer", logger, func(c *fiber.Ctx) error { return nil })
`));
        (0, vitest_1.expect)(issues.map((i) => i.rule)).toContain("FIBER_ROUTE_NO_AUTH");
    });
    (0, vitest_1.it)("R1：GET 读操作不报", () => {
        const { issues } = (0, fiber_detector_1.analyzeFiberApp)(app(`
	app.Get("/articles", func(c *fiber.Ctx) error { return nil })
`));
        (0, vitest_1.expect)(issues).toHaveLength(0);
    });
    (0, vitest_1.it)("R1 豁免：login 认证入口路径不报", () => {
        const { issues } = (0, fiber_detector_1.analyzeFiberApp)(app(`
	app.Post("/login", func(c *fiber.Ctx) error { return nil })
`));
        (0, vitest_1.expect)(issues).toHaveLength(0);
    });
    (0, vitest_1.it)("非 Fiber 代码不产生任何问题", () => {
        const { hasFiber, issues } = (0, fiber_detector_1.analyzeFiberApp)(`import express from "express";`);
        (0, vitest_1.expect)(hasFiber).toBe(false);
        (0, vitest_1.expect)(issues).toHaveLength(0);
    });
});
// ── V8 修复轮回归：窗口边界（单点摘保护不再被后续路由掩盖）──
(0, vitest_1.describe)("fiber-detector V8 修复回归", () => {
    (0, vitest_1.it)("窗口不跨路由串扰：下一路由的 Protected 不掩盖上一路由摘保护", () => {
        const { issues, routes } = (0, fiber_detector_1.analyzeFiberApp)(app(`
	api.Post("/logout", logoutHandler)
	api.Post("/refresh-token", middleware.Protected(), refreshHandler)
`));
        const logout = routes.find((x) => x.path === "/logout");
        const refresh = routes.find((x) => x.path === "/refresh-token");
        (0, vitest_1.expect)(logout.protected).toBe(false);
        (0, vitest_1.expect)(refresh.protected).toBe(true);
        (0, vitest_1.expect)(issues.map((i) => i.route)).toContain("POST /logout");
        (0, vitest_1.expect)(issues.map((i) => i.route)).not.toContain("POST /refresh-token");
    });
    (0, vitest_1.it)("handler 名含 auth 词不误判（logoutHandler 不被当认证）", () => {
        const { routes } = (0, fiber_detector_1.analyzeFiberApp)(app(`
	api.Post("/logout", authHandler.Logout)
`));
        (0, vitest_1.expect)(routes.find((x) => x.path === "/logout").protected).toBe(false);
    });
});
// ── Fiber 组认证跨文件传播（gin 同款模型移植）──
const FBOOT = `package main
import "github.com/gofiber/fiber/v2"
func main() {
	app := fiber.New()
	api := app.Group("/api")
	users.UsersRegister(api.Group("/users"))
	api.Use(middleware.Protected())
	users.UserRegister(api.Group("/user"))
	articles.ArticlesRegister(api.Group("/articles"))
}
`;
const FROUTERS = `package users
import "github.com/gofiber/fiber/v2"
func UsersRegister(router fiber.Router) {
	router.Post("/login", UsersLogin)
	router.Post("", UsersRegistration)
}
func UserRegister(router fiber.Router) {
	router.Put("", UserUpdate)
}
`;
(0, vitest_1.describe)("fiberProtectedRegisterFns 组认证相位", () => {
    (0, vitest_1.it)("Use 之后的 Register 受保护，Use 之前的公开", () => {
        const p = (0, fiber_detector_1.fiberProtectedRegisterFns)(FBOOT);
        (0, vitest_1.expect)(p.get("UserRegister")).toBe(true);
        (0, vitest_1.expect)(p.get("ArticlesRegister")).toBe(true);
        (0, vitest_1.expect)(p.get("UsersRegister")).toBeUndefined();
    });
});
(0, vitest_1.describe)("fiberEnclosingFunc 归属", () => {
    (0, vitest_1.it)("按 func 头行号归属", () => {
        // FROUTERS：1 package / 2 import / 3 func UsersRegister / 6 func UserRegister
        (0, vitest_1.expect)((0, fiber_detector_1.fiberEnclosingFunc)(FROUTERS, 4)).toBe("UsersRegister");
        (0, vitest_1.expect)((0, fiber_detector_1.fiberEnclosingFunc)(FROUTERS, 7)).toBe("UserRegister");
    });
});
(0, vitest_1.describe)("analyzeFiberProject 跨文件传播", () => {
    function makeProject(withUse) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fiber-proj-"));
        const boot = withUse ? FBOOT : FBOOT.replace(/\s*api\.Use\(middleware\.Protected\(\)\)\n/, "");
        fs.writeFileSync(path.join(dir, "main.go"), boot);
        fs.writeFileSync(path.join(dir, "routers.go"), FROUTERS);
        return dir;
    }
    (0, vitest_1.it)("Use 保护下跨文件 mutation 不报", () => {
        const dir = makeProject(true);
        try {
            const a = (0, fiber_detector_1.analyzeFiberProject)(dir);
            (0, vitest_1.expect)(a.issues.filter((i) => i.rule === "FIBER_ROUTE_NO_AUTH")).toHaveLength(0);
        }
        finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
    (0, vitest_1.it)("删 Use → mutation 重现（敏感性保留）", () => {
        const dir = makeProject(false);
        try {
            const a = (0, fiber_detector_1.analyzeFiberProject)(dir);
            const routes = a.issues.filter((i) => i.rule === "FIBER_ROUTE_NO_AUTH").map((i) => i.route);
            (0, vitest_1.expect)(routes).toContain("PUT "); // UserRegister mutation 重现
            // POST "" 是 register（/login 姊妹佐证豁免，公开）——不报正确
        }
        finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
// ── 多层 Register 链（journalist 式 main→api(Group+Use)→v1→模块）──
function makeNestedProject(withUse) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fiber-nest-"));
    const mk = (rel, content) => {
        const fp = path.join(dir, rel);
        fs.mkdirSync(path.dirname(fp), { recursive: true });
        fs.writeFileSync(fp, content);
    };
    mk("main/main.go", `package main
import "github.com/gofiber/fiber/v2"
func main() {
	app := fiber.New()
	api.Register(app)
}
`);
    mk("api/api.go", `package api
import "github.com/gofiber/fiber/v2"
func Register(fiberApp *fiber.App) {
	api := fiberApp.Group("/api")
${withUse ? "\tapi.Use(middleware.Protected())\n" : ""}\tv1.Register(&api)
}
`);
    mk("v1/v1.go", `package v1
import "github.com/gofiber/fiber/v2"
func Register(router *fiber.Router) {
	feeds.Register(router)
}
`);
    mk("feeds/feeds.go", `package feeds
import "github.com/gofiber/fiber/v2"
func Register(router *fiber.Router) {
	router.Post("/", CreateFeed)
	router.Put("/:id", UpdateFeed)
}
`);
    return dir;
}
(0, vitest_1.describe)("analyzeFiberProject 多层 Register 链（journalist 式）", () => {
    (0, vitest_1.it)("api(Group+Use)→v1→feeds 链：跨层 mutation 不报", () => {
        const dir = makeNestedProject(true);
        try {
            const a = (0, fiber_detector_1.analyzeFiberProject)(dir);
            (0, vitest_1.expect)(a.issues.filter((i) => i.rule === "FIBER_ROUTE_NO_AUTH")).toHaveLength(0);
            (0, vitest_1.expect)(a.protectedFunctions).toContain("feeds:Register");
            (0, vitest_1.expect)(a.protectedFunctions).toContain("v1:Register");
        }
        finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
    (0, vitest_1.it)("删中间层 api.Use → feeds mutation 重现（敏感性穿透多层）", () => {
        const dir = makeNestedProject(false);
        try {
            const a = (0, fiber_detector_1.analyzeFiberProject)(dir);
            const routes = a.issues.filter((i) => i.rule === "FIBER_ROUTE_NO_AUTH").map((i) => i.route);
            (0, vitest_1.expect)(routes).toContain("POST /");
            (0, vitest_1.expect)(routes).toContain("PUT /:id");
        }
        finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
