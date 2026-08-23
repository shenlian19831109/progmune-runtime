/**
 * Blind Benchmark Python Protocol Project Generator v1
 *
 * 为 Python 协议盲测生成风格变体项目（generated-protocol-py/）。
 * 与 generate-projects-python.ts（缺陷检测基准）的区别：本基准测量的是
 * SSG 协议状态机路径（pre/post/invalidate 链校验），不是源码级检测规则。
 *
 * 语料网格：VIOLATION_TYPES (T0–T5) × STYLES (S1–S4) = 24 个项目。
 *   T0 clean 对照 ×4；T1–T5 每类 ×4，每项目植入 2 处同型违规。
 *
 * 违规分类学（对应 SSGRejection 语义）：
 *   T1 missing_precondition_builtin    内置规则路径（create_session pre=[TOKEN_ISSUED]）
 *   T2 missing_precondition_annotation 项目 @progmune 注解路径（P4.5 合并，generate_jwt pre=[PASSWORD_VERIFIED]）
 *   T3 use_after_revoke                invalidate 后重入（revoke_token → create_session）
 *   T4 use_after_close                 invalidate 后重入（close_file → read_file）
 *   T5 missing_cleanup                 endState 检查未实现——已知缺口（detectionExpected=false）
 *
 * 植入的违规链全部落在单个函数体内（当前协议层按 per-function 序列验证，
 * 跨函数状态传播未实现——与 C 的 L3 同类边界，报告里如实记录）。
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
    description: "清洁对照：完整认证链与文件链全部合规",
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
    detectionExpected: false,
    description: "open_file 之后无 close_file（endState 检查未实现——已知缺口）",
    fixSuggestion: "补 close_file 释放句柄",
  },
];

// ═══════════════════════════════════════════════════════════════
// 风格变体（结构变体，协议函数名保持规范 snake_case）
// ═══════════════════════════════════════════════════════════════

export interface StyleDef {
  id: string;
  name: string;
  /** 流函数宿主：S1 模块级直写 / S2 模块级 helper（app 调用）/ S3 类方法 / S4 噪声穿插 */
  host: "linear" | "helpers" | "class" | "noisy";
}

export const STYLES: StyleDef[] = [
  { id: "S1", name: "linear", host: "linear" },
  { id: "S2", name: "helpers", host: "helpers" },
  { id: "S3", name: "class", host: "class" },
  { id: "S4", name: "noisy", host: "noisy" },
];

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
// 模板：协议函数定义（@progmune 注解 = 项目本地协议）
// ═══════════════════════════════════════════════════════════════

const AUTH_DEFS = `"""Auth protocol — @progmune annotated state machine."""

class PasswordHash:
    def verify(self, plain: str) -> bool:
        return plain == "secret"

class UserPayload:
    id: str
    role: str

class Token:
    value: str
    expires_at: int

@progmune(namespace="auth", pre=["UNAUTHENTICATED"], post=["PASSWORD_VERIFIED"])
def verify_password(plain: str, h: PasswordHash) -> bool:
    """@purpose verify user credentials
    @requires plain password and stored hash
    @produces verification result"""
    return h.verify(plain)

@progmune(namespace="auth", pre=["PASSWORD_VERIFIED"], post=["TOKEN_ISSUED"], inv=["PASSWORD_VERIFIED"])
def generate_jwt(payload: UserPayload) -> Token:
    """@purpose issue authentication token
    @requires verified password
    @produces JWT token"""
    return Token(value="jwt_x", expires_at=9999999)

@progmune(namespace="auth", pre=["TOKEN_ISSUED"], post=["SESSION_ACTIVE"], inv=["TOKEN_ISSUED"])
def create_session(user: UserPayload, token: Token) -> dict:
    """@purpose establish active session
    @requires issued token
    @produces active session"""
    return {"user": user.id, "token": token.value, "active": True}

@progmune(namespace="auth", pre=["TOKEN_ISSUED"], post=["UNAUTHENTICATED"], inv=["TOKEN_ISSUED"])
def revoke_token(token: Token) -> None:
    """@purpose revoke an issued token
    @requires issued token"""
    pass

@progmune(namespace="auth", pre=["SESSION_ACTIVE"], post=["UNAUTHENTICATED"], inv=["SESSION_ACTIVE"])
def logout(session: dict) -> None:
    """@purpose terminate user session
    @requires active session"""
    pass

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

const FILE_DEFS = `"""File protocol — @progmune annotated state machine."""

@progmune(namespace="file", pre=[], post=["FILE_OPEN"])
def open_file(path: str) -> object:
    """@purpose open file for reading
    @produces file handle"""
    return open(path, "r")

@progmune(namespace="file", pre=["FILE_OPEN"], post=[])
def read_file(handle: object) -> str:
    """@purpose read file contents
    @requires open handle"""
    return handle.read()

@progmune(namespace="file", pre=["FILE_OPEN"], post=[])
def write_file(handle: object, data: str) -> None:
    """@purpose write data to file
    @requires open handle"""
    handle.write(data)

@progmune(namespace="file", pre=["FILE_OPEN"], post=[], inv=["FILE_OPEN"])
def close_file(handle: object) -> None:
    """@purpose close file handle
    @requires open handle"""
    handle.close()

