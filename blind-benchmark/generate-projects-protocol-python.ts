/**
 * Blind Benchmark Python Protocol Project Generator v1.2
 *
 * 为 Python 协议盲测生成风格变体项目（generated-protocol-py/）。
 * 与 generate-projects-python.ts（缺陷检测基准）的区别：本基准测量的是
 * SSG 协议状态机路径（pre/post/invalidate/endState 校验），不是源码级检测规则。
 *
 * 语料网格：
 *   T0–T5 × S1–S5（30 项目）+ T6/T7 × S1–S4（8 项目）= 38 个项目。
 *   每 broken 项目植入 2 处同型违规（不同函数）。
 *
 * 违规分类学（对应 SSGRejection 语义）：
 *   T1 missing_precondition_builtin    内置规则路径（create_session pre=[TOKEN_ISSUED]）
 *   T2 missing_precondition_annotation 项目 @progmune 注解路径（P4.5 合并，generate_jwt pre=[PASSWORD_VERIFIED]）
 *   T3 use_after_revoke                invalidate 后重入（revoke_token → create_session）
 *   T4 use_after_close                 invalidate 后重入（close_file → read_file）
 *   T5 missing_cleanup                 endState（序列末尾资源未释放）
 *   T6 cross_function_precondition     P4.6 跨函数传播（helper 内违规，归因到入口 flow）
 *   T7 cross_function_cleanup          P4.6 跨函数资源泄漏（open 在 flow、read 在 helper）
 *
 * 风格变体：
 *   S1 linear 模块级直写 / S2 helpers 模块级 helper（app 调用）/
 *   S3 class 类方法 / S4 noisy 噪声穿插 /
 *   S5 renamed 无 @progmune 注解 + 改名协议函数（任意命名验证：
 *      词段匹配可覆盖的改名应检出；T2 依赖注解的约束应为文档化 FN）
 *
 * 入口模型（与生产 P4.6 一致）：违规流函数不被 app.py 调用（保持入口身份，
 * 独立验证）；清洁流由 app.py 编排（经 run 展开验证）；helper 片段并入入口
 * 展开序列，不再单独验证。
 *
 * Usage: npx ts-node blind-benchmark/generate-projects-protocol-python.ts
 */

import * as fs from "fs";
import * as path from "path";

export const GEN_DIR = path.resolve(__dirname, "generated-protocol-py");

// ═══════════════════════════════════════════════════════════════
// 违规分类学
// ═══════════════════════════════════════════════════════════════

export interface ViolationTypeDef {
  id: string;
  protocol: "auth" | "file";
  violationType: string;
  /** false = 当前协议层未实现该类检查（endState），金标统计单列 */
  detectionExpected: boolean;
  description: string;
  fixSuggestion: string;
}

export const VIOLATION_TYPES: ViolationTypeDef[] = [
  {
    id: "T0", protocol: "auth", violationType: "clean",
    detectionExpected: true,
    description: "清洁对照：完整认证链与文件链全部合规（含分离式清洁链）",
    fixSuggestion: "",
  },
  {
    id: "T1", protocol: "auth", violationType: "missing_precondition_builtin",
    detectionExpected: true,
    description: "create_session 之前无 generate_jwt（内置规则 pre=[TOKEN_ISSUED]）",
    fixSuggestion: "先签发令牌再建会话：generate_jwt → create_session",
  },
  {
    id: "T2", protocol: "auth", violationType: "missing_precondition_annotation",
    detectionExpected: true,
    description: "generate_jwt 之前无 verify_password（项目 @progmune 注解 pre=[PASSWORD_VERIFIED]，P4.5 合并路径）",
    fixSuggestion: "先验证密码：verify_password → generate_jwt",
  },
  {
    id: "T3", protocol: "auth", violationType: "use_after_revoke",
    detectionExpected: true,
    description: "revoke_token 之后再 create_session（TOKEN_ISSUED 已被 invalidate）",
    fixSuggestion: "撤销后重新走完整认证链",
  },
  {
    id: "T4", protocol: "file", violationType: "use_after_close",
    detectionExpected: true,
    description: "close_file 之后再 read_file（FILE_OPEN 已被 invalidate）",
    fixSuggestion: "关闭前完成读取，或重新打开句柄",
  },
  {
    id: "T5", protocol: "file", violationType: "missing_cleanup",
    detectionExpected: true,
    description: "open_file 之后无 close_file（endState 检查：序列末尾资源未释放）",
    fixSuggestion: "补 close_file 释放句柄",
  },
  {
    id: "T6", protocol: "auth", violationType: "cross_function_precondition",
    detectionExpected: true,
    description: "跨函数缺失前置：入口 flow 调用 helper，helper 内 generate_jwt 无 verify_password（P4.6 展开后归因到入口）",
    fixSuggestion: "在入口链上先 verify_password",
  },
  {
    id: "T7", protocol: "file", violationType: "cross_function_cleanup",
    detectionExpected: true,
    description: "跨函数资源泄漏：入口 flow 打开文件、helper 读取，链上无 close_file（P4.6 展开后 endState 检出）",
    fixSuggestion: "在链上补 close_file",
  },
];

