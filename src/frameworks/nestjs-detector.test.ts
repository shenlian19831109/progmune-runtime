/**
 * nestjs-detector.test.ts — NestJS 补全轮回归（文件系统夹具，临时目录）
 *
 * 锁定三缺口修复：全局 APP_GUARD 识别、@Public 豁免、守卫名认证分类
 * （ThrottlerGuard ≠ 认证）。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { analyzeNestJSProject } from "./nestjs-detector";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "nestjs-det-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(rel: string, content: string) {
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

describe("nestjs-detector 补全", () => {
  it("全局 APP_GUARD：无类/方法守卫的 mutation 路由不报 NO_AUTH", () => {
    write("tsconfig.json", TSCONFIG);
    write("src/auth.guard.ts", GUARD);
    write("src/api.controller.ts", CONTROLLER_BARE);
    write("src/app.module.ts", MODULE_GLOBAL_GUARD);
    const { globalAuthGuards, issues } = analyzeNestJSProject(dir);
    expect(globalAuthGuards).toContain("AuthGuard");
    expect(issues.map((i) => i.type)).not.toContain("NESTJS_NO_AUTH");
  });

  it("@Public 绕过全局守卫 → NESTJS_NO_AUTH（显式绕过检出）", () => {
    write("tsconfig.json", TSCONFIG);
    write("src/auth.guard.ts", GUARD);
    write("src/api.controller.ts", CONTROLLER_BARE.replace(
      '@Post("transfer")', '@Public()\n  @Post("transfer")'
    ));
    write("src/app.module.ts", MODULE_GLOBAL_GUARD);
    const { issues } = analyzeNestJSProject(dir);
    expect(issues.map((i) => i.type)).toContain("NESTJS_NO_AUTH");
  });

  it("ThrottlerGuard 不是认证守卫 → 仍报 NESTJS_NO_AUTH", () => {
    write("tsconfig.json", TSCONFIG);
    write("src/auth.guard.ts", GUARD);
    write("src/api.controller.ts", CONTROLLER_BARE.replace(
      '@Post("transfer")', '@UseGuards(ThrottlerGuard)\n  @Post("transfer")'
    ).replace(
      'import { Controller, Post, Get } from "@nestjs/common";',
      'import { Controller, Post, Get, UseGuards } from "@nestjs/common";\nimport { ThrottlerGuard } from "@nestjs/throttler";'
    ));
    write("src/app.module.ts", MODULE_EMPTY);
    const { issues } = analyzeNestJSProject(dir);
    expect(issues.map((i) => i.type)).toContain("NESTJS_NO_AUTH");
  });

  it("无任何守卫且无全局守卫 → NESTJS_NO_AUTH", () => {
    write("tsconfig.json", TSCONFIG);
    write("src/auth.guard.ts", GUARD);
    write("src/api.controller.ts", CONTROLLER_BARE);
    write("src/app.module.ts", MODULE_EMPTY);
    const { issues } = analyzeNestJSProject(dir);
    expect(issues.map((i) => i.type)).toContain("NESTJS_NO_AUTH");
  });

  it("类级 AuthGuard 保护 → 不报 NESTJS_NO_AUTH", () => {
    write("tsconfig.json", TSCONFIG);
    write("src/auth.guard.ts", GUARD);
    write("src/api.controller.ts", CONTROLLER_BARE.replace(
      '@Controller("api")', '@Controller("api")\n@UseGuards(AuthGuard)'
    ).replace(
      'import { Controller, Post, Get } from "@nestjs/common";',
      'import { Controller, Post, Get, UseGuards } from "@nestjs/common";\nimport { AuthGuard } from "./auth.guard";'
    ));
    write("src/app.module.ts", MODULE_EMPTY);
    const { issues } = analyzeNestJSProject(dir);
    expect(issues.map((i) => i.type)).not.toContain("NESTJS_NO_AUTH");
  });

  it("@Public 登录入口在全局守卫下不报", () => {
    write("tsconfig.json", TSCONFIG);
    write("src/auth.guard.ts", GUARD);
    write("src/api.controller.ts", CONTROLLER_BARE.replace(
      '@Post("transfer")', '@Public()\n  @Post("login")'
    ).replace('transfer() { return "done"; }', 'login() { return "token"; }'));
    write("src/app.module.ts", MODULE_GLOBAL_GUARD);
    const { issues } = analyzeNestJSProject(dir);
    expect(issues.map((i) => i.type)).not.toContain("NESTJS_NO_AUTH");
  });
});
