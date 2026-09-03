#!/usr/bin/env python3
"""
FastAPI Framework Structure Extractor — 框架结构扫描（与 extract_ir.py 解耦）

Progmune 框架适配 M1：从 Python AST 提取 FastAPI 结构——
路由（@app.get/@router.post 等）、处理器依赖注入（Depends()/Security()）、
认证方案声明（OAuth2PasswordBearer/HTTPBearer/APIKeyHeader）、全局中间件。

输出 JSON：
{
  "hasFastAPI": bool,
  "apps": [{"name","file"}],
  "routers": [{"name","file"}],
  "authSchemes": [{"name","type"}],
  "globalAuthMiddleware": [names...],
  "routes": [{
     "method","path","handler","file","line",
     "dependencies": [{"name","via","authLike"}],
  }],
  "filesScanned": int
}

用法：python3 extract_framework_py.py <projectRoot> <outJson>
"""

import ast
import json
import os
import sys

# 认证词表（依赖函数名命中即视为 auth-like；与 TS 侧 annotation-suggest 词表同源）
# 注意：扫描器只做「结构提取」，规则判定（豁免词/方法门控）在 TS 检测器侧。
# 注意：不含裸 "user"——get_profile_by_username_from_path 等 DB 查询
# 依赖名含 user 会被误标认证（REALWORLD_STRUCTURAL_V2 假保护 FN）。
# 真认证依赖用 current_user/authorizer 等强词识别（get_current_user
# 含 current_user ✓）。
AUTH_WORDS = (
    "auth", "login", "token", "credential", "session",
    "bearer", "permission", "current_user", "api_key", "oauth", "jwt",
)

SKIP_DIRS = {"tests", "test", "deps", "venv", "env", "node_modules", "vendor",
             ".git", "migrations", "__pycache__", "scripts", "docs"}

ROUTE_DECORATORS = {"get", "post", "put", "delete", "patch", "head", "options",
                    "websocket", "api_route"}

SCHEME_CLASSES = {
    "OAuth2PasswordBearer": "OAuth2PasswordBearer",
    "OAuth2AuthorizationCodeBearer": "OAuth2AuthorizationCodeBearer",
    "HTTPBearer": "HTTPBearer",
    "HTTPBasic": "HTTPBasic",
    "HTTPDigest": "HTTPDigest",
    "APIKeyHeader": "APIKeyHeader",
    "APIKeyQuery": "APIKeyQuery",
    "APIKeyCookie": "APIKeyCookie",
    "OpenIdConnect": "OpenIdConnect",
}


def name_of(node):
    """ast 名字解析（Name/Attribute/Subscript 兼容）"""
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    return None


def lower_name(name):
    return name.lower() if name else ""


def is_auth_like(name, schemes):
    """依赖名是否为认证依赖：命中认证词表，或直接是声明的认证方案"""
    if not name:
        return False
    if name in schemes:
        return True
    ln = lower_name(name)
    return any(w in ln for w in AUTH_WORDS)


def resolve_dep_target(node):
    """Depends(x) 的 x：Name/Attribute 直取；嵌套 Call（如 get_current_user_authorizer()）取内层函数名"""
    if isinstance(node, (ast.Name, ast.Attribute)):
        return name_of(node)
    if isinstance(node, ast.Call):
        return name_of(node.func)
    return None


def iter_dependency_calls(node):
    """从签名节点收集 Depends(...)/Security(...) 调用（含 Annotated[...] 订阅）"""
    found = []
    for child in ast.walk(node):
        # Depends(x) / Security(x)
        if isinstance(child, ast.Call) and isinstance(child.func, ast.Name):
            if child.func.id in ("Depends", "Security") and child.args:
                found.append((resolve_dep_target(child.args[0]), child.func.id))
        # Annotated[X, Depends(y)]
        if isinstance(child, ast.Subscript):
            for item in child.slice.elts if isinstance(child.slice, ast.Tuple) else [child.slice]:
                if isinstance(item, ast.Call) and isinstance(item.func, ast.Name):
                    if item.func.id in ("Depends", "Security") and item.args:
                        found.append((resolve_dep_target(item.args[0]), item.func.id))
    return found


