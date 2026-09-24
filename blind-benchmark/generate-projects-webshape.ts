/**
 * Blind Benchmark — TS web 框架形状（webshape）语料族生成器（2026-09-22）
 *
 * 为什么要有这个族：
 *   R23 已出现四次，根因同一 —— `generated/` 里**没有一个装饰器、没有一个类方法
 *   入口、没有一个分发器**：
 *     实测：116 个 generated 项目里 `^\s*@[A-Z]\w*(` 命中 **0 个文件**；
 *           含 `class` 声明的只有 taintpath_B/H/I/K 4 个文件，且全部无装饰器。
 *   ⇒ E2（装饰器鉴权标记）、E3（DTO schema 标记）两轮的盲测是**空过**的：
 *     不是改对了，是语料根本没这种形状，硬门证明不了任何东西。
 *   ⇒ §二十五 exposed 通道同理：变体 E 要恢复的 `handleSubmit` 分发器形状
 *     在语料里 0 条，增量无法验证。
 *
 *   本族把四种真实 TS web 形状钉进盲测语料，使上述三件事重新变得**可验证**。
 *
 * 四种形状（对应四次 R23 空过）：
 *   A  NestJS Controller + HTTP 装饰器          —— E2（装饰器鉴权）
 *   B  DTO + class-validator 校验装饰器          —— E3（schema 校验）
 *   C  类方法作为入口（无框架）                  —— 类方法轴
 *   D  分发器：入口名不含 create，把入参交给外部 create —— F / exposed 通道
 *
 * 用法：npx tsx blind-benchmark/generate-projects-webshape.ts
 *
 * ⚠ 与 generate-projects.ts 的关系：后者会 rm -rf 所有**含 `_`** 的目录。
 *   本族与 taintpath_* 同样带 `_` ⇒ 跑过 generate-projects.ts 后必须重跑本脚本，
 *   否则语料静默消失、闸门回到空过。check-webshape.ts 在目录缺失时会**报错退出**
 *   （不是跳过），把这件事变成硬失败。
 *
 * 期望表由本脚本**一并写出**（webshape-expectations.json），避免期望与语料漂移
 * （R7 的执行点：期望表的唯一真相是语料本身）。
 */

import * as fs from "fs";
import * as path from "path";

const GEN_DIR = path.resolve(__dirname, "generated");
const EXPECT_PATH = path.resolve(__dirname, "webshape-expectations.json");

const TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      target: "ES2020",
      module: "commonjs",
      strict: false,
      esModuleInterop: true,
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
      skipLibCheck: true,
    },
    include: ["src"],
  },
  null,
  2
);

export type Marker =
  | "auth_machinery" //  __progmune_auth_machinery__   （E2：装饰器里的框架鉴权）
  | "input_schema" //  __progmune_input_schema__     （E3：入参按 DTO schema 校验）
  | "input_guard" //  __progmune_input_guard__      （E4：函数体里的输入校验证据）
  | "input_effect" // __progmune_input_effect__     （E5：参数流向外部副作用的证据）
  | "path_traversal"; // __progmune_path_traversal__    （污点 → 文件 sink）

export type TraversalExpect = "mark" | "suppressed" | "no-taint" | "n/a";

export interface WebCase {
  /** 类方法用 `Class.method`；与 extract-ir 的命名一致 */
  fn: string;
  file: string;
  /** 必须出现的标记 */
  have?: Marker[];
  /** 必须**不**出现的标记 */
  none?: Marker[];
  /** path_traversal 的专属口径（mark/suppressed/no-taint），不关心写 n/a */
  traversal?: TraversalExpect;
  /** 必须**报出**的规则名（抑制类机制的反面护栏：不许被压掉） */
  reportRules?: string[];
  /** 必须**不报**的规则名（抑制类机制的正面期望） */
  suppressRules?: string[];
  why: string;
}

export interface WebProject {
  id: string;
  /** 一句话：这一族钉住什么形状 */
  shape: string;
  files: Record<string, string>;
  cases: WebCase[];
}

// ═══════════════════════════════════════════════════════════════
// A 族：NestJS Controller + HTTP 装饰器（E2 形状）
//
// 正向（有真守卫 ⇒ auth_machinery）与反向（无守卫 / 显式免鉴权 / 限流守卫）
// 必须同族并列 —— 只放正向的话，一条「类名含 Controller 就注入」的实现也能全绿。
// ═══════════════════════════════════════════════════════════════

const AUTH_GUARD_TS = `// webshape_A —— 守卫与免鉴权装饰器的实体化（真实 NestJS 里由 @nestjs/common 提供）
export class JwtAuthGuard {
  canActivate(): boolean {
    return true;
  }
}

/** 显式免鉴权：把公开端点判成「有鉴权」是最危险的假阴性，故单独一条反向用例 */
export function Public(): MethodDecorator {
  return () => undefined;
}
`;

