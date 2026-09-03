#!/usr/bin/env python3
"""
Flask Framework Structure Extractor — 框架结构扫描（第 5 个框架适配）

从 Python AST 提取 Flask 结构：
  1) 应用与蓝图：app = Flask(...) / bp = Blueprint(...) / register_blueprint
  2) 路由：@app.route("/x", methods=[...]) / @bp.route(...) → handler 函数
  3) 认证信号：
     - handler 装饰器：login_required / permission_required / 自定义 *auth* 名
     - 全局守卫：app.before_request(auth_fn) / bp.before_request(auth_fn)，
       auth_fn 名命中认证词表
  4) 路由方法：methods kwarg（缺省 = GET only）

输出 JSON：{hasFlask, apps, blueprints, routes:[{method,path,handler,file,line,
authDecorators}], beforeRequestAuth:[names], filesScanned}

用法：python3 extract_framework_flask.py <projectRoot> <outJson>
"""

import ast
import json
import os
import sys

SKIP_DIRS = {"tests", "test", "deps", "venv", "env", "node_modules", "vendor",
             ".git", "migrations", "__pycache__", "scripts", "docs",
             "staticfiles", "static"}

# jwt 必在词表：flask_jwt_extended 的 @jwt_required 是生态头号认证装饰器
# （REALWORLD_STRUCTURAL_V4：缺 "jwt" → 10 个受保护 mutation 全误报 FP）
AUTH_WORDS = ("auth", "login", "permission", "token", "credential", "session",
              "user", "jwt")

MUTATION_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def name_of(node):
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    return None


def is_auth_like(name):
    if not name:
        return False
    ln = name.lower()
    return any(w in ln for w in AUTH_WORDS)


class FlaskCollector(ast.NodeVisitor):
    def __init__(self, filepath):
        self.file = filepath
        self.apps = []
        self.blueprints = []
        self.routes = []
        self.before_requests = []  # 注册的 before_request 函数名

    def visit_Assign(self, node):
        if len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            v = node.value
            if isinstance(v, ast.Call) and isinstance(v.func, ast.Name):
                if v.func.id == "Flask":
                    self.apps.append(node.targets[0].id)
                elif v.func.id == "Blueprint":
                    self.blueprints.append(node.targets[0].id)
        self.generic_visit(node)

    def visit_Expr(self, node):
        # app.before_request(auth_fn) / app.register_blueprint(bp) 是表达式语句
        v = node.value
        if isinstance(v, ast.Call) and isinstance(v.func, ast.Attribute):
            attr = v.func.attr
            if attr == "before_request" and v.args:
                fn_name = name_of(v.args[0])
                if fn_name:
                    self.before_requests.append(fn_name)
            if attr == "register_blueprint" and v.args:
                bp = name_of(v.args[0])
                if bp and bp not in self.blueprints:
                    self.blueprints.append(bp)
        self.generic_visit(node)

    def visit_FunctionDef(self, node):
        self._scan(node)
        self.generic_visit(node)

    def visit_AsyncFunctionDef(self, node):
        self._scan(node)
        self.generic_visit(node)

    def _scan(self, node):
        auth_decorators = []
        for dec in node.decorator_list:
            if isinstance(dec, ast.Call) and isinstance(dec.func, ast.Attribute):
                # @app.route("/x", methods=["POST"]) / @bp.route(...)
                if dec.func.attr == "route":
                    target = name_of(dec.func.value)
                    path = dec.args[0].value if dec.args and isinstance(dec.args[0], ast.Constant) else ""
                    methods = ["GET"]
                    for kw in dec.keywords:
                        if kw.arg == "methods" and isinstance(kw.value, (ast.List, ast.Tuple)):
                            methods = [
                                e.value.upper() for e in kw.value.elts
                                if isinstance(e, ast.Constant)
                            ]
                    self.routes.append({
                        "methods": methods,
                        "path": path,
                        "handler": node.name,
                        "file": self.file,
                        "line": node.lineno,
                        "target": target,  # app / bp 变量名
                    })
            elif isinstance(dec, ast.Name):
                if is_auth_like(dec.id):
                    auth_decorators.append(dec.id)
            elif isinstance(dec, ast.Call) and isinstance(dec.func, ast.Name):
                if is_auth_like(dec.func.id):
                    auth_decorators.append(dec.func.id)
            elif isinstance(dec, ast.Call) and isinstance(dec.func, ast.Attribute):
                if is_auth_like(dec.func.attr):
                    auth_decorators.append(dec.func.attr)
        # 把装饰器信息挂到该函数名对应的 routes（同函数多装饰器顺序不定）
        for r in self.routes:
            if r["handler"] == node.name and r["file"] == self.file:
                r["authDecorators"] = auth_decorators


def walk_py_files(root):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            if fn.endswith(".py") and not fn.startswith("test_"):
                yield os.path.join(dirpath, fn)


def main():
    root, out = sys.argv[1], sys.argv[2]
    apps, blueprints, routes, before_requests, files_scanned = [], [], [], [], 0
    for fp in walk_py_files(root):
        files_scanned += 1
        try:
            with open(fp, "r", encoding="utf-8", errors="replace") as f:
                tree = ast.parse(f.read(), filename=fp)
        except (SyntaxError, UnicodeDecodeError, OSError):
            continue
        collector = FlaskCollector(fp)
        collector.visit(tree)
        apps.extend(collector.apps)
        blueprints.extend(collector.blueprints)
        routes.extend(collector.routes)
        before_requests.extend(collector.before_requests)

    result = {
        "hasFlask": bool(apps or blueprints or routes),
        "apps": sorted(set(apps)),
        "blueprints": sorted(set(blueprints)),
        "routes": routes,
        "beforeRequestAuth": sorted(set(
            fn for fn in before_requests if is_auth_like(fn)
        )),
        "filesScanned": files_scanned,
    }
    with open(out, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