// ═══════════════════════════════════════════════════════════════
// 风格变体（结构变体；S5 为命名变体）
// ═══════════════════════════════════════════════════════════════

export interface StyleDef {
  id: string;
  name: string;
  /** 流函数宿主：S1 模块级直写 / S2 模块级 helper（app 调用）/ S3 类方法 / S4 噪声穿插 */
  host: "linear" | "helpers" | "class" | "noisy";
  /** S5：改名 + 无 @progmune 注解（任意命名验证） */
  renamed?: boolean;
}

export const STYLES: StyleDef[] = [
  { id: "S1", name: "linear", host: "linear" },
  { id: "S2", name: "helpers", host: "helpers" },
  { id: "S3", name: "class", host: "class" },
  { id: "S4", name: "noisy", host: "noisy" },
  { id: "S5", name: "renamed", host: "linear", renamed: true },
];

/** S5 改名映射：协议函数名 → 非规范名（词段匹配可覆盖，见 ssg-bridge inferRuleName）。
 *  注意 create_session → create_active_session（而非 create_user_session）：
 *  create_user_session 是内置弱规则名，精确匹配会先于词段匹配命中，吞掉 TOKEN_ISSUED 约束。 */
export const RENAME_MAP: Record<string, string> = {
  verify_password: "verify_user_password",
  generate_jwt: "generate_user_jwt",
  create_session: "create_active_session",
  revoke_token: "revoke_user_token",
  logout: "terminate_user_session",
  open_file: "open_user_file",
  read_file: "read_user_file",
  write_file: "write_user_file",
  close_file: "close_user_file",
};

/** 植入记录——金标推导的种子（生成时确定，含精确 file/function 定位） */
export interface PlantRecord {
  projectId: string;
  typeId: string;
  styleId: string;
  file: string;
  function: string;
  protocol: "auth" | "file";
  violationType: string;
  detectionExpected: boolean;
  description: string;
  fixSuggestion: string;
}

// ═══════════════════════════════════════════════════════════════
// 模板：协议函数定义（@progmune 注解 = 项目本地协议；S5 无注解）
// ═══════════════════════════════════════════════════════════════

interface ProtoFnDef {
  name: string;
  ns: string;
  pre: string[];
  post: string[];
  inv?: string[];
  sig: string;
  body: string;
  purpose: string;
}

const AUTH_PREFIX = `"""Auth protocol — state machine functions."""

class PasswordHash:
    def verify(self, plain: str) -> bool:
        return plain == "secret"

class UserPayload:
    id: str
    role: str

class Token:
    value: str
    expires_at: int
`;