const FILES_CONTROLLER_TS = `// webshape_A —— NestJS Controller：鉴权写在装饰器里，函数体与 calls 都看不到
import { Controller, Get, Post, Req } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { JwtAuthGuard, Public } from "./auth.guard";
import * as fs from "fs";

const UPLOAD_DIR = "/srv/uploads";

function assertSafePath(p: string): void {
  if (p.includes("..")) throw new Error("unsafe path");
}

@Controller("files")
export class FilesController {
  // ── 正向：方法级真守卫 ──
  @Post("read")
  @UseGuards(JwtAuthGuard)
  readGuarded(@Req() req: any): string {
    return fs.readFileSync(UPLOAD_DIR + "/" + req.body.name, "utf-8");
  }

  // 守卫不防路径穿越：污点仍进 sink ⇒ 鉴权标记与穿越标记**同时**存在
  @Post("read-safe")
  @UseGuards(JwtAuthGuard)
  readGuardedAndChecked(@Req() req: any): string {
    const name = req.body.name;
    assertSafePath(name);
    return fs.readFileSync(UPLOAD_DIR + "/" + name, "utf-8");
  }

  // ── 反向 1：裸路由，无任何守卫装饰器 ──
  @Get("raw")
  readUnguarded(@Req() req: any): string {
    return fs.readFileSync(UPLOAD_DIR + "/" + req.query.name, "utf-8");
  }

  // ── 反向 2：显式免鉴权（@Public）—— 不得注入 ──
  @Get("health")
  @Public()
  health(): string {
    return "ok";
  }

  // ── 反向 3：限流守卫 ≠ 鉴权（@UseGuards(ThrottlerGuard)）—— 不得注入 ──
  @Post("throttled")
  @UseGuards(ThrottlerGuard)
  throttled(@Req() req: any): string {
    return fs.readFileSync(UPLOAD_DIR + "/" + req.body.name, "utf-8");
  }
}
`;

const PROJECT_A: WebProject = {
  id: "webshape_A",
  shape: "NestJS Controller + HTTP 装饰器（E2 装饰器鉴权标记）",
  files: {
    "src/auth.guard.ts": AUTH_GUARD_TS,
    "src/files.controller.ts": FILES_CONTROLLER_TS,
  },
  cases: [
    {
      fn: "FilesController.readGuarded",
      file: "files.controller.ts",
      have: ["auth_machinery"],
      traversal: "mark",
      why: "@UseGuards(JwtAuthGuard) ⇒ 框架鉴权标记；守卫不防路径穿越 ⇒ 穿越标记同时在",
    },
    {
      fn: "FilesController.readGuardedAndChecked",
      file: "files.controller.ts",
      have: ["auth_machinery"],
      traversal: "suppressed",
      why: "有鉴权 + 有路径校验证据 ⇒ 鉴权标记在、穿越标记被压（G-C 形态）",
    },
    {
      fn: "FilesController.readUnguarded",
      file: "files.controller.ts",
      none: ["auth_machinery"],
      traversal: "mark",
      why: "裸路由：类级/方法级都没有鉴权装饰器 ⇒ 不得注入鉴权标记",
    },
    {
      fn: "FilesController.health",
      file: "files.controller.ts",
      none: ["auth_machinery"],
      traversal: "n/a",
      why: "@Public() 显式免鉴权 ⇒ 注入即假阴性（最危险方向），必须挡住",
    },
    {
      fn: "FilesController.throttled",
      file: "files.controller.ts",
      none: ["auth_machinery"],
      traversal: "mark",
      why: "@UseGuards(ThrottlerGuard) 是限流不是鉴权 ⇒ 守卫实参不像 auth 语义，不得注入",
    },
  ],
};

// ═══════════════════════════════════════════════════════════════
// B 族：DTO + class-validator 校验装饰器（E3 形状）
//
// 反向用例特意做成《容易误判成已校验》的三种：
//   ①只有 @IsOptional/@Type/@Transform（都可缺省/转换，不校验）
//   ②入参类型是 any（无类型信息）
//   ③类型在本项目里但没有任何校验装饰器
// ═══════════════════════════════════════════════════════════════

const COMMENTS_DTO_TS = `// webshape_B —— DTO：校验写在**属性装饰器**上，函数体与 calls 都看不到
import { IsString, IsOptional, IsInt, MinLength, MaxLength, Matches } from "class-validator";
import { Type, Transform } from "class-transformer";

export class CreateCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  body: string;

  @IsOptional()
  @Matches(/^[a-z0-9-]+$/)
  slug?: string;
}

export class UpdateCommentDto {
  @IsInt()
  id: number;

  @IsString()
  body: string;
}

/** 反例：@IsOptional 只表示可缺省，@Type/@Transform 只做转换 —— 都不是校验 */
export class LoosePayload {
  @IsOptional()
  @Type(() => String)
  body?: string;

  @Transform((v: any) => String(v))
  raw: string;
}
`;

