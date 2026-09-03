#!/usr/bin/env python3
"""
Django Framework Structure Extractor — 框架结构扫描（M2）

从 Python AST 提取 Django 结构：
  1) urlpatterns 解析：url()/path()/re_path() → 视图引用（FBV views.foo /
     CBV Foo.as_view() / include('module.urls') 递归）
  2) 视图注册表：
     - FBV：函数装饰器（login_required/permission_required/staff_member_required/
       user_passes_test/authentication_decorator 等 *auth* 名装饰器）
     - CBV：基类（APIView/View/generics.*/LoginRequiredMixin/
       PermissionRequiredMixin）、方法（get/post/put/patch/delete）、
       @method_decorator、DRF permission_classes（AllowAny/IsAuthenticated/
       IsAdminUser/其他类名）
     - @api_view 装饰器：methods + permission_classes kwarg
  3) 每个 urlpattern → 视图解析（按短名匹配注册表）

输出 JSON：{hasDjango, routes:[{pattern,urlname,view,kind,file}],
views:{name:{file,decorators,methods,permissionClasses,isDrf,isProtected}},
filesScanned}

用法：python3 extract_framework_django.py <projectRoot> <outJson>
"""

import ast
import json
import os
import re
import sys

SKIP_DIRS = {"tests", "test", "deps", "venv", "env", "node_modules", "vendor",
             ".git", "migrations", "__pycache__", "scripts", "docs",
             "staticfiles", "static"}

AUTH_DECORATORS = {
    "login_required", "permission_required", "staff_member_required",
    "user_passes_test", "authentication_decorator", "login_required_decorator",
    "require_http_methods",
}

AUTH_MIXINS = {"LoginRequiredMixin", "PermissionRequiredMixin",
               "UserPassesTestMixin", "StaffMemberRequiredMixin"}

DRF_BASES = {"APIView", "GenericAPIView", "RetrieveAPIView", "ListAPIView",
             "CreateAPIView", "UpdateAPIView", "DestroyAPIView",
             "RetrieveUpdateAPIView", "ListCreateAPIView",
             "RetrieveUpdateDestroyAPIView", "ViewSet", "ModelViewSet",
             "GenericViewSet", "ReadOnlyModelViewSet"}

MUTATION_METHODS = {"post", "put", "patch", "delete"}

VIEW_BASES = DRF_BASES | {"View", "TemplateView", "FormView", "CreateView",
                          "UpdateView", "DeleteView", "ListView", "DetailView"}

OPEN_PERMISSIONS = {"AllowAny"}


def name_of(node):
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    return None


def short_view_name(ref):
    """views.auth_lab → auth_lab；Foo.as_view() → Foo"""
    if isinstance(ref, ast.Attribute):
        return ref.attr
    if isinstance(ref, ast.Call) and isinstance(ref.func, ast.Attribute):
        return ref.func.value.attr if isinstance(ref.func.value, ast.Attribute) \
            else name_of(ref.func.value)
    if isinstance(ref, ast.Name):
        return ref.id
    return None