const AUTH_PROTO_FNS: ProtoFnDef[] = [
  {
    name: "verify_password", ns: "auth", pre: ["UNAUTHENTICATED"], post: ["PASSWORD_VERIFIED"],
    sig: "(plain: str, h: PasswordHash) -> bool",
    body: "    return h.verify(plain)",
    purpose: "verify user credentials",
  },
  {
    name: "generate_jwt", ns: "auth", pre: ["PASSWORD_VERIFIED"], post: ["TOKEN_ISSUED"], inv: ["PASSWORD_VERIFIED"],
    sig: "(payload: UserPayload) -> Token",
    body: "    return Token(value=\"jwt_x\", expires_at=9999999)",
    purpose: "issue authentication token",
  },
  {
    name: "create_session", ns: "auth", pre: ["TOKEN_ISSUED"], post: ["SESSION_ACTIVE"], inv: ["TOKEN_ISSUED"],
    sig: "(user: UserPayload, token: Token) -> dict",
    body: "    return {\"user\": user.id, \"token\": token.value, \"active\": True}",
    purpose: "establish active session",
  },
  {
    name: "revoke_token", ns: "auth", pre: ["TOKEN_ISSUED"], post: ["UNAUTHENTICATED"], inv: ["TOKEN_ISSUED"],
    sig: "(token: Token) -> None",
    body: "    pass",
    purpose: "revoke an issued token",
  },
  {
    name: "logout", ns: "auth", pre: ["SESSION_ACTIVE"], post: ["UNAUTHENTICATED"], inv: ["SESSION_ACTIVE"],
    sig: "(session: dict) -> None",
    body: "    pass",
    purpose: "terminate user session",
  },
];

const AUTH_NOISE = `
def compute_hash(data: str) -> str:
    """@purpose compute hash digest
    @tags stateless, crypto"""
    import hashlib
    return hashlib.sha256(data.encode()).hexdigest()

def log_event(data: str) -> bool:
    """@purpose audit logging
    @tags stateless, audit"""
    return len(data) > 0
`;

const FILE_PROTO_FNS: ProtoFnDef[] = [
  {
    name: "open_file", ns: "file", pre: [], post: ["FILE_OPEN"],
    sig: "(path: str) -> object",
    body: "    return open(path, \"r\")",
    purpose: "open file for reading",
  },
  {
    name: "read_file", ns: "file", pre: ["FILE_OPEN"], post: [],
    sig: "(handle: object) -> str",
    body: "    return handle.read()",
    purpose: "read file contents",
  },
  {
    name: "write_file", ns: "file", pre: ["FILE_OPEN"], post: [],
    sig: "(handle: object, data: str) -> None",
    body: "    handle.write(data)",
    purpose: "write data to file",
  },
  {
    name: "close_file", ns: "file", pre: ["FILE_OPEN"], post: [], inv: ["FILE_OPEN"],
    sig: "(handle: object) -> None",
    body: "    handle.close()",
    purpose: "close file handle",
  },
];

const FILE_NOISE = `
def compute_hash(data: str) -> str:
    """@purpose compute hash digest
    @tags stateless, crypto"""
    import hashlib
    return hashlib.sha256(data.encode()).hexdigest()
`;

/** 生成协议函数定义块（S5：改名 + 无注解） */
function genProtoDefs(fns: ProtoFnDef[], style: StyleDef): string {
  return fns.map((f) => {
    const name = style.renamed ? (RENAME_MAP[f.name] || f.name) : f.name;
    const pre = JSON.stringify(f.pre);
    const post = JSON.stringify(f.post);
    const inv = f.inv ? `, inv=${JSON.stringify(f.inv)}` : "";
    const ann = style.renamed
      ? ""
      : `@progmune(namespace="${f.ns}", pre=${pre}, post=${post}${inv})\n`;
    return `${ann}def ${name}${f.sig}:\n    """@purpose ${f.purpose}"""\n${f.body}`;
  }).join("\n\n");
}

function genAuthFileDefs(style: StyleDef): string {
  return `${AUTH_PREFIX}\n${genProtoDefs(AUTH_PROTO_FNS, style)}\n${AUTH_NOISE}`;
}

function genFileFileDefs(style: StyleDef): string {
  return `"""File protocol — state machine functions."""\n\n${genProtoDefs(FILE_PROTO_FNS, style)}\n${FILE_NOISE}`;
}

// ═══════════════════════════════════════════════════════════════
// 流函数：清洁链与违规链（入口函数体 + 可选 helper）
// ═══════════════════════════════════════════════════════════════

