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
// ═══════════════════════════════════════════════════════════
// 全局 ValidationPipe + DTO 校验识别（2026-09-29 docmost 实测：
// 123 条 NO_VALIDATION 失明误报的修复——路由 DTO 在别的文件带
// class-validator 装饰器，只看 @UsePipes 永远看不到）
// ═══════════════════════════════════════════════════════════
(0, vitest_1.describe)("nestjs-detector 全局管道 + DTO 校验通道", () => {
    function writeValidatedApp() {
        write("tsconfig.json", TSCONFIG);
        write("src/main.ts", `
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );
  await app.listen(3000);
}
`);
        write("src/app.module.ts", `
import { Module } from "@nestjs/common";
import { PageController } from "./page.controller";
@Module({ controllers: [PageController] })
export class AppModule {}
`);
        write("src/create-page.dto.ts", `
import { IsString, IsUUID, IsOptional } from "class-validator";
export class CreatePageDto {
  @IsOptional() @IsString() title?: string;
  @IsUUID() spaceId: string;
}
`);
        write("src/page.controller.ts", `
import { Controller, Post, Body } from "@nestjs/common";
import { CreatePageDto } from "./create-page.dto";
@Controller("pages")
export class PageController {
  @Post("create")
  create(@Body() dto: CreatePageDto) { return {}; }
}
`);
    }
    (0, vitest_1.it)("全局 ValidationPipe + 入参是已校验 DTO → 不报 NO_VALIDATION", () => {
        writeValidatedApp();
        const a = (0, nestjs_detector_1.analyzeNestJSProject)(dir);
        const nv = a.issues.filter((i) => i.type === "NESTJS_NO_VALIDATION");
        (0, vitest_1.expect)(nv).toEqual([]);
    });
    (0, vitest_1.it)("反向：DTO 摘掉 class-validator 装饰器 → 精确转红", () => {
        writeValidatedApp();
        write("src/create-page.dto.ts", `
export class CreatePageDto {
  title?: string;
  spaceId: string;
}
`);
        const a = (0, nestjs_detector_1.analyzeNestJSProject)(dir);
        (0, vitest_1.expect)(a.issues.some((i) => i.type === "NESTJS_NO_VALIDATION" && i.route === "POST pages/create")).toBe(true);
    });
    (0, vitest_1.it)("反向：摘掉全局管道 → 精确转红（无 @UsePipes 的路由失去豁免源）", () => {
        writeValidatedApp();
        write("src/main.ts", `
async function bootstrap() { await (await import("@nestjs/core").then(m => m.NestFactory.create(Object))).listen(3000); }
`);
        const a = (0, nestjs_detector_1.analyzeNestJSProject)(dir);
        (0, vitest_1.expect)(a.issues.some((i) => i.type === "NESTJS_NO_VALIDATION" && i.route === "POST pages/create")).toBe(true);
    });
    (0, vitest_1.it)("继承 DTO：子类 extends 已校验父类 → 不报（RemoveFavoriteDto 形态）", () => {
        writeValidatedApp();
        write("src/create-page.dto.ts", `
import { IsString, IsUUID, IsOptional } from "class-validator";
export class CreatePageDto {
  @IsOptional() @IsString() title?: string;
  @IsUUID() spaceId: string;
}
export class UpdatePageDto extends CreatePageDto {}
`);
        write("src/page.controller.ts", `
import { Controller, Post, Body } from "@nestjs/common";
import { UpdatePageDto } from "./create-page.dto";
@Controller("pages")
export class PageController {
  @Post("update")
  update(@Body() dto: UpdatePageDto) { return {}; }
}
`);
        const a = (0, nestjs_detector_1.analyzeNestJSProject)(dir);
        (0, vitest_1.expect)(a.issues.some((i) => i.type === "NESTJS_NO_VALIDATION" && i.route === "POST pages/update")).toBe(false);
    });
    (0, vitest_1.it)("无结构化输入（仅 AuthUser/Req）→ 不报 NO_VALIDATION（collab-token/logout 形态）", () => {
        write("tsconfig.json", TSCONFIG);
        write("src/main.ts", `
import { ValidationPipe } from "@nestjs/common";
async function bootstrap() { (globalThis as any).app.useGlobalPipes(new ValidationPipe()); }
`);
        write("src/app.module.ts", `
import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
@Module({ controllers: [AuthController] })
export class AppModule {}
`);
        write("src/auth.controller.ts", `
import { Controller, Post, Req } from "@nestjs/common";
@Controller("auth")
export class AuthController {
  @Post("logout")
  logout(@Req() req: any) { return {}; }
}
`);
        const a = (0, nestjs_detector_1.analyzeNestJSProject)(dir);
        (0, vitest_1.expect)(a.issues.some((i) => i.type === "NESTJS_NO_VALIDATION" && i.route === "POST auth/logout")).toBe(false);
    });
    (0, vitest_1.it)("Zod 形态：class XDto extends createZodDto(schema) + 辅助函数全局管道 → 不报（hedgedoc 形态）", () => {
        write("tsconfig.json", TSCONFIG);
        write("src/main.ts", `
import { setupValidationPipe } from "./setup-pipes";
async function bootstrap() { (globalThis as any).app.useGlobalPipes(setupValidationPipe()); }
`);
        write("src/setup-pipes.ts", `
import { createZodValidationPipe } from "nestjs-zod";
export function setupValidationPipe(): any { return new (createZodValidationPipe({}))(); }
`);
        write("src/app.module.ts", `
import { Module } from "@nestjs/common";
import { NotesController } from "./notes.controller";
@Module({ controllers: [NotesController] })
export class AppModule {}
`);
        write("src/login.dto.ts", `
import { createZodDto } from "nestjs-zod";
export class LoginDto extends createZodDto({}) {}
`);
        write("src/notes.controller.ts", `
import { Controller, Post, Body } from "@nestjs/common";
import { LoginDto } from "./login.dto";
@Controller("notes")
export class NotesController {
  @Post("create")
  create(@Body() dto: LoginDto) { return {}; }
}
`);
        const a = (0, nestjs_detector_1.analyzeNestJSProject)(dir);
        (0, vitest_1.expect)(a.issues.some((i) => i.type === "NESTJS_NO_VALIDATION" && i.route === "POST notes/create")).toBe(false);
    });
    (0, vitest_1.it)("反向：Zod DTO 摘掉 createZodDto 继承 → 精确转红", () => {
        write("tsconfig.json", TSCONFIG);
        write("src/main.ts", `
import { setupValidationPipe } from "./setup-pipes";
async function bootstrap() { (globalThis as any).app.useGlobalPipes(setupValidationPipe()); }
`);
        write("src/setup-pipes.ts", `
import { createZodValidationPipe } from "nestjs-zod";
export function setupValidationPipe(): any { return new (createZodValidationPipe({}))(); }
`);
        write("src/app.module.ts", `
import { Module } from "@nestjs/common";
import { NotesController } from "./notes.controller";
@Module({ controllers: [NotesController] })
export class AppModule {}
`);
        write("src/login.dto.ts", `
export class LoginDto {}
`);
        write("src/notes.controller.ts", `
import { Controller, Post, Body } from "@nestjs/common";
import { LoginDto } from "./login.dto";
@Controller("notes")
export class NotesController {
  @Post("create")
  create(@Body() dto: LoginDto) { return {}; }
}
`);
        const a = (0, nestjs_detector_1.analyzeNestJSProject)(dir);
        (0, vitest_1.expect)(a.issues.some((i) => i.type === "NESTJS_NO_VALIDATION" && i.route === "POST notes/create")).toBe(true);
    });
});
// ═══════════════════════════════════════════════════════════
// §52（2026-10-03）：app-level provider 注册事件
//
// immich held-out 实测倒在了第三种注册途径上：
//   const commonMiddleware = [{ provide: APP_PIPE, useClass: ZodValidationPipe }, ...];
//   const apiMiddleware = [FileUploadInterceptor, ...commonMiddleware, {...}];
//   @Module({ providers: [...common, ...apiMiddleware, ...] })
// `APP_PIPE` 与 `@Module` 之间隔了**两跳数组 spread**，只看装饰器那一层永远
// 看不到 ⇒ 153 条 NO_VALIDATION 误报。修复原则是「注册事件」而非「写法」：
// 哪里有注册意图，哪里就是证据，不再要求它必须直连某个 @Module。
//
// 同组反向测试是硬要求（R75）：压制放宽后必须证明「该报的还在报」。
// ═══════════════════════════════════════════════════════════
(0, vitest_1.describe)("nestjs-detector app-level provider 注册事件（§52）", () => {
    const ZOD_STUB = `
export function createZodDto(schema: any): any { return class {} as any; }
export const CreateAlbumSchema = { albumName: "string" };
export class CreateAlbumDto extends createZodDto(CreateAlbumSchema) {}
export class PlainAlbumDto { albumName: string = ""; }
`;
    const ALBUM_CONTROLLER = `
import { Body, Controller, Post } from "@nestjs/common";
import { CreateAlbumDto } from "./album.dto";
@Controller("albums")
export class AlbumController {
  @Post()
  create(@Body() dto: CreateAlbumDto) { return {}; }
}
`;
    const APP_MODULE_SPREAD = `
import { Module } from "@nestjs/common";
import { APP_PIPE } from "@nestjs/core";
import { ZodValidationPipe } from "nestjs-zod";
import { FileUploadInterceptor } from "./middleware";

const commonMiddleware = [
  { provide: APP_PIPE, useClass: ZodValidationPipe },
];
const apiMiddleware = [FileUploadInterceptor, ...commonMiddleware];

@Module({ providers: [...apiMiddleware] })
export class AppModule {}
`;
    function writeImmishApp() {
        write("tsconfig.json", TSCONFIG);
        write("src/album.dto.ts", ZOD_STUB);
        write("src/album.controller.ts", ALBUM_CONTROLLER);
        write("src/middleware.ts", `
export class FileUploadInterceptor {}
`);
    }
    (0, vitest_1.it)("APP_PIPE 经两跳 spread 进 @Module ⇒ 已校验 DTO 的 mutation 不报 NO_VALIDATION（immich 形态）", () => {
        writeImmishApp();
        write("src/app.module.ts", APP_MODULE_SPREAD);
        const a = (0, nestjs_detector_1.analyzeNestJSProject)(dir);
        (0, vitest_1.expect)(a.globalValidationPipes).toContain("ZodValidationPipe");
        const nv = a.issues.filter((i) => i.type === "NESTJS_NO_VALIDATION");
        (0, vitest_1.expect)(nv.map((i) => i.route)).not.toContain("POST albums");
    });
    (0, vitest_1.it)("反向：同一形态但摘掉 APP_PIPE 注册 ⇒ 精确转红（不是无差别压制）", () => {
        writeImmishApp();
        write("src/app.module.ts", `
import { Module } from "@nestjs/common";
import { FileUploadInterceptor } from "./middleware";
const apiMiddleware = [FileUploadInterceptor];
@Module({ providers: [...apiMiddleware] })
export class AppModule {}
`);
        const a = (0, nestjs_detector_1.analyzeNestJSProject)(dir);
        (0, vitest_1.expect)(a.globalValidationPipes).toEqual([]);
        (0, vitest_1.expect)(a.issues.some((i) => i.type === "NESTJS_NO_VALIDATION" && i.route === "POST albums")).toBe(true);
    });
    (0, vitest_1.it)("反向：有全局管道但入参不是已校验 DTO ⇒ 仍报（保守豁免不扩散到裸类型）", () => {
        writeImmishApp();
        write("src/app.module.ts", APP_MODULE_SPREAD);
        write("src/album.controller.ts", `
import { Body, Controller, Post } from "@nestjs/common";
import { PlainAlbumDto } from "./album.dto";
@Controller("albums")
export class AlbumController {
  @Post()
  create(@Body() dto: PlainAlbumDto) { return {}; }
}
`);
        const a = (0, nestjs_detector_1.analyzeNestJSProject)(dir);
        (0, vitest_1.expect)(a.issues.some((i) => i.type === "NESTJS_NO_VALIDATION" && i.route === "POST albums")).toBe(true);
    });
    (0, vitest_1.it)("反向：注释里的 APP_PIPE 不算注册事件 ⇒ 仍报（text-fallback 抗噪）", () => {
        writeImmishApp();
        write("src/app.module.ts", `
import { Module } from "@nestjs/common";
// 计划中：providers: [{ provide: APP_PIPE, useClass: ZodValidationPipe }]
// * 文档注释形态同样不应被当作注册证据
@Module({ providers: [] })
export class AppModule {}
`);
        const a = (0, nestjs_detector_1.analyzeNestJSProject)(dir);
        (0, vitest_1.expect)(a.globalValidationPipes).toEqual([]);
        (0, vitest_1.expect)(a.issues.some((i) => i.type === "NESTJS_NO_VALIDATION" && i.route === "POST albums")).toBe(true);
    });
    (0, vitest_1.it)("@UsePipes 自定义管道名（不带 Pipe 后缀）⇒ 识别为已注册管道", () => {
        writeImmishApp();
        write("src/album.controller.ts", `
import { Body, Controller, Post, UsePipes } from "@nestjs/common";
import { CreateAlbumDto } from "./album.dto";
@Controller("albums")
export class AlbumController {
  @Post()
  @UsePipes(bodyTrimSanitizer)
  create(@Body() dto: CreateAlbumDto) { return {}; }
}
`);
        const a = (0, nestjs_detector_1.analyzeNestJSProject)(dir);
        (0, vitest_1.expect)(a.issues.filter((i) => i.type === "NESTJS_NO_VALIDATION" && i.route === "POST albums")).toEqual([]);
    });
    (0, vitest_1.it)("@UseGuards(AuthGuard('JWT')) 的参数字符串不产生假认证证据（反向 Sophie）", () => {
        write("tsconfig.json", TSCONFIG);
        write("src/auth.guard.ts", GUARD);
        write("src/api.controller.ts", `
import { Controller, Post, UseGuards } from "@nestjs/common";
import { JWTStrategy } from "./jwt";
@Controller("api")
export class ApiController {
  @Post("transfer")
  @UseGuards(JWTStrategy)
  transfer() { return {}; }
}
`);
        write("src/jwt.ts", `
export const JWT = "Bearer";
export class JWTStrategy { canActivate(): boolean { return false; } }
`);
        write("src/app.module.ts", MODULE_EMPTY);
        const a = (0, nestjs_detector_1.analyzeNestJSProject)(dir);
        // JWTStrategy 名字里带 jwt ⇒ 认证守卫（EXPECT 有保护）
        (0, vitest_1.expect)(a.issues.filter((i) => i.type === "NESTJS_NO_AUTH")).toEqual([]);
        // 但若写成字符串参数，不得凭 'JWT' 这个 token 冒充守卫名
        write("src/api.controller.ts", `
import { Controller, Post, UseGuards } from "@nestjs/common";
import { AnonymousGate } from "./gate";
@Controller("api")
export class ApiController {
  @Post("transfer")
  @UseGuards(AnonymousGate("JWT"))
  transfer() { return {}; }
}
`);
        write("src/gate.ts", `
export function AnonymousGate(scheme: string): any { return class { canActivate() { return true; } }; }
`);
        const b = (0, nestjs_detector_1.analyzeNestJSProject)(dir);
        (0, vitest_1.expect)(b.issues.some((i) => i.type === "NESTJS_NO_AUTH" && i.route === "POST api/transfer")).toBe(true);
    });
    (0, vitest_1.it)("registrations 带可复核的 (file, line) 与发现途径", () => {
        writeImmishApp();
        write("src/app.module.ts", APP_MODULE_SPREAD);
        const a = (0, nestjs_detector_1.analyzeNestJSProject)(dir);
        const pipeReg = a.registrations.filter((r) => r.token === "APP_PIPE");
        (0, vitest_1.expect)(pipeReg.length).toBeGreaterThan(0);
        for (const r of pipeReg) {
            // 可复核：每条注册都必须能指回某个文件的某一行
            (0, vitest_1.expect)(r.file).toMatch(/app\.module\.ts$/);
            (0, vitest_1.expect)(r.line).toBeGreaterThan(0);
            (0, vitest_1.expect)(r.impl).toBe("ZodValidationPipe");
            (0, vitest_1.expect)(["module-decorator", "module-property", "array-literal", "text-fallback"]).toContain(r.source);
        }
    });
    (0, vitest_1.it)("数组路径别名：展开成多条 route，公开豁免重新生效（nocodb 形态，普查 72%）", () => {
        write("tsconfig.json", TSCONFIG);
        write("src/app.module.ts", MODULE_EMPTY);
        write("src/token.controller.ts", `
import { Controller, Post } from "@nestjs/common";
@Controller(["meta/bases/:id", "api/v1/db/meta/projects/:id"])
export class TokenController {
  @Post(["login", "signin"])
  login() { return {}; }
  @Post(["api-tokens"])
  createToken() { return {}; }
}
`);
        const a = (0, nestjs_detector_1.analyzeNestJSProject)(dir);
        const paths = a.routes.map((r) => `${r.method} ${r.path}`).sort();
        // 2 个 controller 别名 × 3 个方法别名 = 6 条
        (0, vitest_1.expect)(paths).toEqual([
            "POST api/v1/db/meta/projects/:id/api-tokens",
            "POST api/v1/db/meta/projects/:id/login",
            "POST api/v1/db/meta/projects/:id/signin",
            "POST meta/bases/:id/api-tokens",
            "POST meta/bases/:id/login",
            "POST meta/bases/:id/signin",
        ]);
        // 旧实现下 path 是整段数组文本 ⇒ /login 豁免匹配不到 ⇒ 4 条 login/signin 全被误报
        const noAuth = a.issues.filter((i) => i.type === "NESTJS_NO_AUTH").map((i) => i.route);
        (0, vitest_1.expect)(noAuth.sort()).toEqual([
            "POST api/v1/db/meta/projects/:id/api-tokens",
            "POST meta/bases/:id/api-tokens",
        ]);
    });
    (0, vitest_1.it)("@Module(configVar)：装饰器参数是变量时仍能读到 providers（nocodb 形态，普查 71%）", () => {
        writeImmishApp();
        write("src/app.module.ts", `
import { Module } from "@nestjs/common";
import { APP_PIPE } from "@nestjs/core";
import { ZodValidationPipe } from "nestjs-zod";

const moduleMetadata = {
  imports: [],
  controllers: [],
  providers: [{ provide: APP_PIPE, useClass: ZodValidationPipe }],
};

@Module(moduleMetadata)
export class AppModule {}
`);
        const a = (0, nestjs_detector_1.analyzeNestJSProject)(dir);
        (0, vitest_1.expect)(a.globalValidationPipes).toContain("ZodValidationPipe");
        const nv = a.issues.filter((i) => i.type === "NESTJS_NO_VALIDATION");
        (0, vitest_1.expect)(nv.map((i) => i.route)).not.toContain("POST albums");
    });
});