def compute_hash(data: str) -> str:
    """@purpose compute hash digest
    @tags stateless, crypto"""
    import hashlib
    return hashlib.sha256(data.encode()).hexdigest()
`;

// ═══════════════════════════════════════════════════════════════
// 流函数：清洁链与违规链（单函数体内自包含）
// ═══════════════════════════════════════════════════════════════

interface FlowDef {
  /** 函数名（无宿主前缀） */
  name: string;
  /** 函数体内按序调用的协议函数名 */
  calls: string[];
  /** @purpose 描述 */
  purpose: string;
  noise?: boolean;
}

const CLEAN_AUTH_FLOWS: FlowDef[] = [
  { name: "handle_login", calls: ["verify_password", "generate_jwt", "create_session", "logout"], purpose: "full login flow" },
  { name: "handle_issue", calls: ["verify_password", "generate_jwt"], purpose: "issue token flow" },
];

const CLEAN_FILE_FLOWS: FlowDef[] = [
  { name: "handle_file", calls: ["open_file", "read_file", "close_file"], purpose: "read file flow" },
  { name: "handle_write", calls: ["open_file", "write_file", "close_file"], purpose: "write file flow" },
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
    default:
      return [];
  }
}

/** 生成函数体（S4 在协议调用间穿插噪声调用；噪声函数无规则 → 序列内容不变） */
function genFlowBody(flow: FlowDef, style: StyleDef): string {
  const noise = (i: number): string =>
    i % 2 === 0 ? `    compute_hash("x${i}")` : `    log_event("y${i}")`;

  if (style.host === "noisy") {
    const lines: string[] = [];
    flow.calls.forEach((c, i) => {
      if (i > 0) lines.push(noise(i));
      lines.push(renderCall(c, flow, i));
    });
    lines.push(noise(flow.calls.length + 1));
    return lines.join("\n");
  }
  return flow.calls.map((c, i) => renderCall(c, flow, i)).join("\n");
}

function renderCall(c: string, flow: FlowDef, i: number): string {
  switch (c) {
    case "verify_password": return `    ok = verify_password("secret", PasswordHash())`;
    case "generate_jwt": return `    tok = generate_jwt(UserPayload())`;
    case "create_session": return `    sess = create_session(UserPayload(), tok)`;
    case "revoke_token": return `    revoke_token(tok)`;
    case "logout": return `    logout(sess)`;
    case "open_file": return `    fh = open_file("data_${i}.txt")`;
    case "read_file": return `    data = read_file(fh)`;
    case "write_file": return `    write_file(fh, "payload")`;
    case "close_file": return `    close_file(fh)`;
    default: return `    ${c}()`;
  }
}

/** 宿主包装：S1 模块级 / S2 helper + app 调用 / S3 类方法 */
function genFlowFunctions(flows: FlowDef[], style: StyleDef): {
  code: string;
  /** IR 里的函数名（类方法含类前缀，如 FlowService.svc_x） */
  fnName: (n: string) => string;
  /** app.py 里的调用表达式 */
  appCall: (n: string) => string;
} {
  switch (style.host) {
    case "helpers": {
      const parts = flows.map((f) =>
        `def _do_${f.name}() -> None:\n    """@purpose ${f.purpose}"""\n${genFlowBody(f, style)}\n`);
      return { code: parts.join("\n"), fnName: (n) => `_do_${n}`, appCall: (n) => `_do_${n}()` };
    }
    case "class": {
      const authPart = flows.map((f) =>
        `    def svc_${f.name}(self) -> None:\n        """@purpose ${f.purpose}"""\n${indent(genFlowBody(f, style), 4)}\n`);
      return {
        code: `class FlowService:\n${authPart.join("\n")}`,
        fnName: (n) => `FlowService.svc_${n}`,
        appCall: (n) => `FlowService().svc_${n}()`,
      };
    }
    default: {
      const parts = flows.map((f) =>
        `def ${f.name}() -> None:\n    """@purpose ${f.purpose}"""\n${genFlowBody(f, style)}\n`);
      return { code: parts.join("\n"), fnName: (n) => n, appCall: (n) => `${n}()` };
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
    `${AUTH_DEFS}\n${auth.code}\n`, "utf-8");
  fs.writeFileSync(path.join(projectDir, "files.py"),
    `${FILE_DEFS}\n${files.code}\n`, "utf-8");

  // app.py：编排调用（per-function 序列验证不展开跨函数调用，无规则函数被跳过）
  const appCalls = [
    ...authFlows.map((f) => `    ${auth.appCall(f.name)}`),
    ...fileFlows.map((f) => `    ${files.appCall(f.name)}`),
  ];
  fs.writeFileSync(path.join(projectDir, "app.py"),
    `"""Entry point — orchestration only."""\n\nfrom auth import *  # noqa\nfrom files import *  # noqa\n\ndef run() -> None:\n    """@purpose run all flows"""\n${appCalls.join("\n")}\n`, "utf-8");

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
    for (const style of STYLES) {
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
  console.log(`生成完成：${VIOLATION_TYPES.length * STYLES.length} 个项目，${allPlants.length} 处植入`);
  for (const [t, n] of [...counts.entries()].sort()) {
    const def = VIOLATION_TYPES.find((v) => v.id === t)!;
    console.log(`  ${t} ${def.violationType}${def.detectionExpected ? "" : "（已知缺口）"}: ${n}`);
  }
}

if (require.main === module) main();