const COMMENTS_CONTROLLER_TS = `// webshape_B —— 入参类型是「带校验装饰器的类」⇒ 入参已按 schema 校验
import { Controller, Post, Patch, Body } from "@nestjs/common";
import { CreateCommentDto, UpdateCommentDto, LoosePayload } from "./comments.dto";
import { commentRepo } from "@app/db";

@Controller("comments")
export class CommentsController {
  @Post()
  createValidated(@Body() dto: CreateCommentDto) {
    return commentRepo.createComment(dto);
  }

  @Patch()
  updateValidated(@Body() dto: UpdateCommentDto) {
    return commentRepo.updateComment(dto.id, dto);
  }

  // 反例 1：类型在本项目里，但装饰器不校验
  @Post("loose")
  createLoose(@Body() dto: LoosePayload) {
    return commentRepo.createComment(dto);
  }

  // 反例 2：入参无类型信息
  @Post("raw")
  createUntyped(@Body() dto: any) {
    return commentRepo.createComment(dto);
  }
}
`;

const PROJECT_B: WebProject = {
  id: "webshape_B",
  shape: "DTO + class-validator 校验装饰器（E3 schema 校验标记）",
  files: {
    "src/comments.dto.ts": COMMENTS_DTO_TS,
    "src/comments.controller.ts": COMMENTS_CONTROLLER_TS,
  },
  cases: [
    {
      fn: "CommentsController.createValidated",
      file: "comments.controller.ts",
      have: ["input_schema"],
      why: "入参类型 CreateCommentDto 带 @IsString/@MinLength/@MaxLength ⇒ 已按 schema 校验",
    },
    {
      fn: "CommentsController.updateValidated",
      file: "comments.controller.ts",
      have: ["input_schema"],
      why: "入参类型 UpdateCommentDto 带 @IsInt/@IsString ⇒ 已按 schema 校验",
    },
    {
      fn: "CommentsController.createLoose",
      file: "comments.controller.ts",
      none: ["input_schema"],
      why: "LoosePayload 只有 @IsOptional/@Type/@Transform ⇒ 不是校验，不得注入",
    },
    {
      fn: "CommentsController.createUntyped",
      file: "comments.controller.ts",
      none: ["input_schema"],
      why: "入参类型是 any ⇒ 无 schema 信息，不得注入",
    },
  ],
};

// ═══════════════════════════════════════════════════════════════
// C 族：类方法作为入口（无框架）
//
// A/B 两族的方法都带装饰器，无法区分「类方法被正确提取」与「装饰器被正确识别」。
// 本族去掉装饰器，单独钉住类方法轴：方法名是 `Class.method`，污点经方法入参进 sink。
// ═══════════════════════════════════════════════════════════════

const ARCHIVE_SERVICE_TS = `// webshape_C —— 类方法作入口：不带任何框架装饰器，单独验证类方法轴
import * as fs from "fs";

const ROOT = "/srv/archive";

function assertSafePath(p: string): void {
  if (p.includes("..")) throw new Error("unsafe path");
}

export class ArchiveService {
  extract(req: any): void {
    fs.writeFileSync(ROOT + "/" + req.query.name, "x");
  }

  extractChecked(req: any): void {
    const name = req.query.name;
    assertSafePath(name);
    fs.writeFileSync(ROOT + "/" + name, "x");
  }

  extractConstant(): void {
    fs.writeFileSync(ROOT + "/index.json", "x");
  }
}
`;

const PROJECT_C: WebProject = {
  id: "webshape_C",
  shape: "类方法作为入口（无框架装饰器，单独验证类方法轴）",
  files: { "src/archive.service.ts": ARCHIVE_SERVICE_TS },
  cases: [
    {
      fn: "ArchiveService.extract",
      file: "archive.service.ts",
      none: ["auth_machinery", "input_schema"],
      traversal: "mark",
      why: "类方法入口：req.query 直进 sink ⇒ 穿越标记；无装饰器 ⇒ 不得有鉴权/schema 标记",
    },
    {
      fn: "ArchiveService.extractChecked",
      file: "archive.service.ts",
      traversal: "suppressed",
      why: "类方法内有校验证据 ⇒ 穿越标记被压（若按文件/按类压，本条会连坐另一条）",
    },
    {
      fn: "ArchiveService.extractConstant",
      file: "archive.service.ts",
      traversal: "no-taint",
      why: "无污点：类方法里常量路径不得标记",
    },
  ],
};

// ═══════════════════════════════════════════════════════════════
// D 族：分发器（F 轮 / exposed 通道的验收对象）
//
// 形状：`入口函数名不含 create` + `把入参交给**项目外**的 create`。
// §二十五 的变体 E 要恢复的就是这一条；同时必须挡住两件事：
//   ① 本地 create（下游自己会被报，不该重复报）—— F 轮 −175 的来源
//   ② 库函数的 create*（createHash 类）—— 变体 E 全量重放多出 69 条的来源
// 本族只把形状钉进语料，**不改实现**；基线是多少、变体 E 是多少，由下一轮量。
// ═══════════════════════════════════════════════════════════════

