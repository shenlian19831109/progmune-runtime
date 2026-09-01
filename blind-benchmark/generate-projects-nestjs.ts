/**
 * NestJS 合成金标生成器（补全轮——8/13）——镜像 generate-projects-fastapi 方法学
 *
 * 项目规格（6 项目）：
 *   N1 类级守卫 clean        @UseGuards(AuthGuard) 类级 → 0
 *   N2 全局 APP_GUARD clean  @Module providers + @Public login → 0
 *   N3 无守卫 V1             裸 mutation 路由 → NESTJS_NO_AUTH
 *   N4 全局守卫 + @Public 绕过 V2  → NESTJS_NO_AUTH（显式绕过全局守卫）
 *   N5 ThrottlerGuard V3     限流守卫≠认证 → NESTJS_NO_AUTH
 *   N6 敏感 GET 公开 V4      GET /admin 无守卫 → NESTJS_SENSITIVE_PUBLIC
 * 金标 = 每项目预期 (rule, handler) 清单（gold.json 随项目落盘）。
 *
 * Usage: npx ts-node blind-benchmark/generate-projects-nestjs.ts
 */

import * as fs from "fs";
import * as path from "path";

const GEN_DIR = path.resolve(__dirname, "generated-nestjs");

const TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "experimentalDecorators": true,
    "strict": false,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src/**/*"]
}
`;

const CONTROLLER = (methodDecorators: string, extraClassDec = ""): string => `
import { Controller, Post, Get, UseGuards } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { AuthGuard } from "./auth.guard";

@Controller("api")
${extraClassDec}
export class ApiController {
  @Get("health")
  health() { return "ok"; }

  @Post("transfer")
  ${methodDecorators}
  transfer() { return "done"; }

  @Get("admin")
  listAdmins() { return []; }
}
`;

const GUARD = `
import { CanActivate } from "@nestjs/common";

export class AuthGuard implements CanActivate {
  canActivate(): boolean { return true; }
}
`;

const MODULE = (providers: string): string => `
import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthGuard } from "./auth.guard";

@Module({
  providers: [${providers}],
})
export class AppModule {}
`;

interface Spec {
  id: string;
  files: { [file: string]: string };
  gold: Array<{ rule: string; handler: string | null }>;
}

const NO_AUTH = { rule: "NESTJS_NO_AUTH", handler: "ApiController.transfer" };
const NO_VALIDATION = { rule: "NESTJS_NO_VALIDATION", handler: "ApiController.transfer" };
const SENSITIVE_ADMIN = { rule: "NESTJS_SENSITIVE_PUBLIC", handler: "ApiController.admin" };

const SPECS: Spec[] = [
  {
    id: "nestjs_N1_clean",
    files: {
      "tsconfig.json": TSCONFIG,
      "src/auth.guard.ts": GUARD,
      "src/api.controller.ts": CONTROLLER("", "@UseGuards(AuthGuard)"),
      "src/app.module.ts": MODULE(""),
    },
    gold: [NO_VALIDATION],
  },
  {
    id: "nestjs_N2_clean_global",
    files: {
      "tsconfig.json": TSCONFIG,
      "src/auth.guard.ts": GUARD,
      "src/api.controller.ts": `
import { Controller, Post, Get, UseGuards } from "@nestjs/common";
import { AuthGuard } from "./auth.guard";

@Controller("api")
export class ApiController {
  @Get("health")
  health() { return "ok"; }

  @Public()
  @Post("login")
  login() { return "token"; }

  @Post("transfer")
  transfer() { return "done"; }

  @Get("admin")
  @UseGuards(AuthGuard)
  listAdmins() { return []; }
}
`,
      "src/app.module.ts": MODULE("{ provide: APP_GUARD, useClass: AuthGuard }"),
    },
    gold: [NO_VALIDATION],
  },
  {
    id: "nestjs_N3_V1_no_guard",
    files: {
      "tsconfig.json": TSCONFIG,
      "src/auth.guard.ts": GUARD,
      "src/api.controller.ts": CONTROLLER("", ""),
      "src/app.module.ts": MODULE(""),
    },
    gold: [NO_AUTH, NO_VALIDATION, SENSITIVE_ADMIN],
  },
  {
    id: "nestjs_N4_V2_public_bypass",
    files: {
      "tsconfig.json": TSCONFIG,
      "src/auth.guard.ts": GUARD,
      "src/api.controller.ts": CONTROLLER("@Public()", ""),
      "src/app.module.ts": MODULE("{ provide: APP_GUARD, useClass: AuthGuard }"),
    },
    gold: [NO_AUTH, NO_VALIDATION],
  },
  {
    id: "nestjs_N5_V3_throttler_only",
    files: {
      "tsconfig.json": TSCONFIG,
      "src/auth.guard.ts": GUARD,
      "src/api.controller.ts": CONTROLLER("@UseGuards(ThrottlerGuard)", ""),
      "src/app.module.ts": MODULE(""),
    },
    gold: [NO_AUTH, NO_VALIDATION, SENSITIVE_ADMIN],
  },
  {
    id: "nestjs_N6_V4_sensitive_get",
    files: {
      "tsconfig.json": TSCONFIG,
      "src/auth.guard.ts": GUARD,
      "src/api.controller.ts": CONTROLLER("@UseGuards(AuthGuard)", ""),
      "src/app.module.ts": MODULE(""),
    },
    gold: [NO_VALIDATION, SENSITIVE_ADMIN],
  },
];

function main() {
  fs.rmSync(GEN_DIR, { recursive: true, force: true });
  fs.mkdirSync(GEN_DIR, { recursive: true });
  const manifest: any[] = [];
  for (const spec of SPECS) {
    const dir = path.join(GEN_DIR, spec.id);
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(spec.files)) {
      const full = path.join(dir, name);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content);
    }
    manifest.push({ id: spec.id, gold: spec.gold });
  }
  fs.writeFileSync(path.join(GEN_DIR, "gold.json"), JSON.stringify(manifest, null, 2));
  console.log(`生成 ${manifest.length} 项目 → ${GEN_DIR}`);
}

main();