class Scanner(ast.NodeVisitor):
    def __init__(self, filepath):
        self.file = filepath
        self.apps = []
        self.routers = []
        self.schemes = {}
        self.middlewares = []
        self.routes = []
        self._decorator_targets = {}  # name -> {method,path} 列表

    def visit_Assign(self, node):
        if len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            v = node.value
            if isinstance(v, ast.Call) and isinstance(v.func, ast.Name):
                fn = v.func.id
                if fn == "FastAPI":
                    self.apps.append(node.targets[0].id)
                elif fn == "APIRouter":
                    self.routers.append(node.targets[0].id)
                elif fn in SCHEME_CLASSES:
                    self.schemes[node.targets[0].id] = SCHEME_CLASSES[fn]
        self.generic_visit(node)

    def visit_Expr(self, node):
        # app.add_middleware(...) 是 Expr(Call(Attribute(app, add_middleware)))
        v = node.value
        if (isinstance(v, ast.Call) and isinstance(v.func, ast.Attribute)
                and v.func.attr == "add_middleware" and v.args
                and isinstance(v.args[0], ast.Name)):
            self.middlewares.append(v.args[0].id)
        self.generic_visit(node)

    def visit_FunctionDef(self, node):
        self._scan_decorated(node, is_async=False)
        self.generic_visit(node)

    def visit_AsyncFunctionDef(self, node):
        self._scan_decorated(node, is_async=True)
        self.generic_visit(node)

    def _scan_decorated(self, node, is_async):
        for dec in node.decorator_list:
            # @app.get("/path") / @router.post(...) / @r.api_route(...)
            if (isinstance(dec, ast.Call) and isinstance(dec.func, ast.Attribute)
                    and dec.func.attr in ROUTE_DECORATORS):
                target = name_of(dec.func.value)
                method = dec.func.attr
                path = dec.args[0].value if dec.args and isinstance(dec.args[0], ast.Constant) else ""
                deps = iter_dependency_calls(node.args)
                # 装饰器级 dependencies=[Depends(...)]（realworld 风格：
                # @router.put(..., dependencies=[Depends(check_permissions)]）
                for kw in dec.keywords:
                    if kw.arg == "dependencies" and isinstance(kw.value, ast.List):
                        for item in kw.value.elts:
                            if isinstance(item, ast.Call) and isinstance(item.func, ast.Name):
                                if item.func.id in ("Depends", "Security") and item.args:
                                    deps.append((resolve_dep_target(item.args[0]), item.func.id))
                auth_like = [
                    {"name": d[0], "via": d[1],
                     "authLike": is_auth_like(d[0], self.schemes)}
                    for d in deps
                ]
                self.routes.append({
                    "method": method,
                    "path": path,
                    "handler": node.name,
                    "file": self.file,
                    "line": node.lineno,
                    "dependencies": auth_like,
                })


def scan_file(filepath):
    try:
        with open(filepath, "r", encoding="utf-8", errors="replace") as f:
            tree = ast.parse(f.read(), filename=filepath)
    except (SyntaxError, UnicodeDecodeError, OSError):
        return None
    scanner = Scanner(filepath)
    scanner.visit(tree)
    return scanner


def walk_py_files(root):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            if fn.endswith(".py") and not fn.startswith("test_"):
                yield os.path.join(dirpath, fn)


def main():
    root = sys.argv[1]
    out = sys.argv[2]
    apps, routers, schemes, middlewares, routes = [], [], {}, [], []
    files_scanned = 0
    for fp in walk_py_files(root):
        files_scanned += 1
        sc = scan_file(fp)
        if not sc:
            continue
        apps.extend(sc.apps)
        routers.extend(sc.routers)
        schemes.update(sc.schemes)
        middlewares.extend(sc.middlewares)
        routes.extend(sc.routes)

    # 路由处理器名去重（同文件同名函数只记一次）
    seen = set()
    unique_routes = []
    for r in routes:
        key = (r["file"], r["handler"], r["method"], r["path"])
        if key in seen:
            continue
        seen.add(key)
        unique_routes.append(r)

    result = {
        "hasFastAPI": bool(apps or routers),
        "apps": sorted(set(apps)),
        "routers": sorted(set(routers)),
        "authSchemes": [{"name": n, "type": t} for n, t in schemes.items()],
        "globalAuthMiddleware": sorted(set(middlewares)),
        "routes": unique_routes,
        "filesScanned": files_scanned,
    }
    with open(out, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