const DISPATCHER_TS = `// webshape_D —— 分发器：入口名不含 create，创建动作发生在**项目外**
import { createHash } from "crypto";
import { commentRepo } from "@app/db";
import * as fs from "fs";

const UPLOAD_DIR = "/srv/uploads";

function assertSafePath(p: string): void {
  if (p.includes("..")) throw new Error("unsafe path");
}

/** ① 目标形状：入口名不含 create，把入参交给外部 create */
export function handleSubmit(input: any): void {
  commentRepo.createComment(input);
}

/** ② 本地 create：下游 createEvent 在本项目内，它自己会被判到 */
export function handleRequest(input: any): void {
  createEvent(input);
}

export function createEvent(input: any): void {
  fs.writeFileSync(UPLOAD_DIR + "/events/" + input.name, JSON.stringify(input));
}

/** ③ 库函数的 create*：createHash 来自 crypto，不是内容创建 */
export function handleHash(input: any): string {
  return createHash("sha256").update(input).digest("hex");
}

/** ④ 分发器自己做了**内容**校验（validateContent 命中 Input Validation 的 safeguard 词表）*/
export function handleSubmitValidated(input: any): void {
  validateContent(input);
  commentRepo.createComment(input);
}

/**
 * ⑤ 分发器只做了**路径**检查 —— assertSafePath 不在「内容校验」词表内。
 * 按规则语义（Content creation function does not validate or sanitize **input**），
 * 只查路径不查内容 ⇒ 仍然该报。这条是防「拿任何 assert* 都当校验」的反向用例。
 */
export function handleSubmitPathChecked(input: any): void {
  assertSafePath(input.name);
  commentRepo.createComment(input);
}

/** ⑥ 对照：函数名自带 create，任何版本都该触发 */
export function createPost(input: any): void {
  commentRepo.createComment(input);
}

function validateContent(x: any): void {
  if (!x) throw new Error("empty content");
}
`;

const PROJECT_D: WebProject = {
  id: "webshape_D",
  shape: "分发器：入口名不含 create，创建动作在项目外（F 轮 / exposed 通道）",
  files: { "src/dispatcher.ts": DISPATCHER_TS },
  cases: [
    {
      fn: "handleSubmit",
      file: "dispatcher.ts",
      none: ["auth_machinery", "input_schema"],
      traversal: "n/a",
      why: "目标形状：外部 createComment —— 变体 E 应当在这里**新增**检出（下轮量）",
    },
    {
      fn: "handleRequest",
      file: "dispatcher.ts",
      traversal: "n/a",
      why: "本地 createEvent 在项目内 ⇒ 任何版本都不得重复报（F 轮 −175 的守门用例）",
    },
    {
      fn: "handleHash",
      file: "dispatcher.ts",
      traversal: "n/a",
      why: "createHash 是库函数不是内容创建 ⇒ 变体 E 若在这里报，就是 69 条误报的来源",
    },
    {
      fn: "handleSubmitValidated",
      file: "dispatcher.ts",
      traversal: "n/a",
      why: "validateContent 命中 Input Validation 的 safeguard 词表 ⇒ 已校验，不得报",
    },
    {
      fn: "handleSubmitPathChecked",
      file: "dispatcher.ts",
      traversal: "n/a",
      why: "assertSafePath 只查路径不查内容，不在内容校验词表内 ⇒ 语义上仍该报（防「任何 assert* 都算校验」）",
    },
    {
      fn: "createPost",
      file: "dispatcher.ts",
      traversal: "n/a",
      why: "对照：函数名自带 create，基线就该触发，不受任何变体影响",
    },
  ],
};

