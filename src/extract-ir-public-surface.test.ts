import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { extractIR } from "./extract-ir";

/**
 * 修冤枉第十刀（2026-10-16）：公开设计端点 → 公开面标记锁定。
 *
 * 数据：docmost 15 个 @Public() 方法自身 17 条授权族告警全 FP——
 * 公开是开发者显式声明（正向证据，R75），授权族「缺鉴权」提问不适用。
 *
 * 注入形态：类级/方法级 @Public/@SkipAuth/@AllowAnonymous（NestJS 惯例）。
 * 反例（不注入）：@ApiExcludeEndpoint 是 Swagger 文档语义；
 * 与 AUTH_SKIP_DECORATOR 不对称是故意的（两个方向的错判都是假阴性）。
 */

const MARK = "__progmune_public_surface__";
const TSCONFIG = JSON.stringify({
  compilerOptions: { target: "ES2020", module: "commonjs", strict: false, skipLibCheck: true, noEmit: true },
  include: ["**/*.ts"],
});

function makeProject(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-publicsurface-"));
  fs.writeFileSync(path.join(dir, "tsconfig.json"), TSCONFIG);
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "fixture", version: "0.0.0", private: true }));
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
  return dir;
}

function callsOf(dir: string, fnName: string): string[] {
  const fns = extractIR(dir);
  const f = fns.find((x) => x.name === fnName);
  return f ? (f.calls ?? []) : [];
}

describe("extractIR：公开面标记（修冤枉第十刀）", () => {
  it("@Public() 类级 ⇒ 全部方法注入", () => {
    const dir = makeProject({
      "a.ts": `
declare const Public: any; declare const Controller: any; declare const Get: any;
@Public()
@Controller("public-space")
export class PublicSpaceController {
  @Get("info")
  getInfo() { return 1; }
  getTree() { return 2; }
}
`,
    });
    expect(callsOf(dir, "PublicSpaceController.getInfo")).toContain(MARK);
    expect(callsOf(dir, "PublicSpaceController.getTree")).toContain(MARK);
  });

  it("@Public/@SkipAuth/@AllowAnonymous 方法级 ⇒ 仅该方法注入", () => {
    const dir = makeProject({
      "a.ts": `
declare const Public: any; declare const SkipAuth: any; declare const AllowAnonymous: any;
export class ShareController {
  @Public()
  getShare() {}
  @SkipAuth()
  getSharedPageInfo() {}
  @AllowAnonymous()
  transclusionLookup() {}
  getPrivateShare() {}
}
`,
    });
    for (const fn of ["ShareController.getShare", "ShareController.getSharedPageInfo", "ShareController.transclusionLookup"]) {
      expect(callsOf(dir, fn)).toContain(MARK);
    }
    expect(callsOf(dir, "ShareController.getPrivateShare")).not.toContain(MARK);
  });

  it("反例：@ApiExcludeEndpoint 是 Swagger 文档语义，不注入", () => {
    const dir = makeProject({
      "a.ts": `
declare const ApiExcludeEndpoint: any;
export class DocController {
  @ApiExcludeEndpoint()
  hidden() {}
}
`,
    });
    expect(callsOf(dir, "DocController.hidden")).not.toContain(MARK);
  });

  it("@UseGuards + @Public 并存 ⇒ public 注入、auth 不注入（显式公开优先）", () => {
    const dir = makeProject({
      "a.ts": `
declare const UseGuards: any; declare const Public: any;
declare class JwtAuthGuard {}
export class C {
  @UseGuards(JwtAuthGuard)
  @Public()
  m() { return 1; }
}
`,
    });
    const calls = callsOf(dir, "C.m");
    expect(calls).toContain(MARK);
    expect(calls).not.toContain("__progmune_auth_machinery__");
  });

  it("普通守卫方法 ⇒ 不注入 public、注入 auth（两条通道互不污染）", () => {
    const dir = makeProject({
      "a.ts": `
declare const UseGuards: any;
declare class JwtAuthGuard {}
export class C {
  @UseGuards(JwtAuthGuard)
  m() { return 1; }
}
`,
    });
    const calls = callsOf(dir, "C.m");
    expect(calls).not.toContain(MARK);
    expect(calls).toContain("__progmune_auth_machinery__");
  });
});
