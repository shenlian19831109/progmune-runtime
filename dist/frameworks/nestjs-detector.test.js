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
 * nestjs-detector.test.ts — NestJS 补全轮回归（文件系统夹具，临时目录）
 *
 * 锁定三缺口修复：全局 APP_GUARD 识别、@Public 豁免、守卫名认证分类
 * （ThrottlerGuard ≠ 认证）。
 */
const vitest_1 = require("vitest");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const nestjs_detector_1 = require("./nestjs-detector");
let dir;
(0, vitest_1.beforeEach)(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "nestjs-det-"));
});
(0, vitest_1.afterEach)(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});
function write(rel, content) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
}
const TSCONFIG = `{
  "compilerOptions": { "target": "ES2020", "module": "commonjs",
    "experimentalDecorators": true, "strict": false, "skipLibCheck": true },
  "include": ["src/**/*"]
}`;
const GUARD = `
import { CanActivate } from "@nestjs/common";
export class AuthGuard implements CanActivate { canActivate(): boolean { return true; } }
`;
const CONTROLLER_BARE = `
import { Controller, Post, Get } from "@nestjs/common";

@Controller("api")
export class ApiController {
  @Post("transfer")
  transfer() { return "done"; }
}
`;
const MODULE_GLOBAL_GUARD = `
import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthGuard } from "./auth.guard";

@Module({ providers: [{ provide: APP_GUARD, useClass: AuthGuard }] })
export class AppModule {}
`;
const MODULE_EMPTY = `
import { Module } from "@nestjs/common";
@Module({ providers: [] })
export class AppModule {}
`;
(0, vitest_1.describe)("nestjs-detector 补全", () => {
    (0, vitest_1.it)("全局 APP_GUARD：无类/方法守卫的 mutation 路由不报 NO_AUTH", () => {
        write("tsconfig.json", TSCONFIG);
        write("src/auth.guard.ts", GUARD);
        write("src/api.controller.ts", CONTROLLER_BARE);
        write("src/app.module.ts", MODULE_GLOBAL_GUARD);
        const { globalAuthGuards, issues } = (0, nestjs_detector_1.analyzeNestJSProject)(dir);
        (0, vitest_1.expect)(globalAuthGuards).toContain("AuthGuard");
        (0, vitest_1.expect)(issues.map((i) => i.type)).not.toContain("NESTJS_NO_AUTH");
    });
    (0, vitest_1.it)("@Public 绕过全局守卫 → NESTJS_NO_AUTH（显式绕过检出）", () => {
        write("tsconfig.json", TSCONFIG);
        write("src/auth.guard.ts", GUARD);
        write("src/api.controller.ts", CONTROLLER_BARE.replace('@Post("transfer")', '@Public()\n  @Post("transfer")'));
        write("src/app.module.ts", MODULE_GLOBAL_GUARD);
        const { issues } = (0, nestjs_detector_1.analyzeNestJSProject)(dir);
        (0, vitest_1.expect)(issues.map((i) => i.type)).toContain("NESTJS_NO_AUTH");
    });
    (0, vitest_1.it)("ThrottlerGuard 不是认证守卫 → 仍报 NESTJS_NO_AUTH", () => {
        write("tsconfig.json", TSCONFIG);
        write("src/auth.guard.ts", GUARD);
        write("src/api.controller.ts", CONTROLLER_BARE.replace('@Post("transfer")', '@UseGuards(ThrottlerGuard)\n  @Post("transfer")').replace('import { Controller, Post, Get } from "@nestjs/common";', 'import { Controller, Post, Get, UseGuards } from "@nestjs/common";\nimport { ThrottlerGuard } from "@nestjs/throttler";'));
        write("src/app.module.ts", MODULE_EMPTY);
        const { issues } = (0, nestjs_detector_1.analyzeNestJSProject)(dir);
        (0, vitest_1.expect)(issues.map((i) => i.type)).toContain("NESTJS_NO_AUTH");
    });
    (0, vitest_1.it)("无任何守卫且无全局守卫 → NESTJS_NO_AUTH", () => {
        write("tsconfig.json", TSCONFIG);
        write("src/auth.guard.ts", GUARD);
        write("src/api.controller.ts", CONTROLLER_BARE);
        write("src/app.module.ts", MODULE_EMPTY);
        const { issues } = (0, nestjs_detector_1.analyzeNestJSProject)(dir);
        (0, vitest_1.expect)(issues.map((i) => i.type)).toContain("NESTJS_NO_AUTH");
    });
    (0, vitest_1.it)("类级 AuthGuard 保护 → 不报 NESTJS_NO_AUTH", () => {
        write("tsconfig.json", TSCONFIG);
        write("src/auth.guard.ts", GUARD);
        write("src/api.controller.ts", CONTROLLER_BARE.replace('@Controller("api")', '@Controller("api")\n@UseGuards(AuthGuard)').replace('import { Controller, Post, Get } from "@nestjs/common";', 'import { Controller, Post, Get, UseGuards } from "@nestjs/common";\nimport { AuthGuard } from "./auth.guard";'));
        write("src/app.module.ts", MODULE_EMPTY);
        const { issues } = (0, nestjs_detector_1.analyzeNestJSProject)(dir);
        (0, vitest_1.expect)(issues.map((i) => i.type)).not.toContain("NESTJS_NO_AUTH");
    });
    (0, vitest_1.it)("@Public 登录入口在全局守卫下不报", () => {
        write("tsconfig.json", TSCONFIG);
        write("src/auth.guard.ts", GUARD);
        write("src/api.controller.ts", CONTROLLER_BARE.replace('@Post("transfer")', '@Public()\n  @Post("login")').replace('transfer() { return "done"; }', 'login() { return "token"; }'));
        write("src/app.module.ts", MODULE_GLOBAL_GUARD);
        const { issues } = (0, nestjs_detector_1.analyzeNestJSProject)(dir);
        (0, vitest_1.expect)(issues.map((i) => i.type)).not.toContain("NESTJS_NO_AUTH");
    });
});
(0, vitest_1.describe)("nestjs-detector 模块中间件覆盖（V1 修复回归）", () => {
    (0, vitest_1.it)("NestModule configure/forRoutes 保护的 mutation 不报（Nest 5 惯用法）", () => {
        write("tsconfig.json", TSCONFIG);
        write("src/app.module.ts", `
import { Module, NestModule, MiddlewareConsumer, RequestMethod } from "@nestjs/common";
import { AuthMiddleware } from "./auth.middleware";
import { ApiController } from "./api.controller";

@Module({ controllers: [ApiController] })
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AuthMiddleware)
      .forRoutes(
        { path: "api/transfer", method: RequestMethod.POST },
        { path: "api/items/:id", method: RequestMethod.ALL },
      );
  }
}
`);
        write("src/api.controller.ts", `
import { Controller, Post, Delete, Get } from "@nestjs/common";
@Controller("api")
export class ApiController {
  @Post("transfer") transfer() { return {}; }
  @Delete("items/:id") deleteItem() { return {}; }
  @Post("public") publicCreate() { return {}; }
}
`);
        write("src/auth.middleware.ts", `
import { NestMiddleware } from "@nestjs/common";
export class AuthMiddleware implements NestMiddleware { use() {} }
`);
        const a = (0, nestjs_detector_1.analyzeNestJSProject)(dir);
        const noAuth = a.issues.filter((i) => i.type === "NESTJS_NO_AUTH");
        // transfer 与 items/:id 受 forRoutes 中间件保护 → 不报
        (0, vitest_1.expect)(noAuth.map((i) => i.route)).not.toContain("POST api/transfer");
        (0, vitest_1.expect)(noAuth.map((i) => i.route)).not.toContain("DELETE api/items/:id");
        // 未覆盖的 public 写路由仍报（保留敏感性）
        (0, vitest_1.expect)(noAuth.map((i) => i.route)).toContain("POST api/public");
    });
    (0, vitest_1.it)("摘除 forRoutes 中间件覆盖后 mutation 重新被报（无感修复回归）", () => {
        write("tsconfig.json", TSCONFIG);
        write("src/app.module.ts", `
import { Module, NestModule, MiddlewareConsumer, RequestMethod } from "@nestjs/common";
import { ApiController } from "./api.controller";
@Module({ controllers: [ApiController] })
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthMiddleware).forRoutes(); // 覆盖被摘空
  }
}
`);
        write("src/api.controller.ts", `
import { Controller, Post } from "@nestjs/common";
@Controller("api")
export class ApiController {
  @Post("transfer") transfer() { return {}; }
}
`);
        write("src/auth.middleware.ts", `
import { NestMiddleware } from "@nestjs/common";
export class AuthMiddleware implements NestMiddleware { use() {} }
`);
        const a = (0, nestjs_detector_1.analyzeNestJSProject)(dir);
        (0, vitest_1.expect)(a.issues.some((i) => i.type === "NESTJS_NO_AUTH" && i.route === "POST api/transfer")).toBe(true);
    });
});
(0, vitest_1.describe)("nestjs-detector register 集合豁免（语义层）", () => {
    function writeUserApp() {
        write("tsconfig.json", TSCONFIG);
        write("src/user.controller.ts", `
import { Controller, Post, Get, Delete } from "@nestjs/common";
@Controller()
export class UserController {
  @Post("users/login") login() { return {}; }
  @Post("users") register() { return {}; }            // 公开注册
  @Delete("users/:slug") deleteUser() { return {}; }  // 真实无保护
}
`);
    }
    (0, vitest_1.it)("有 users/login 姊妹佐证：POST users（公开注册）不报", () => {
        writeUserApp();
        const a = (0, nestjs_detector_1.analyzeNestJSProject)(dir);
        const noAuth = a.issues.filter((i) => i.type === "NESTJS_NO_AUTH");
        (0, vitest_1.expect)(noAuth.map((i) => i.route)).not.toContain("POST /users");
        (0, vitest_1.expect)(noAuth.map((i) => i.route)).not.toContain("POST /users/login");
        // 真实无保护的 DELETE 仍报（豁免不误伤）
        (0, vitest_1.expect)(noAuth.map((i) => i.route)).toContain("DELETE /users/:slug");
    });
    (0, vitest_1.it)("无姊妹佐证：POST users 仍报（管理员建用户不豁免）", () => {
        write("tsconfig.json", TSCONFIG);
        write("src/admin.controller.ts", `
import { Controller, Post } from "@nestjs/common";
@Controller()
export class AdminController {
  @Post("users") adminCreateUser() { return {}; }
}
`);
        const a = (0, nestjs_detector_1.analyzeNestJSProject)(dir);
        (0, vitest_1.expect)(a.issues.some((i) => i.type === "NESTJS_NO_AUTH" && i.route === "POST /users")).toBe(true);
    });
});