// ── E：函数体里的输入校验证据（E4，2026-09-23）────────────────────────
//
// 钉住什么：Input Validation 的 safeguard 此前只看函数名与调用名，**看不见函数体**
// ⇒ 明明有校验也被判「内容创建函数未校验输入」。E4 让提取器把函数体里的校验
// 证据变成标记，规则侧开一个接受位。
//
// 本族把判据的**正反两面**都钉住（R19：分母要含被拒掉的那些 ——
// 只写「该压的」，不写「不该压的」，机制变成无条件抑制也照样全绿）：
//   不该报 ① limits 选项 + 判空抛 4xx      ⑤ 显式 validateContent（旧词表就认）
//   该报   ② 无任何校验  ③ 抛 NotFound（存在性≠输入校验）
//          ④ 抛裸 Error（环境配置校验≠输入校验，实测 createS3 即此形态）
const PROJECT_E: WebProject = {
  id: "webshape_E",
  shape: "函数体里的输入校验证据（E4）：limits 选项 / 判空抛 4xx，以及三类反例",
  files: {
    "src/guarded.ts": `declare const BadRequestException: any;
declare const NotFoundException: any;
declare const validateContent: any;
declare const repo: any;

/** ① limits 选项 + 判空抛 BadRequest ⇒ 函数体里有校验证据 ⇒ 不该报 */
export async function uploadAvatar(req: any): Promise<void> {
  const file = await req.file({ limits: { fileSize: 1024, fields: 3, files: 1 } });
  if (!file) {
    throw new BadRequestException("Failed to upload file");
  }
  await repo.saveAvatar(file);
}

/** ② 什么校验都没有 ⇒ 该报 */
export async function uploadBanner(req: any): Promise<void> {
  const file = await req.file();
  await repo.saveBanner(file);
}

/** ③ 判空但抛 NotFound —— 存在性校验 ≠ 输入校验 ⇒ 该报 */
export async function uploadIcon(req: any): Promise<void> {
  const existing = await repo.findIcon(req.id);
  if (!existing) {
    throw new NotFoundException("Icon not found");
  }
  await repo.saveIcon(existing);
}

/** ④ 判空但抛裸 Error —— 环境配置校验 ≠ 输入校验 ⇒ 该报 */
export async function uploadThumb(req: any): Promise<void> {
  if (!req.bucket) {
    throw new Error("bucket is required; set STORAGE_PATH");
  }
  await repo.saveThumb(req);
}

/** ⑤ 显式 validateContent —— 旧词表就认 ⇒ 不该报（与 E4 无关，作对照） */
export async function uploadCover(input: any): Promise<void> {
  validateContent(input.name);
  await repo.saveCover(input);
}
`,
  },
  cases: [
    {
      fn: "uploadAvatar",
      file: "guarded.ts",
      // input_effect 是 2026-09-23 补的：E 族原本只钉 input_guard 维度，
      // derive-cut-expectations 的「仅因规则维度转红」提示暴露了缺口 ——
      // 若将来只改规则不改标记，这 5 条就抓不到（R19：分母要含被拒掉的那些）。
      have: ["input_guard", "input_effect"],
      suppressRules: ["Input Validation"],
      why: "limits 选项 + 判空抛 4xx ⇒ 有校验证据，不该报",
    },
    {
      fn: "uploadBanner",
      file: "guarded.ts",
      none: ["input_guard"],
      have: ["input_effect"],
      reportRules: ["Input Validation"],
      why: "无校验 ⇒ 该报（抑制机制的反面护栏，防止变成无条件抑制）",
    },
    {
      fn: "uploadIcon",
      file: "guarded.ts",
      none: ["input_guard"],
      have: ["input_effect"],
      reportRules: ["Input Validation"],
      why: "抛 NotFound = 存在性校验，不算输入校验 ⇒ 该报",
    },
    {
      fn: "uploadThumb",
      file: "guarded.ts",
      none: ["input_guard"],
      have: ["input_effect"],
      reportRules: ["Input Validation"],
      why: "抛裸 Error = 环境配置校验，不算输入校验 ⇒ 该报",
    },
    {
      fn: "uploadCover",
      file: "guarded.ts",
      none: ["input_guard"],
      have: ["input_effect"],
      suppressRules: ["Input Validation"],
      why: "validateContent 旧词表就认 ⇒ 与本轮机制无关，不该报（对照）",
    },
  ],
};