class ViewCollector(ast.NodeVisitor):
    """收集全部函数/类的视图特征（与 urlpatterns 解耦）"""

    def __init__(self, filepath):
        self.file = filepath
        self.fbvs = {}   # name -> {decorators, apiView: [methods]}
        self.classes = {}  # name -> {bases, methods, decorators, permissionClasses, isDrf, protected}

    def visit_FunctionDef(self, node):
        self._scan_function(node, async_=False)
        self.generic_visit(node)

    def visit_AsyncFunctionDef(self, node):
        self._scan_function(node, async_=True)
        self.generic_visit(node)

    def _scan_function(self, node, async_):
        decorators = []
        api_view_methods = None
        permission_classes = []
        for dec in node.decorator_list:
            if isinstance(dec, ast.Name):
                decorators.append(dec.id)
            elif isinstance(dec, ast.Call) and isinstance(dec.func, ast.Name):
                decorators.append(dec.func.id)
                if dec.func.id == "api_view":
                    if dec.args and isinstance(dec.args[0], (ast.List, ast.Tuple)):
                        api_view_methods = [
                            e.value.lower() for e in dec.args[0].elts
                            if isinstance(e, ast.Constant)
                        ]
                    for kw in dec.keywords:
                        if kw.arg == "permission_classes" and isinstance(kw.value, (ast.List, ast.Tuple)):
                            permission_classes = [name_of(e) for e in kw.value.elts if name_of(e)]
            elif isinstance(dec, ast.Call) and isinstance(dec.func, ast.Attribute):
                decorators.append(dec.func.attr)  # django.views.decorators.login_required
        self.fbvs[node.name] = {
            "file": self.file,
            "decorators": decorators,
            "apiViewMethods": api_view_methods,
            "permissionClasses": permission_classes,
        }

    def visit_ClassDef(self, node):
        bases = [name_of(b) for b in node.bases if name_of(b)]
        methods = []
        permission_classes = []
        decorators = []
        for item in node.body:
            if isinstance(item, ast.FunctionDef) and item.name in (
                    "get", "post", "put", "patch", "delete", "create",
                    "update", "destroy", "list", "retrieve"):
                methods.append(item.name)
            if isinstance(item, ast.Assign):
                for t in item.targets:
                    if isinstance(t, ast.Name) and t.id == "permission_classes":
                        if isinstance(item.value, (ast.List, ast.Tuple)):
                            permission_classes = [name_of(e) for e in item.value.elts if name_of(e)]
                        elif isinstance(item.value, ast.Name):
                            permission_classes = [item.value.id]
        for dec in node.decorator_list:
            if isinstance(dec, ast.Name):
                decorators.append(dec.id)
            elif isinstance(dec, ast.Call) and isinstance(dec.func, ast.Name):
                decorators.append(dec.func.id)
            elif isinstance(dec, ast.Call) and isinstance(dec.func, ast.Attribute):
                decorators.append(dec.func.attr)
        is_drf = any(b in DRF_BASES for b in bases)
        has_mixin = any(b in AUTH_MIXINS for b in bases)
        self.classes[node.name] = {
            "file": self.file,
            "bases": bases,
            "methods": methods,
            "decorators": decorators,
            "permissionClasses": permission_classes,
            "isDrf": is_drf,
            "protectedByMixin": has_mixin,
        }