interface FlowDef {
  /** 函数名（无宿主前缀） */
  name: string;
  /** 函数体内按序调用的协议函数名（规范名，S5 渲染时改名） */
  calls: string[];
  /** @purpose 描述 */
  purpose: string;
  /** 被本流调用的项目 helper（其片段并入入口展开序列，不单独验证） */
  helper?: { name: string; calls: string[]; purpose: string };
}

const CLEAN_AUTH_FLOWS: FlowDef[] = [
  { name: "handle_login", calls: ["verify_password", "generate_jwt", "create_session", "logout"], purpose: "full login flow" },
  { name: "handle_issue", calls: ["verify_password", "generate_jwt"], purpose: "issue token flow" },
  {
    name: "safe_login", calls: ["verify_password", "mint_token_c"], purpose: "split-clean login (verify in flow, issue in helper)",
    helper: { name: "mint_token_c", calls: ["generate_jwt"], purpose: "helper issuing token" },
  },
];

const CLEAN_FILE_FLOWS: FlowDef[] = [
  { name: "handle_file", calls: ["open_file", "read_file", "close_file"], purpose: "read file flow" },
  { name: "handle_write", calls: ["open_file", "write_file", "close_file"], purpose: "write file flow" },
  {
    name: "safe_read", calls: ["open_file", "fetch_and_close"], purpose: "split-clean read (open in flow, read+close in helper)",
    helper: { name: "fetch_and_close", calls: ["read_file", "close_file"], purpose: "helper reading and closing" },
  },
];

function brokenFlows(t: ViolationTypeDef): FlowDef[] {
  switch (t.id) {
    case "T1":
      return [
        { name: "issue_session", calls: ["create_session"], purpose: "create session without token" },
        { name: "start_checkout", calls: ["create_session"], purpose: "checkout session without token" },
      ];
    case "T2":
      return [
        { name: "quick_login", calls: ["generate_jwt"], purpose: "issue token without password check" },
        { name: "silent_login", calls: ["generate_jwt"], purpose: "silent token issue" },
      ];
    case "T3":
      return [
        { name: "token_cycle", calls: ["verify_password", "generate_jwt", "revoke_token", "create_session"], purpose: "reuse session after revocation" },
        { name: "token_renew", calls: ["verify_password", "generate_jwt", "revoke_token", "create_session"], purpose: "renew token then re-create session" },
      ];
    case "T4":
      return [
        { name: "peek_file", calls: ["open_file", "close_file", "read_file"], purpose: "read after close" },
        { name: "tail_file", calls: ["open_file", "close_file", "read_file"], purpose: "tail after close" },
      ];
    case "T5":
      return [
        { name: "read_config_only", calls: ["open_file", "read_file"], purpose: "read config without closing" },
        { name: "read_log_only", calls: ["open_file", "read_file"], purpose: "read log without closing" },
      ];
    case "T6":
      return [
        {
          name: "mint_flow_a", calls: ["mint_token_a"], purpose: "flow minting token without verification",
          helper: { name: "mint_token_a", calls: ["generate_jwt"], purpose: "helper issuing token" },
        },
        {
          name: "mint_flow_b", calls: ["mint_token_b"], purpose: "second flow minting without verification",
          helper: { name: "mint_token_b", calls: ["generate_jwt"], purpose: "helper issuing token" },
        },
      ];
    case "T7":
      return [
        {
          name: "read_flow_a", calls: ["open_file", "fetch_data_a"], purpose: "flow opening file then reading via helper",
          helper: { name: "fetch_data_a", calls: ["read_file"], purpose: "helper reading open handle" },
        },
        {
          name: "read_flow_b", calls: ["open_file", "fetch_data_b"], purpose: "second flow same shape",
          helper: { name: "fetch_data_b", calls: ["read_file"], purpose: "helper reading open handle" },
        },
      ];
    default:
      return [];
  }
}