// ── F：参数流向外部副作用的证据（E5，2026-09-23）────────────────────────
//
// 钉住什么：Input Validation 的 trigger 此前是**纯函数名正则**（create|add|post|upload），
// 判据手里只有名字 ⇒ verdaccio ConfigBuilder.addStorage（配置装配）、ducktors
// createS3（工厂）这类**根本不接外部输入**的函数也被要求「必须校验输入」。
// FP 池实测 75 条里 62 条（83%）完全没有请求入口迹象。
// E5 加语义前置条件：函数体里须有「参数流向外部副作用」的证据才触发。
//
// 正反两面（R19：分母要含被判据拒掉的那些 —— 只写「该压的」，
// 无条件压制也能全绿）：
//   该报   ① repo.save（ORM 写入） ④ db.insertInto（Kysely 链式，S7 通道）
//          ⑤ fetch 出站（S3 通道）—— 有副作用证据，仍须报
//   不该报 ② 纯内存装配（push 到数组，无任何 sink）
//          ③ 工厂（return new StorageClient()，无 sink）
//          ⑥ 有副作用但已校验（validateContent）—— 校验位仍优先
//
// ⚠ 判据不是「是否 HTTP 入口」：真值集里 4 条已核验真报（docmost addContributors
//   等 Service 层方法）没有 req 对象，但参数是从 Controller 透传的外部输入。
//   「非入口 ⇒ 不报」会压掉它们 ⇒ 问的是「参数流向」，不是「入口形态」。
const PROJECT_F: WebProject = {
  id: "webshape_F",
  shape: "参数流向外部副作用的证据（E5）：ORM/链式/出站三类 sink，以及纯装配与工厂两类反例",
  files: {
    "src/effect.ts": `declare const repo: any;
declare const db: any;
declare const validateContent: any;
declare const StorageClient: any;
declare const storageService: any;
declare const bag: any[];

/** ① ORM 写入：repo.save —— 有副作用证据，且无校验 ⇒ 该报 */
export async function createWidget(input: any): Promise<void> {
  await repo.save(input);
}

/** ② 纯内存装配：push 进数组，无任何外部 sink ⇒ 不该报（本轮核心反例） */
export function addWidgetToCache(input: any): void {
  bag.push(input);
}

/** ③ 工厂：只构造并返回对象，参数没有流向任何 sink ⇒ 不该报 */
export function createStorageClient(options: any): any {
  return new StorageClient({ bucket: options.bucket });
}

/** ④ Kysely 链式写入：db.insertInto(...).values(...) —— S7 通道 ⇒ 该报 */
export async function createOrder(input: any): Promise<void> {
  await db.insertInto("orders").values(input).execute();
}

/** ⑤ HTTP 出站：fetch —— S3 通道 ⇒ 该报 */
export async function postMetric(input: any): Promise<void> {
  await fetch("https://collector.example.com/m", { method: "POST", body: input });
}

/** ⑥ 有副作用（storageService.upload）但已 validateContent ⇒ 校验位优先，不该报 */
export async function uploadDraft(input: any): Promise<void> {
  validateContent(input.name);
  await storageService.upload(input.path, input.body);
}
`,
    // ── sinks.ts：S1–S7 逐通道扩量（2026-09-23，验收要求 ≥20 条带 sink 形状）──
    // 原 F 族只有 3 条带 sink 的正例，承担不起盲测 −216 之后的证伪力。
    // 扩量原则：**每条通道至少一正**，且每条函数名都必须命中 trigger
    // （create|add|post|upload）—— 名字不命中 trigger 的「该报/不该报」是空过（R19）。
    // ⚠ 写语料时的坑：bodyHasExternalEffect 吃的是 node.getText()（**含注释**），
    //    注释里若出现 `save(` 这类「动词+括号」会被误判成有副作用。
    "src/sinks.ts": `declare const redis: any;
declare const fs: any;
declare const prisma: any;
declare const knex: any;
declare const queue: any;
declare const bus: any;
declare const s3Client: any;
declare const mailService: any;
declare const trx: any;
declare const userRepository: any;
declare const axios: any;
declare const validateContent: any;
declare const logger: any;
declare const app: any;
declare const z: any;
declare const repo: any;
declare const pkg: any;
declare const items: any[];

/** S2 缓存写入 ⇒ 该报 */
export async function addUserRole(roleId: any): Promise<void> {
  await redis.sadd("roles", roleId);
}

/** S4 文件系统写入 ⇒ 该报 */
export async function createAuditLog(entry: any): Promise<void> {
  await fs.writeFile("/var/log/audit.log", JSON.stringify(entry));
}

/** S6 prisma 写入 ⇒ 该报 */
export async function createAccountRow(input: any): Promise<void> {
  await prisma.user.create({ data: input });
}

/** S6 knex 写入 ⇒ 该报 */
export async function createTicket(input: any): Promise<void> {
  await knex("tickets").insert(input);
}

/** S3 消息投递 ⇒ 该报 */
export async function addEventToQueue(input: any): Promise<void> {
  await queue.publish("events", input);
}

/** S3 事件派发 ⇒ 该报 */
export async function postNotice(input: any): Promise<void> {
  await bus.dispatch(input);
}

/** S5 对象存储客户端 ⇒ 该报 */
export async function uploadAsset(input: any): Promise<void> {
  await s3Client.putObject({ Key: input.name, Body: input.body });
}

/** S5 委托给邮件服务 ⇒ 该报 */
export async function postWelcomeMail(input: any): Promise<void> {
  await mailService.send(input);
}

/** S7 Kysely 链式删除 ⇒ 该报 */
export async function createMemberRemoval(memberId: any): Promise<void> {
  await trx.deleteFrom("members").where("id", memberId).execute();
}

/** S5 委托给 repository ⇒ 该报 */
export async function createProfileUpdate(id: any, input: any): Promise<void> {
  await userRepository.update(id, input);
}

/** S2 带 TTL 的缓存写入 ⇒ 该报 */
export async function createSession(input: any): Promise<void> {
  await redis.setex("sess:" + input.id, 3600, JSON.stringify(input));
}

/** S3 HTTP 客户端 ⇒ 该报 */
export async function postWebhook(input: any): Promise<void> {
  await axios.post(input.url, input.payload);
}

/** 反例：工厂/驱动构造，只返回对象 ⇒ 无副作用 ⇒ 不该报（ducktors 形态） */
export function createLocalDriver(opts: any): any {
  return { type: "local", root: opts.root };
}

/** 反例：配置装配，只 push 到内存数组 ⇒ 不该报（verdaccio 形态） */
export function addPackageAccess(rule: any): void {
  pkg.access.push(rule);
}

/** 反例：只读查询，动词不在写入表内 ⇒ 不该报 */
export async function createWidgetPreview(id: any): Promise<any> {
  return repo.findById(id);
}

/** 反例：纯计算 ⇒ 不该报 */
export function createCartTotal(discount: any): number {
  return items.reduce((s, i) => s + i.price, 0) - discount;
}

/** 反例（边界）：派生日志子实例不是 sink ⇒ 不该报 */
export function createLogger(name: any): any {
  return logger.child({ name });
}

/** 反例（边界）：路由注册不是 sink ⇒ 不该报 */
export function addRoute(path: any, handler: any): void {
  app.get(path, handler);
}

/** 反例（边界）：构造校验 schema 不是 sink ⇒ 不该报 */
export function createWidgetSchema(): any {
  return z.object({ name: z.string(), price: z.number() });
}

/** 反例：有副作用（redis.sadd）但已 validateContent ⇒ 校验位优先 ⇒ 不该报 */
export async function createValidatedRole(input: any): Promise<void> {
  validateContent(input.name);
  await redis.sadd("roles", input.id);
}
`,
  },
  cases: [
    {
      fn: "createWidget",
      file: "effect.ts",
      have: ["input_effect"],
      reportRules: ["Input Validation"],
      why: "repo.save = ORM 写入，有副作用证据 ⇒ 仍该报（防止 requireMarker 变成无条件压制）",
    },
    {
      fn: "addWidgetToCache",
      file: "effect.ts",
      none: ["input_effect"],
      suppressRules: ["Input Validation"],
      why: "纯内存装配，参数不流向任何 sink ⇒ 不该报（本轮要压的主体）",
    },
    {
      fn: "createStorageClient",
      file: "effect.ts",
      none: ["input_effect"],
      suppressRules: ["Input Validation"],
      why: "工厂：只构造对象 ⇒ 不该报（FP 池里 ducktors createS3/createLocal 即此形态）",
    },
    {
      fn: "createOrder",
      file: "effect.ts",
      have: ["input_effect"],
      reportRules: ["Input Validation"],
      why: "Kysely 链式 insertInto —— S7 通道专项，防止链式判据退化丢真报",
    },
    {
      fn: "postMetric",
      file: "effect.ts",
      have: ["input_effect"],
      reportRules: ["Input Validation"],
      why: "fetch 出站 —— S3 通道专项",
    },
    {
      fn: "uploadDraft",
      file: "effect.ts",
      have: ["input_effect"],
      suppressRules: ["Input Validation"],
      why: "有副作用但已 validateContent ⇒ 校验位优先，不该报（两个机制不互相覆盖）",
    },
    // ── sinks.ts 扩量：S1–S7 逐通道正例（12 条）──────────────────────────────
    {
      fn: "addUserRole",
      file: "sinks.ts",
      have: ["input_effect"],
      reportRules: ["Input Validation"],
      why: "S2 缓存：redis.sadd ⇒ 该报",
    },
    {
      fn: "createAuditLog",
      file: "sinks.ts",
      have: ["input_effect"],
      reportRules: ["Input Validation"],
      why: "S4 文件：fs.writeFile ⇒ 该报",
    },
    {
      fn: "createAccountRow",
      file: "sinks.ts",
      have: ["input_effect"],
      reportRules: ["Input Validation"],
      why: "S6 prisma：prisma.user.create ⇒ 该报",
    },
    {
      fn: "createTicket",
      file: "sinks.ts",
      have: ["input_effect"],
      reportRules: ["Input Validation"],
      why: "S6 knex：knex('tickets').insert ⇒ 该报",
    },
    {
      fn: "addEventToQueue",
      file: "sinks.ts",
      have: ["input_effect"],
      reportRules: ["Input Validation"],
      why: "S3 投递：queue.publish ⇒ 该报",
    },
    {
      fn: "postNotice",
      file: "sinks.ts",
      have: ["input_effect"],
      reportRules: ["Input Validation"],
      why: "S3 派发：bus.dispatch ⇒ 该报",
    },
    {
      fn: "uploadAsset",
      file: "sinks.ts",
      have: ["input_effect"],
      reportRules: ["Input Validation"],
      why: "S5 客户端：s3Client.putObject ⇒ 该报（client 前缀专项）",
    },
    {
      fn: "postWelcomeMail",
      file: "sinks.ts",
      have: ["input_effect"],
      reportRules: ["Input Validation"],
      why: "S5 委托：mailService.send ⇒ 该报（service 前缀专项）",
    },
    {
      fn: "createMemberRemoval",
      file: "sinks.ts",
      have: ["input_effect"],
      reportRules: ["Input Validation"],
      why: "S7 链式：trx.deleteFrom ⇒ 该报（删除也是副作用）",
    },
    {
      fn: "createProfileUpdate",
      file: "sinks.ts",
      have: ["input_effect"],
      reportRules: ["Input Validation"],
      why: "S5 委托：userRepository.update ⇒ 该报（repository 前缀专项）",
    },
    {
      fn: "createSession",
      file: "sinks.ts",
      have: ["input_effect"],
      reportRules: ["Input Validation"],
      why: "S2 缓存：redis.setex ⇒ 该报",
    },
    {
      fn: "postWebhook",
      file: "sinks.ts",
      have: ["input_effect"],
      reportRules: ["Input Validation"],
      why: "S3 出站：axios.post ⇒ 该报（HTTP 客户端与 fetch 是两条路）",
    },
    // ── sinks.ts 扩量：反例（8 条）—— 无 sink / 边界形状 / 校验位优先 ──────────
    {
      fn: "createLocalDriver",
      file: "sinks.ts",
      none: ["input_effect"],
      suppressRules: ["Input Validation"],
      why: "工厂：只返回对象 ⇒ 不该报（FP 池 ducktors createLocal 真形态）",
    },
    {
      fn: "addPackageAccess",
      file: "sinks.ts",
      none: ["input_effect"],
      suppressRules: ["Input Validation"],
      why: "配置装配：push 到内存数组 ⇒ 不该报（FP 池 verdaccio addPackageAccess 真形态）",
    },
    {
      fn: "createWidgetPreview",
      file: "sinks.ts",
      none: ["input_effect"],
      suppressRules: ["Input Validation"],
      why: "只读查询：findById 动词不在写入表内 ⇒ 不该报（防 S1/S5 泛化）",
    },
    {
      fn: "createCartTotal",
      file: "sinks.ts",
      none: ["input_effect"],
      suppressRules: ["Input Validation"],
      why: "纯计算 ⇒ 不该报",
    },
    {
      fn: "createLogger",
      file: "sinks.ts",
      none: ["input_effect"],
      suppressRules: ["Input Validation"],
      why: "边界：派生日志子实例不是 sink ⇒ 不该报（logger 不在 S5 前缀表内）",
    },
    {
      fn: "addRoute",
      file: "sinks.ts",
      none: ["input_effect"],
      suppressRules: ["Input Validation"],
      why: "边界：路由注册不是 sink ⇒ 不该报（app.get 不落 S3 动词表）",
    },
    {
      fn: "createWidgetSchema",
      file: "sinks.ts",
      none: ["input_effect"],
      suppressRules: ["Input Validation"],
      why: "边界：构造校验 schema 不是 sink ⇒ 不该报",
    },
    {
      fn: "createValidatedRole",
      file: "sinks.ts",
      have: ["input_effect"],
      suppressRules: ["Input Validation"],
      why: "有副作用（redis.sadd）但已 validateContent ⇒ 校验位优先 ⇒ 不该报",
    },
  ],
};