class UrlCollector(ast.NodeVisitor):
    """收集 urlpatterns 列表里的视图引用"""

    def __init__(self, filepath):
        self.file = filepath
        self.routes = []
        # DRF ViewSet/DefaultRouter（REALWORLD_STRUCTURAL_V3：router.register
        # + include(router.urls) 的路由由运行时生成，urlpatterns 解析不可见）
        self.router_regs = {}    # router 变量 -> [(prefix, viewName)]
        self.router_slash = {}   # router 变量 -> trailing_slash
        self.router_uses = []    # (prefixBase, routerVar) urlpatterns 里的 include

    def visit_Assign(self, node):
        for t in node.targets:
            if not isinstance(t, ast.Name):
                continue
            # DefaultRouter 定义（trailing_slash 关键字，默认 True）
            if isinstance(node.value, ast.Call) and isinstance(node.value.func, ast.Name) \
                    and node.value.func.id == "DefaultRouter":
                slash = True
                for kw in node.value.keywords:
                    if kw.arg == "trailing_slash" and isinstance(kw.value, ast.Constant):
                        slash = bool(kw.value.value)
                self.router_slash[t.id] = slash
                self.router_regs.setdefault(t.id, [])
            # urlpatterns：扫描直连条目，并展开 include(router.urls) 的 ViewSet
            if t.id == "urlpatterns" and isinstance(node.value, (ast.List, ast.Tuple)):
                for elt in node.value.elts:
                    self._scan_entry(elt)
                for (prefix, var) in self.router_uses:
                    self._expand_router_routes(prefix, var)
        self.generic_visit(node)

    def visit_Expr(self, node):
        # router.register(r'articles', ArticleViewSet, ...) 语句
        call = node.value
        if isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute) \
                and call.func.attr == "register":
            var = name_of(call.func.value)
            if not var or var not in self.router_regs:
                return
            prefix = ""
            if call.args and isinstance(call.args[0], ast.Constant):
                prefix = str(call.args[0].value)
            view = None
            if len(call.args) > 1:
                a1 = call.args[1]
                if isinstance(a1, ast.Name):
                    view = a1.id
                elif isinstance(a1, ast.Attribute):
                    view = a1.attr
            if view:
                self.router_regs.setdefault(var, []).append((prefix, view))
        self.generic_visit(node)

    def _expand_router_routes(self, prefix_base, var):
        # 本工具不做 include 前缀传播（urlconf 各文件 pattern 独立）——
        # prefix_base 仅作路由存在性触发，不拼进 pattern
        for (prefix, view) in self.router_regs.get(var, []):
            base = "^" + prefix
            # DRF 默认 action 路由：list/create 集合级、retrieve/update/
            # destroy 详情级（权限由 views 表判定，规则在 TS 检测器侧）
            for pat in (base + "/?$", base + "/(?P<pk>[^/.]+)/?$"):
                self.routes.append({
                    "pattern": pat, "urlname": "", "view": view, "kind": "cbv",
                    "file": self.file, "viewset": True,
                })

    def _scan_entry(self, elt):
        if not isinstance(elt, ast.Call):
            return
        fn = name_of(elt.func)  # url / path / re_path
        if fn not in ("url", "path", "re_path"):
            return
        pattern = ""
        if elt.args and isinstance(elt.args[0], ast.Constant):
            pattern = str(elt.args[0].value)
        view_ref = elt.args[1] if len(elt.args) > 1 else None
        if view_ref is None:
            return
        kind = "other"
        view_name = None
        if isinstance(view_ref, ast.Call) and isinstance(view_ref.func, ast.Attribute):
            if view_ref.func.attr == "as_view":
                kind = "cbv"
                view_name = short_view_name(view_ref)
            elif view_ref.func.id == "include" if isinstance(view_ref.func, ast.Name) else False:
                kind = "include"
        if view_name is None:
            if isinstance(view_ref, ast.Name):
                kind = "include" if False else "fbv"
                view_name = view_ref.id
            elif isinstance(view_ref, ast.Attribute):
                kind = "fbv"
                view_name = view_ref.attr
            elif isinstance(view_ref, ast.Call) and isinstance(view_ref.func, ast.Name):
                if view_ref.func.id == "include":
                    kind = "include"
                    # include(router.urls)：记录 router 变量（同一文件的
                    # router.register 展开见 _expand_router_routes）
                    if view_ref.args and isinstance(view_ref.args[0], ast.Attribute) \
                            and view_ref.args[0].attr == "urls":
                        rvar = name_of(view_ref.args[0].value)
                        if rvar:
                            self.router_uses.append((pattern, rvar))
                else:
                    kind = "fbv"
                    view_name = view_ref.func.id
        urlname = ""
        for kw in elt.keywords:
            if kw.arg == "name" and isinstance(kw.value, ast.Constant):
                urlname = str(kw.value)
        self.routes.append({
            "pattern": pattern,
            "urlname": urlname,
            "view": view_name,
            "kind": kind,
            "file": self.file,
        })


def walk_py_files(root):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in filenames:
            if fn.endswith(".py") and not fn.startswith("test_"):
                yield os.path.join(dirpath, fn)


def main():
    root, out = sys.argv[1], sys.argv[2]
    views, routes, files_scanned = {}, [], 0
    for fp in walk_py_files(root):
        files_scanned += 1
        try:
            with open(fp, "r", encoding="utf-8", errors="replace") as f:
                tree = ast.parse(f.read(), filename=fp)
        except (SyntaxError, UnicodeDecodeError, OSError):
            continue
        vc, uc = ViewCollector(fp), UrlCollector(fp)
        vc.visit(tree)
        uc.visit(tree)
        for name, info in vc.fbvs.items():
            info["kind"] = "fbv"
            views[name] = info
        for name, info in vc.classes.items():
            info["kind"] = "cbv"
            views[name] = info
        routes.extend(uc.routes)

    # 保护判定（扫描器只算事实，规则在 TS 检测器侧）
    for name, info in views.items():
        auth_dec = [d for d in info.get("decorators", [])
                    if d in AUTH_DECORATORS or "auth" in d.lower() or "login" in d.lower()]
        info["authDecorators"] = auth_dec
        if info["kind"] == "cbv":
            pc = info.get("permissionClasses") or []
            info["openPermission"] = (len(pc) == 0) or all(
                p in OPEN_PERMISSIONS for p in pc
            )

    result = {
        "hasDjango": bool(routes),
        "routes": routes,
        "views": views,
        "filesScanned": files_scanned,
    }
    with open(out, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