/** 渲染函数体（S4 噪声穿插；S5 改名——switch 按规范名匹配，发射时改名） */
function genFlowBody(flow: FlowDef, style: StyleDef): string {
  const noise = (i: number): string =>
    i % 2 === 0 ? `    compute_hash("x${i}")` : `    log_event("y${i}")`;

  if (style.host === "noisy") {
    const lines: string[] = [];
    flow.calls.forEach((c, i) => {
      if (i > 0) lines.push(noise(i));
      lines.push(renderCall(c, flow, i, style));
    });
    lines.push(noise(flow.calls.length + 1));
    return lines.join("\n");
  }
  return flow.calls.map((c, i) => renderCall(c, flow, i, style)).join("\n");
}

function renderCall(c: string, flow: FlowDef, i: number, style: StyleDef): string {
  const n = (x: string) => (style.renamed ? (RENAME_MAP[x] || x) : x);
  switch (c) {
    case "verify_password": return `    ok = ${n("verify_password")}("secret", PasswordHash())`;
    case "generate_jwt": return `    tok = ${n("generate_jwt")}(UserPayload())`;
    case "create_session": return `    sess = ${n("create_session")}(UserPayload(), tok)`;
    case "revoke_token": return `    ${n("revoke_token")}(tok)`;
    case "logout": return `    ${n("logout")}(sess)`;
    case "open_file": return `    fh = ${n("open_file")}("data_${i}.txt")`;
    case "read_file": return `    data = ${n("read_file")}(fh)`;
    case "write_file": return `    ${n("write_file")}(fh, "payload")`;
    case "close_file": return `    ${n("close_file")}(fh)`;
    default: return `    ${c}()`; // helper 调用（如 mint_token_a，不参与改名）
  }
}

/** 生成 helper 定义（模块级私有函数，S5 时其体内协议调用同样改名） */
function genHelperDefs(flows: FlowDef[], style: StyleDef): string {
  return flows
    .filter((f) => f.helper)
    .map((f) => {
      const h = f.helper!;
      const helperFlow: FlowDef = { name: h.name, calls: h.calls, purpose: h.purpose };
      return `def ${h.name}() -> None:\n    """@purpose ${h.purpose}"""\n${genFlowBody(helperFlow, style)}`;
    })
    .join("\n\n");
}

/** 宿主包装：S1 模块级 / S2 helper + app 调用 / S3 类方法 */
function genFlowFunctions(flows: FlowDef[], style: StyleDef): {
  code: string;
  /** IR 里的函数名（类方法含类前缀，如 FlowService.svc_x） */
  fnName: (n: string) => string;
  /** app.py 里的调用表达式 */
  appCall: (n: string) => string;
} {
  const helperCode = genHelperDefs(flows, style);
  switch (style.host) {
    case "helpers": {
      const parts = flows.map((f) =>
        `def _do_${f.name}() -> None:\n    """@purpose ${f.purpose}"""\n${genFlowBody(f, style)}\n`);
      return { code: `${helperCode}\n\n${parts.join("\n")}`, fnName: (n) => `_do_${n}`, appCall: (n) => `_do_${n}()` };
    }
    case "class": {
      const authPart = flows.map((f) =>
        `    def svc_${f.name}(self) -> None:\n        """@purpose ${f.purpose}"""\n${indent(genFlowBody(f, style), 4)}\n`);
      return {
        code: `${helperCode}\n\nclass FlowService:\n${authPart.join("\n")}`,
        fnName: (n) => `FlowService.svc_${n}`,
        appCall: (n) => `FlowService().svc_${n}()`,
      };
    }
    default: {
      const parts = flows.map((f) =>
        `def ${f.name}() -> None:\n    """@purpose ${f.purpose}"""\n${genFlowBody(f, style)}\n`);
      return { code: `${helperCode}\n\n${parts.join("\n")}`, fnName: (n) => n, appCall: (n) => `${n}()` };
    }
  }
}

function indent(s: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return s.split("\n").map((l) => (l.trim() ? pad + l : l)).join("\n");
}

// ═══════════════════════════════════════════════════════════════
// 项目生成
// ═══════════════════════════════════════════════════════════════