export const WEB_PROJECTS: WebProject[] = [PROJECT_A, PROJECT_B, PROJECT_C, PROJECT_D, PROJECT_E, PROJECT_F];

const MARKER_TEXT: Record<Marker, string> = {
  auth_machinery: "__progmune_auth_machinery__",
  input_schema: "__progmune_input_schema__",
  input_guard: "__progmune_input_guard__",
  input_effect: "__progmune_input_effect__",
  path_traversal: "__progmune_path_traversal__",
};

function writeProject(p: WebProject): void {
  const dir = path.join(GEN_DIR, p.id);
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(path.join(dir, "tsconfig.json"), TSCONFIG);
  for (const [rel, content] of Object.entries(p.files)) {
    fs.writeFileSync(path.join(dir, rel), content);
  }
  console.log(`wrote ${p.id} → ${Object.keys(p.files).join(", ")}`);
}

if (require.main === module) {
  for (const p of WEB_PROJECTS) writeProject(p);

  // 期望表随语料一同落盘：唯一的真相是语料本身，避免手写 JSON 与语料漂移（R7）
  const expectations = {
    _comment:
      "由 generate-projects-webshape.ts 自动生成，请勿手改。标记口径见文件头；" +
      "have=必须出现，none=必须不出现，traversal=path_traversal 专属口径。",
    markers: MARKER_TEXT,
    projects: Object.fromEntries(
      WEB_PROJECTS.map((p) => [
        p.id,
        {
          shape: p.shape,
          cases: p.cases.map(({ fn, file, have, none, traversal, reportRules, suppressRules, why }) => ({
            fn,
            file,
            have,
            none,
            traversal,
            reportRules,
            suppressRules,
            why,
          })),
        },
      ])
    ),
  };
  fs.writeFileSync(EXPECT_PATH, JSON.stringify(expectations, null, 2) + "\n");
  console.log(`wrote ${path.basename(EXPECT_PATH)}（${WEB_PROJECTS.reduce((s, p) => s + p.cases.length, 0)} 条期望）`);
}
