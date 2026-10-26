/**
 * fr-019 定向回归：MCP 工具实参污点根 + containment 守卫净化
 * （REALWORLD_FIX_REGRESSION fr-019，PraisonAI CVE-2026-47394 / GHSA-9CR9-25Q5-8PRJ）
 *
 * 判据在 tools/extract_ir.py：
 * ① is_mcp_tool_function —— @register_tool("name") / @mcp.tool() / @tool
 *    装饰函数的形参是路径穿越污点根（MCP tools/call 实参由未认证调用方
 *    完全控制，与 HTTP request 同属不可信传输面；TS 侧 C 系列
 *    UNTRUSTED_ROOTS 的 Python 镜像）。
 * ② compute_guard_function_names —— 文件内函数体含 containment 证据
 *    （relative_to / is_relative_to / startswith("..") / in ("..", ".") /
 *    == ".."）的函数是守卫（tier-0），并向调用方有界传播 3 轮。
 * ③ is_tainted —— 污点流经守卫调用的结果视为已净化（调用点级，非文件级：
 *    同文件里另一个不调用守卫的 MCP 工具照报 —— fr-019 pre 的
 *    workflow_show 与 _resolve_rule_path 同文件的实测反例）。
 *
 * 三态门（fr-corpus 实测，2026-10-25）：pre 3 标记（workflow_validate /
 * workflow_show / deploy_validate）/ post 0；PyGoat 路径穿越 1/1 保持；
 * Python 盲测 90 项目零漂移。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { extractIRPython } from "./extract-ir-python";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fr019-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(rel: string, content: string) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

const MARKER = "__progmune_path_traversal__";

function marked(names: Array<{ name: string; calls?: string[] }>, name: string) {
  const f = names.find((x) => x.name === name);
  expect(f, `IR 里应有 ${name}`).toBeDefined();
  return f!.calls?.includes(MARKER) ?? false;
}

describe("fr-019 MCP 工具实参污点根（提取器标记）", () => {
  it("pre 形态：@register_tool 工具 file_path 形参直接 open() → 注入标记", () => {
    write("cli_tools.py", `
def register_tool(name):
    def deco(fn):
        return fn
    return deco

def register_cli_tools():
    @register_tool("praisonai.workflow.show")
    def workflow_show(file_path: str) -> str:
        with open(file_path, 'r') as f:
            return f.read()

    @register_tool("praisonai.workflow.validate")
    def workflow_validate(file_path: str) -> str:
        import yaml
        with open(file_path, 'r') as f:
            return yaml.safe_load(f)

    @register_tool("praisonai.deploy.validate")
    def deploy_validate(config_path: str = "deploy.yaml") -> str:
        with open(config_path, 'r') as f:
            return f.read()
`);
    const ir = extractIRPython(dir);
    expect(marked(ir, "workflow_show")).toBe(true);
    expect(marked(ir, "workflow_validate")).toBe(true);
    expect(marked(ir, "deploy_validate")).toBe(true);
  });

  it("@mcp.tool() / @tool 装饰形态同样注入标记", () => {
    write("server.py", `
from mcp.server.fastmcp import FastMCP
mcp = FastMCP("demo")

@mcp.tool()
def read_file(file_path: str) -> str:
    return open(file_path, 'r').read()

from langchain_core.tools import tool

@tool
def show_file(name: str) -> str:
    with open(name) as f:
        return f.read()
`);
    const ir = extractIRPython(dir);
    expect(marked(ir, "read_file")).toBe(true);
    expect(marked(ir, "show_file")).toBe(true);
  });

  it("post 形态：污点流经 containment 守卫调用 → 不注入标记（open 与 read_text 两形态）", () => {
    write("cli_tools.py", `
from pathlib import Path

def _resolve_cwd_yaml_path(file_path: str) -> "Path":
    if not isinstance(file_path, str) or not file_path:
        raise ValueError("file_path must be a non-empty string")
    if ("/" in file_path or "\\\\" in file_path
            or file_path.startswith(".") or file_path in ("..", ".")):
        raise ValueError(f"invalid file_path: {file_path!r}")
    base = Path.cwd().resolve()
    candidate = (base / file_path).resolve()
    try:
        candidate.relative_to(base)
    except ValueError as exc:
        raise ValueError(f"invalid file_path: {file_path!r}") from exc
    return candidate

def register_tool(name):
    def deco(fn):
        return fn
    return deco

def register_cli_tools():
    @register_tool("praisonai.workflow.show")
    def workflow_show(file_path: str) -> str:
        yaml_path = _resolve_cwd_yaml_path(file_path)
        return yaml_path.read_text()

    @register_tool("praisonai.workflow.validate")
    def workflow_validate(file_path: str) -> str:
        yaml_path = _resolve_cwd_yaml_path(file_path)
        with open(yaml_path, 'r') as f:
            return f.read()

    @register_tool("praisonai.deploy.validate")
    def deploy_validate(config_path: str = "deploy.yaml") -> str:
        yaml_path = _resolve_cwd_yaml_path(config_path)
        with open(yaml_path, 'r') as f:
            return f.read()
`);
    const ir = extractIRPython(dir);
    expect(marked(ir, "workflow_show")).toBe(false);
    expect(marked(ir, "workflow_validate")).toBe(false);
    expect(marked(ir, "deploy_validate")).toBe(false);
  });

  it("fr-019 pre 反例：同文件存在守卫函数，但工具不调用它 → 照报（调用点级而非文件级）", () => {
    write("cli_tools.py", `
import os
from pathlib import Path

def register_tool(name):
    def deco(fn):
        return fn
    return deco

def register_cli_tools():
    def _resolve_rule_path(rule_name: str):
        base = Path.home() / ".praison" / "rules"
        candidate = (base / rule_name).resolve()
        try:
            candidate.relative_to(base)
        except ValueError as exc:
            raise ValueError(f"invalid rule_name: {rule_name!r}") from exc
        return candidate

    @register_tool("praisonai.rules.get")
    def rule_get(rule_name: str) -> str:
        _, rule_path = _resolve_rule_path(rule_name)
        with open(rule_path, 'r') as f:
            return f.read()

    @register_tool("praisonai.workflow.show")
    def workflow_show(file_path: str) -> str:
        with open(file_path, 'r') as f:
            return f.read()
`);
    const ir = extractIRPython(dir);
    // 调用守卫的 rules 工具：净化，不报。
    expect(marked(ir, "rule_get")).toBe(false);
    // 不调用守卫的 workflow 工具：照报（fr-019 pre 的判别力来源）。
    expect(marked(ir, "workflow_show")).toBe(true);
  });

  it("负对照：无 MCP 装饰器的同名形态函数不注入标记（传输面声明根，不按名字猜）", () => {
    write("util.py", `
def workflow_show(file_path: str) -> str:
    with open(file_path, 'r') as f:
        return f.read()
`);
    const ir = extractIRPython(dir);
    expect(marked(ir, "workflow_show")).toBe(false);
  });

  it("HTTP request 根既有行为不变（request 形参仍照报）", () => {
    write("views.py", `
def serve(request):
    filename = request.GET['f']
    with open(filename) as f:
        return f.read()
`);
    const ir = extractIRPython(dir);
    expect(marked(ir, "serve")).toBe(true);
  });

  it("MCP 工具的常量路径参数不注入标记（污点必须来自形参）", () => {
    write("tools.py", `
import os

def register_tool(name):
    def deco(fn):
        return fn
    return deco

@register_tool("demo.todo.list")
def todo_list() -> str:
    todo_path = os.path.expanduser("~/.demo/todo.json")
    with open(todo_path, 'r') as f:
        return f.read()
`);
    const ir = extractIRPython(dir);
    expect(marked(ir, "todo_list")).toBe(false);
  });

  it("守卫传播：调用守卫函数的中间函数自身也算守卫（有界传播）", () => {
    write("cli_tools.py", `
from pathlib import Path

def _resolve_cwd_yaml_path(file_path: str) -> "Path":
    base = Path.cwd().resolve()
    candidate = (base / file_path).resolve()
    try:
        candidate.relative_to(base)
    except ValueError as exc:
        raise ValueError("outside") from exc
    return candidate

def _get_workflow_config(file_path: str):
    return _resolve_cwd_yaml_path(file_path)

def register_tool(name):
    def deco(fn):
        return fn
    return deco

@register_tool("demo.workflow.show")
def workflow_show(file_path: str) -> str:
    yaml_path = _get_workflow_config(file_path)
    with open(yaml_path, 'r') as f:
        return f.read()
`);
    const ir = extractIRPython(dir);
    expect(marked(ir, "workflow_show")).toBe(false);
  });
});