export function generateProtocolProject(
  projectId: string,
  type: ViolationTypeDef,
  style: StyleDef,
  outDir: string,
): PlantRecord[] {
  const plants: PlantRecord[] = [];
  const projectDir = path.join(outDir, projectId);
  fs.mkdirSync(projectDir, { recursive: true });

  // auth.py / files.py：一个放违规链（按类型的 protocol），另一个放清洁链
  const brokenAuth = type.protocol === "auth" && type.id !== "T0" ? brokenFlows(type) : [];
  const brokenFile = type.protocol === "file" && type.id !== "T0" ? brokenFlows(type) : [];
  const authFlows = brokenAuth.length > 0 ? brokenAuth : CLEAN_AUTH_FLOWS;
  const fileFlows = brokenFile.length > 0 ? brokenFile : CLEAN_FILE_FLOWS;

  const auth = genFlowFunctions(authFlows, style);
  const files = genFlowFunctions(fileFlows, style);

  fs.writeFileSync(path.join(projectDir, "auth.py"),
    `${genAuthFileDefs(style)}\n${auth.code}\n`, "utf-8");
  fs.writeFileSync(path.join(projectDir, "files.py"),
    `${genFileFileDefs(style)}\n${files.code}\n`, "utf-8");

  // app.py：只编排清洁流（违规流保持入口身份独立验证；helper 流不编排——
  // 其片段并入入口展开序列）。run() 展开后仍为清洁链。
  const brokenNames = new Set([...brokenAuth, ...brokenFile].map((f) => f.name));
  const appFlows = [...authFlows, ...fileFlows].filter((f) => !f.helper && !brokenNames.has(f.name));
  const appCalls = [
    ...authFlows.filter((f) => appFlows.includes(f)).map((f) => `    ${auth.appCall(f.name)}`),
    ...fileFlows.filter((f) => appFlows.includes(f)).map((f) => `    ${files.appCall(f.name)}`),
  ];
  fs.writeFileSync(path.join(projectDir, "app.py"),
    `"""Entry point — orchestration only."""\n\nfrom auth import *  # noqa\nfrom files import *  # noqa\n\ndef run() -> None:\n    """@purpose run all clean flows"""\n${appCalls.join("\n") || "    pass"}\n`, "utf-8");

  // 金标种子：只记录违规流函数
  for (const f of [...brokenAuth, ...brokenFile]) {
    const hostFile = brokenAuth.length > 0 ? "auth.py" : "files.py";
    const host = brokenAuth.length > 0 ? auth.fnName : files.fnName;
    plants.push({
      projectId,
      typeId: type.id,
      styleId: style.id,
      file: hostFile,
      function: host(f.name),
      protocol: type.protocol,
      violationType: type.violationType,
      detectionExpected: type.detectionExpected,
      description: type.description,
      fixSuggestion: type.fixSuggestion,
    });
  }
  return plants;
}

// ═══════════════════════════════════════════════════════════════
// Main：全网格生成
// ═══════════════════════════════════════════════════════════════

function main(): void {
  fs.mkdirSync(GEN_DIR, { recursive: true });
  const allPlants: PlantRecord[] = [];

  for (const type of VIOLATION_TYPES) {
    // S5（改名无注解）只覆盖基础类型——T6/T7 依赖注解路径，不叠加命名变体
    const styles = (type.id === "T6" || type.id === "T7")
      ? STYLES.filter((s) => !s.renamed)
      : STYLES;
    for (const style of styles) {
      const projectId = `proto_${type.id}_${style.id}`;
      allPlants.push(...generateProtocolProject(projectId, type, style, GEN_DIR));
    }
  }

  fs.writeFileSync(
    path.join(GEN_DIR, "_plants.json"),
    JSON.stringify({ generated_at: new Date().toISOString(), plants: allPlants }, null, 2),
    "utf-8",
  );

  const counts = new Map<string, number>();
  for (const p of allPlants) counts.set(p.typeId, (counts.get(p.typeId) || 0) + 1);
  console.log(`生成完成：${VIOLATION_TYPES.length * STYLES.length - 2} 个项目，${allPlants.length} 处植入`);
  for (const [t, n] of [...counts.entries()].sort()) {
    const def = VIOLATION_TYPES.find((v) => v.id === t)!;
    console.log(`  ${t} ${def.violationType}${def.detectionExpected ? "" : "（已知缺口）"}: ${n}`);
  }
}

if (require.main === module) main();
