#!/usr/bin/env python3
"""
Python IR Extractor (V5) — matches TypeScript FunctionInfo interface.

Extracts: function signatures, type annotations, call graphs, decorator-based
protocol annotations, docstring-based metadata, class methods, and exports.

Usage: python tools/extract_ir.py <project_root> [output_path]
Output: ir.json (array of FunctionInfo-compatible objects)
"""

import ast
import sys
import json
import os
import re
from pathlib import Path

# ── Type annotation parser ──

def get_annotation(node):
    """Parse type annotation node to string. Returns 'any' if unannotated."""
    if node is None:
        return "any"
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Constant):
        return str(node.value)
    if isinstance(node, ast.Subscript):
        value = get_annotation(node.value)
        slice_ = get_annotation(node.slice)
        return f"{value}[{slice_}]"
    if isinstance(node, ast.Tuple):
        return ", ".join(get_annotation(e) for e in node.elts)
    if isinstance(node, ast.BinOp):
        left = get_annotation(node.left)
        right = get_annotation(node.right)
        return f"{left} | {right}"
    try:
        return ast.unparse(node)
    except Exception:
        return "any"

# ── Call extraction ──

SQL_EXEC_ATTRS = {"execute", "executemany", "executescript", "execute_query", "raw", "extra"}
SQL_MARKER = "__progmune_sql_unparameterized__"


def is_dynamic_format(node):
    """True if the expression formats data into SQL text: f-string,
    % formatting, .format() call, or string concatenation."""
    if isinstance(node, ast.JoinedStr):          # f-string
        return True
    if isinstance(node, ast.BinOp):
        if isinstance(node.op, (ast.Mod, ast.Add)):  # "%" formatting or "+" concat
            return True
        return is_dynamic_format(node.left) or is_dynamic_format(node.right)
    if isinstance(node, ast.Call):
        if isinstance(node.func, ast.Attribute) and node.func.attr == "format":
            return True
    return False


def collect_assignments(node):
    """Variable name → assigned value node (single-hop, same function scope)."""
    assigns = {}
    for child in ast.walk(node):
        if isinstance(child, ast.Assign):
            for t in child.targets:
                if isinstance(t, ast.Name):
                    assigns.setdefault(t.id, child.value)
        elif isinstance(child, ast.AnnAssign) and isinstance(child.target, ast.Name):
            assigns.setdefault(child.target.id, child.value)
    return assigns


def has_unparameterized_sql(node):
    """Source-level SQLi check: a SQL-executing call whose SQL text is built
    with dynamic formatting (f-string / % / .format / concatenation), either
    inline in the call args or in a single-hop local-variable assignment
    (sql_query = "..." + user_input; cursor.execute(sql_query)).
    Parameterized calls — execute("... %s ...", (args,)) — are NOT flagged."""
    assigns = collect_assignments(node)
    for child in ast.walk(node):
        if isinstance(child, ast.Call):
            name = None
            if isinstance(child.func, ast.Name):
                name = child.func.id
            elif isinstance(child.func, ast.Attribute):
                name = child.func.attr
            if name in SQL_EXEC_ATTRS:
                for a in child.args:
                    if is_dynamic_format(a):
                        return True
                    if isinstance(a, ast.Name) and is_dynamic_format(assigns.get(a.id)):
                        return True
                for k in child.keywords:
                    if is_dynamic_format(k.value):
                        return True
    return False


SSRF_MARKER = "__progmune_ssrf_user_url__"
HTTP_FETCH_RECEIVERS = ("requests", "httpx", "urllib", "urllib2", "aiohttp", "http")


def is_request_rooted(node):
    """True if the expression derives from the request object
    (request.POST.get(...), request.GET['x'], request.body ...)."""
    if isinstance(node, ast.Name):
        return node.id == "request"
    if isinstance(node, ast.Attribute):
        return is_request_rooted(node.value)
    if isinstance(node, ast.Subscript):
        return is_request_rooted(node.value)
    if isinstance(node, ast.Call):
        return (is_request_rooted(node.func)
                or any(is_request_rooted(a) for a in node.args)
                or any(is_request_rooted(k.value) for k in node.keywords))
    return False


def is_tainted(node, assigns, depth=0):
    """Single-hop taint: request-rooted, variable assigned from a tainted
    value, or dynamic formatting containing tainted parts."""
    if node is None or depth > 2:
        return False
    if is_request_rooted(node):
        return True
    if isinstance(node, ast.Name):
        return is_tainted(assigns.get(node.id), assigns, depth + 1)
    if isinstance(node, ast.JoinedStr):
        return any(is_tainted(v.value, assigns, depth + 1)
                   for v in node.values if isinstance(v, ast.FormattedValue))
    if isinstance(node, ast.BinOp):
        return (is_tainted(node.left, assigns, depth)
                or is_tainted(node.right, assigns, depth))
    if isinstance(node, ast.Call):
        return (any(is_tainted(a, assigns, depth) for a in node.args)
                or any(is_tainted(k.value, assigns, depth) for k in node.keywords))
    return False


def is_http_fetch_call(node):
    """requests.get(...) / urllib.request.urlopen(...) / httpx.get(...) /
    http.client.HTTPConnection.request(...) / bare urlopen(...)."""
    if isinstance(node.func, ast.Name):
        return node.func.id == "urlopen"
    if isinstance(node.func, ast.Attribute):
        parts = []
        cur = node.func
        while isinstance(cur, ast.Attribute):
            parts.append(cur.attr)
            cur = cur.value
        if isinstance(cur, ast.Name):
            parts.append(cur.id)
        chain = parts[::-1]
        if chain and chain[0] in HTTP_FETCH_RECEIVERS:
            return chain[-1] in ("get", "post", "put", "delete", "head",
                                 "patch", "request", "urlopen", "open", "fetch")
    return False


def has_ssrf(node):
    """SSRF check: an HTTP fetch call whose URL argument is tainted by
    request-derived user input (directly or via single-hop assignment)."""
    assigns = collect_assignments(node)
    for child in ast.walk(node):
        if isinstance(child, ast.Call) and is_http_fetch_call(child):
            if any(is_tainted(a, assigns) for a in child.args):
                return True
            if any(is_tainted(k.value, assigns) for k in child.keywords):
                return True
    return False


PATH_MARKER = "__progmune_path_traversal__"


def is_file_sink_call(node):
    """open(...) / io.open(...) / os.open(...) / Path(...).read_text() — file
    sinks whose path argument, when tainted, is a path traversal."""
    if isinstance(node.func, ast.Name):
        return node.func.id == "open"
    if isinstance(node.func, ast.Attribute):
        if node.func.attr in ("read_text", "read_bytes"):
            # Any receiver — the taint verification happens in
            # has_path_traversal (direct Path(...) call or Path-assigned name).
            return True
        parts = []
        cur = node.func
        while isinstance(cur, ast.Attribute):
            parts.append(cur.attr)
            cur = cur.value
        if isinstance(cur, ast.Name):
            parts.append(cur.id)
        chain = parts[::-1]
        return chain[0] in ("io", "os") and chain[-1] == "open"
    return False


XSS_MARKER = "__progmune_xss_unsafe_render__"


def scan_unsafe_template_vars(project_root):
    """Template-layer visibility: map template path (relative to project root)
    → set of variables rendered WITHOUT escaping — {{ var|safe }} filters or
    anything inside {% autoescape off %} blocks."""
    unsafe = {}
    for path in Path(project_root).rglob("*.html"):
        if 'node_modules' in path.parts or 'venv' in path.parts \
                or any(p.startswith('.') for p in path.parts):
            continue
        try:
            text = path.read_text(encoding='utf-8', errors='ignore')
        except Exception:
            continue
        vars_ = set(re.findall(r'{{\s*(\w+)\s*\|\s*safe\s*}}', text))
        for block in re.findall(
                r'{%\s*autoescape\s+off\s*%}(.*?){%\s*endautoescape\s*%}',
                text, re.S):
            vars_ |= set(re.findall(r'{{\s*(\w+)\s*}}', block))
        if vars_:
            unsafe[path.relative_to(project_root).as_posix()] = vars_
    return unsafe


SSTI_MARKER = "__progmune_ssti_template_injection__"


def has_ssti(node):
    """SSTI check: (S1) a template-string sink (render_template_string /
    Template / from_string) receiving tainted input; (S2) tainted content
    written to a file opened under a template path — the Django
    dynamic-template pattern (user input becomes template source)."""
    assigns = collect_assignments(node)
    for child in ast.walk(node):
        if not isinstance(child, ast.Call):
            continue
        name = None
        if isinstance(child.func, ast.Name):
            name = child.func.id
        elif isinstance(child.func, ast.Attribute):
            name = child.func.attr
        if name in ("render_template_string", "from_string", "Template"):
            if any(is_tainted(a, assigns) for a in child.args):
                return True
        # S2: file.write(tainted) where the file object traces to
        # open(<template path>, ...)
        if name == "write":
            if not any(is_tainted(a, assigns) for a in child.args):
                continue
            recv = child.func.value
            if isinstance(recv, ast.Name):
                v = assigns.get(recv.id)
                if isinstance(v, ast.Call) and isinstance(v.func, ast.Name) \
                        and v.func.id == "open" and v.args:
                    path_str = ""
                    p = v.args[0]
                    if isinstance(p, ast.Constant):
                        path_str = str(p.value)
                    elif isinstance(p, ast.Name):
                        pv = assigns.get(p.id)
                        if pv is not None:
                            path_str = ast.unparse(pv)
                    else:
                        path_str = ast.unparse(p)
                    if "template" in path_str.lower() or path_str.endswith(".html"):
                        return True
    return False


XXE_MARKER = "__progmune_xxe_external_entities__"


def has_xxe(node):
    """XXE check: BOTH signals required — (1) an explicitly unsafe parser
    configuration (setFeature(feature_external_*, True) or
    XMLParser(resolve_entities=True)), AND (2) parsing of tainted
    request-derived XML (parse / parseString / fromstring / iterparse).
    Config-only or taint-only alone is not flagged."""
    assigns = collect_assignments(node)
    unsafe_parser = False
    tainted_parse = False
    for child in ast.walk(node):
        if not isinstance(child, ast.Call):
            continue
        name = None
        if isinstance(child.func, ast.Name):
            name = child.func.id
        elif isinstance(child.func, ast.Attribute):
            name = child.func.attr
        if name == "setFeature" and len(child.args) >= 2:
            arg0 = child.args[0]
            is_external = (isinstance(arg0, ast.Name) and "external" in arg0.id.lower()) \
                or (isinstance(arg0, ast.Constant) and "external" in str(arg0.value).lower())
            arg1_true = isinstance(child.args[1], ast.Constant) \
                and child.args[1].value is True
            if is_external and arg1_true:
                unsafe_parser = True
        if name == "XMLParser":
            for kw in child.keywords:
                if kw.arg == "resolve_entities" and isinstance(kw.value, ast.Constant) \
                        and kw.value.value is True:
                    unsafe_parser = True
        if name in ("parse", "parseString", "fromstring", "from_string", "iterparse"):
            if any(is_tainted(a, assigns) for a in child.args):
                tainted_parse = True
    return unsafe_parser and tainted_parse


EVAL_MARKER = "__progmune_eval_user_input__"
SECRET_MARKER = "__progmune_hardcoded_secret__"
CMD_FLOW_MARKER = "__progmune_command_taint_flow__"
CSRF_MARKER = "__progmune_csrf_disabled__"


def has_csrf_exempt(node):
    """@csrf_exempt decorator — Django CSRF protection explicitly disabled."""
    for dec in getattr(node, 'decorator_list', []):
        name = None
        if isinstance(dec, ast.Name):
            name = dec.id
        elif isinstance(dec, ast.Attribute):
            name = dec.attr
        if name == "csrf_exempt":
            return True
    return False


GET_STATE_MARKER = "__progmune_get_state_change__"


def has_get_state_change(node):
    """CSRF shape #2: a `request.method == 'GET'` branch performs
    state-changing calls (.save/.update/.delete/.create) — state change on
    GET requests, exposed to CSRF even without @csrf_exempt."""
    def is_get_compare(test):
        if not isinstance(test, ast.Compare) or len(test.ops) != 1 \
                or not isinstance(test.ops[0], ast.Eq):
            return False
        left, right = test.left, test.comparators[0]
        const = None
        attr = None
        if isinstance(right, ast.Constant) and isinstance(right.value, str):
            const = right.value
            attr = left
        elif isinstance(left, ast.Constant) and isinstance(left.value, str):
            const = left.value
            attr = right
        if const and const.upper() == "GET":
            return (isinstance(attr, ast.Attribute) and attr.attr == "method"
                    and isinstance(attr.value, ast.Name) and attr.value.id == "request")
        return False

    for child in ast.walk(node):
        if isinstance(child, ast.If) and is_get_compare(child.test):
            for stmt in child.body:
                for sub in ast.walk(stmt):
                    if isinstance(sub, ast.Call) and isinstance(sub.func, ast.Attribute) \
                            and sub.func.attr in ("save", "update", "delete", "create"):
                        return True
    return False


def has_dynamic_eval(node):
    """eval/exec/__import__ called with tainted request-derived input."""
    assigns = collect_assignments(node)
    for child in ast.walk(node):
        if isinstance(child, ast.Call) and isinstance(child.func, ast.Name) \
                and child.func.id in ("eval", "exec", "__import__"):
            if any(is_tainted(a, assigns) for a in child.args):
                return True
    return False


def _root_name(func_node):
    cur = func_node
    while isinstance(cur, ast.Attribute):
        cur = cur.value
    return cur.id if isinstance(cur, ast.Name) else None


def has_hardcoded_secret(node, module_constants=None, imports=None, global_constants=None):
    """jwt.decode/encode with a literal string secret (positional or
    key=/secret= keyword) — the key is in the source, not the environment.
    Name arguments resolve through module-level constant assignments
    (SECRET_COOKIE_KEY = '...'), including cross-module imports
    (from pygoat.settings import SECRET_COOKIE_KEY → global constants map)."""
    def is_literal(v):
        if isinstance(v, ast.Constant) and isinstance(v.value, str):
            return True
        if isinstance(v, ast.Name):
            if module_constants is not None:
                cv = module_constants.get(v.id)
                if isinstance(cv, ast.Constant) and isinstance(cv.value, str):
                    return True
            if imports is not None and global_constants is not None:
                mod = imports.get(v.id)
                cv = global_constants.get(mod)
                if isinstance(cv, ast.Constant) and isinstance(cv.value, str):
                    return True
        return False

    for child in ast.walk(node):
        if not isinstance(child, ast.Call):
            continue
        name = None
        if isinstance(child.func, ast.Name):
            name = child.func.id
        elif isinstance(child.func, ast.Attribute):
            name = child.func.attr
        if name in ("decode", "encode") and _root_name(child.func) in ("jwt", "jose", "itsdangerous"):
            if len(child.args) >= 2 and is_literal(child.args[1]):
                return True
            for kw in child.keywords:
                if kw.arg in ("key", "secret", "secret_key") and is_literal(kw.value):
                    return True
    return False


def has_command_taint_flow(node):
    """Tainted value passed to a command-named helper — the cross-function
    command-injection flow (view builds 'nmap ' + ip and hands it to
    command_out(); the Popen sink lives in the helper)."""
    assigns = collect_assignments(node)
    for child in ast.walk(node):
        if not isinstance(child, ast.Call):
            continue
        name = None
        if isinstance(child.func, ast.Name):
            name = child.func.id
        elif isinstance(child.func, ast.Attribute):
            name = child.func.attr
        if name and ("command" in name.lower() or name.lower().startswith("cmd_")
                     or name.lower().startswith("exec_")):
            if any(is_tainted(a, assigns) for a in child.args):
                return True
    return False


FRAMEWORK_AUTH_MARKER = "__progmune_framework_auth__"
FORM_DELEGATION_MARKER = "__progmune_django_form__"
TOKEN_ISSUED_MARKER = "__progmune_token_issued__"
AUTH_CHECKED_MARKER = "__progmune_auth_checked__"
CREDENTIAL_CHECK_MARKER = "__progmune_credential_check__"
CMD_DYNAMIC_MARKER = "__progmune_command_dynamic__"


def build_import_map(tree):
    """local name → qualified module path (from django.contrib.auth import login)."""
    m = {}
    for node in getattr(tree, 'body', []):
        if isinstance(node, ast.ImportFrom):
            mod = node.module or ""
            for alias in node.names:
                m[alias.asname or alias.name] = f"{mod}.{alias.name}"
        elif isinstance(node, ast.Import):
            for alias in node.names:
                m[alias.asname or alias.name] = alias.name
    return m


def has_framework_auth(node, imports):
    """Calls resolving (via import resolution) to framework auth functions —
    django.contrib.auth.login/authenticate, flask_login.*."""
    for child in ast.walk(node):
        if isinstance(child, ast.Call) and isinstance(child.func, ast.Name):
            mod = imports.get(child.func.id, "")
            if mod.startswith("django.contrib.auth") or mod.startswith("flask_login"):
                return True
    return False


def has_form_delegation(node):
    """<Name>Form(request.POST) instantiated and .save() called on that
    instance — Django form delegation (validation + hashing in framework)."""
    assigns = collect_assignments(node)
    for child in ast.walk(node):
        if not isinstance(child, ast.Call):
            continue
        if isinstance(child.func, ast.Name) and child.func.id.endswith("Form") \
                and any(is_request_rooted(a) for a in child.args):
            # form = XForm(request.POST) — find its target names
            return True
        # form.save() on a variable assigned from an XForm(...) call
        if isinstance(child.func, ast.Attribute) and child.func.attr == "save":
            recv = child.func.value
            if isinstance(recv, ast.Name):
                v = assigns.get(recv.id)
                if isinstance(v, ast.Call) and isinstance(v.func, ast.Name) \
                        and v.func.id.endswith("Form"):
                    return True
    return False


def has_token_issued(node):
    """set_cookie calls, assignments to token/session-named variables, or
    dict literals containing a 'token' key — the function actually issues
    session/token material (sess = {'token': ...} counts)."""
    for child in ast.walk(node):
        if isinstance(child, ast.Call):
            name = None
            if isinstance(child.func, ast.Name):
                name = child.func.id
            elif isinstance(child.func, ast.Attribute):
                name = child.func.attr
            if name in ("set_cookie", "set_secure_cookie"):
                return True
        if isinstance(child, ast.Assign):
            for t in child.targets:
                if isinstance(t, ast.Name) and re.search(r"token|session|jwt", t.id, re.I):
                    return True
            if isinstance(child.value, ast.Dict):
                for k in child.value.keys:
                    if isinstance(k, ast.Constant) and isinstance(k.value, str) \
                            and "token" in k.value.lower():
                        return True
    return False


def has_auth_checked(node):
    """An `is_authenticated` guard (if request.user.is_authenticated …)."""
    for child in ast.walk(node):
        if isinstance(child, ast.If):
            if "is_authenticated" in ast.unparse(child.test):
                return True
    return False


def has_credential_check(node):
    """`if token in <store>` / `if token == store.get(...)` — a parameter
    verified against a credential store."""
    for child in ast.walk(node):
        if isinstance(child, ast.If) and isinstance(child.test, ast.Compare) \
                and len(child.test.ops) == 1 \
                and isinstance(child.test.ops[0], (ast.In, ast.Eq)):
            s = ast.unparse(child.test)
            if re.search(r'\btoken\b', s):
                return True
    return False


def _static_command_arg(a, assigns=None):
    if isinstance(a, ast.Constant):
        if isinstance(a.value, str):
            return True
        if isinstance(a.value, (list, tuple)) and all(isinstance(x, str) for x in a.value):
            return True
    if isinstance(a, (ast.List, ast.Tuple)):
        return all(_static_command_arg(e, assigns) for e in a.elts)
    if isinstance(a, ast.Name) and assigns is not None:
        v = assigns.get(a.id)
        if v is not None:
            return _static_command_arg(v, assigns)
    if isinstance(a, ast.IfExp):
        return _static_command_arg(a.body, assigns) \
            and _static_command_arg(a.orelse, assigns)
    if isinstance(a, ast.Attribute):
        if _root_name(a) in ("sys", "os", "path"):
            return True
    return False


def has_dynamic_command(node):
    """subprocess/os command call with a NON-static command argument —
    static string/list args (installers, fixed invocations) are not flagged.
    Variables assigned from static strings count as static."""
    assigns = collect_assignments(node)
    for child in ast.walk(node):
        if not isinstance(child, ast.Call):
            continue
        name = None
        if isinstance(child.func, ast.Name):
            name = child.func.id
        elif isinstance(child.func, ast.Attribute):
            name = child.func.attr
        if name in ("system", "popen", "getoutput") and name not in ("getoutput",):
            pass  # os.system / os.popen / os.getoutput — qualify below
        if name in ("run", "call", "check_call", "check_output", "Popen"):
            if _root_name(child.func) != "subprocess":
                continue
        elif name in ("system", "popen", "getoutput"):
            if _root_name(child.func) not in ("os", "commands", "pty"):
                continue
        else:
            continue
        if any(not _static_command_arg(a, assigns) for a in child.args):
            return True
    return False


COOKIE_AUTH_MARKER = "__progmune_cookie_authorization__"


def build_module_constants(tree):
    """Module-level constant assignments (SECRET_COOKIE_KEY = '...')."""
    consts = {}
    for node in getattr(tree, 'body', []):
        if isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name):
                    consts.setdefault(t.id, node.value)
    return consts


def build_global_constants(project_root):
    """Project-wide module-level constants, keyed 'module.path.NAME' —
    resolves cross-module imports (from pygoat.settings import KEY)."""
    consts = {}
    for path in Path(project_root).rglob("*.py"):
        if any(p.startswith('.') for p in path.parts):
            continue
        if 'node_modules' in path.parts or 'venv' in path.parts \
                or 'site-packages' in path.parts:
            continue
        try:
            tree = ast.parse(path.read_text(encoding='utf-8', errors='ignore'))
        except Exception:
            continue
        rel = path.relative_to(project_root).with_suffix('').as_posix().replace('/', '.')
        for name, val in build_module_constants(tree).items():
            consts[f"{rel}.{name}"] = val
    return consts


def _contains_cookies_ref(node):
    if isinstance(node, ast.Attribute):
        if node.attr == "COOKIES" and isinstance(node.value, ast.Name) \
                and node.value.id == "request":
            return True
        return _contains_cookies_ref(node.value)
    if isinstance(node, ast.Subscript):
        return _contains_cookies_ref(node.value)
    if isinstance(node, ast.Call):
        return _contains_cookies_ref(node.func)
    return False


def _cookie_tainted(node, assigns, depth=0):
    """Expression deriving from request.COOKIES — directly or via single-hop
    assignment chains (cookie = request.COOKIES['x']; cookie.split('|')[0])."""
    if node is None or depth > 3:
        return False
    if _contains_cookies_ref(node):
        return True
    if isinstance(node, ast.Name):
        v = assigns.get(node.id)
        return _cookie_tainted(v, assigns, depth + 1) if v is not None else False
    if isinstance(node, ast.Attribute):
        return _cookie_tainted(node.value, assigns, depth)
    if isinstance(node, ast.Subscript):
        return _cookie_tainted(node.value, assigns, depth)
    if isinstance(node, ast.Call):
        return _cookie_tainted(node.func, assigns, depth)
    return False


def has_cookie_authorization(node):
    """A client-controlled cookie value participates in a comparison or a
    branch test — authorization decision made from cookie contents."""
    assigns = collect_assignments(node)
    for child in ast.walk(node):
        if isinstance(child, (ast.If, ast.While)):
            if _cookie_tainted(child.test, assigns):
                return True
        if isinstance(child, ast.Compare):
            if _cookie_tainted(child.left, assigns) \
                    or any(_cookie_tainted(c, assigns) for c in child.comparators):
                return True
    return False


TEMPLATE_TAG_MARKER = "__progmune_template_tag__"
OWNERSHIP_CHECKED_MARKER = "__progmune_ownership_checked__"


def has_template_tag_decorator(node):
    """@register.simple_tag / @register.inclusion_tag / @register.tag /
    @register.filter — Django template-tag registration functions."""
    for dec in getattr(node, 'decorator_list', []):
        if isinstance(dec, ast.Call):
            fn = dec.func
            name = fn.attr if isinstance(fn, ast.Attribute) else \
                (fn.id if isinstance(fn, ast.Name) else None)
            if name in ("simple_tag", "inclusion_tag", "tag", "filter"):
                return True
        elif isinstance(dec, ast.Attribute) and dec.attr in ("simple_tag", "inclusion_tag", "tag", "filter"):
            return True
    return False


def has_ownership_checked(node):
    """Inline ownership comparison: an identity-named parameter (user,
    current_user, profile, author, owner) compared with ==/!= against another
    expression — the ownership check the call-name interface cannot see."""
    args = node.args
    param_names = {a.arg for a in args.args + args.posonlyargs + args.kwonlyargs}
    identity = {p for p in param_names
                if re.search(r'^(user|current_user|profile|author|owner|request_user)$', p, re.I)}
    if not identity:
        return False

    def refs_param(n, names, depth=0):
        if depth > 2:
            return False
        if isinstance(n, ast.Name):
            return n.id in names
        if isinstance(n, ast.Attribute):
            return refs_param(n.value, names, depth + 1)
        return False

    for child in ast.walk(node):
        if isinstance(child, ast.Compare) and len(child.ops) == 1 \
                and isinstance(child.ops[0], (ast.Eq, ast.NotEq)):
            sides = [child.left] + list(child.comparators)
            if any(refs_param(s, identity) for s in sides):
                return True
        # Per-user boolean state properties in branch tests — ownership
        # checked through the data model (article.favorited, profile.following)
        if isinstance(child, ast.If) \
                and re.search(r'\.(favorited|following|is_owner|owned_by|can_edit|can_delete)\b',
                              ast.unparse(child.test)):
            return True
    return False


def has_xss(node, unsafe_vars=None):
    """XSS check: a render/render_to_string call binds tainted request-derived
    values into template variables that the template renders without escaping
    ({{ var|safe }} / autoescape off) — or mark_safe() applied to tainted
    input directly."""
    assigns = collect_assignments(node)
    if unsafe_vars:
        for child in ast.walk(node):
            if not isinstance(child, ast.Call):
                continue
            name = None
            if isinstance(child.func, ast.Name):
                name = child.func.id
            elif isinstance(child.func, ast.Attribute):
                name = child.func.attr
            if name not in ("render", "render_to_string"):
                continue
            tpl_idx = 1 if name == "render" else 0
            if len(child.args) <= tpl_idx:
                continue
            tpl = child.args[tpl_idx]
            tpl_name = tpl.value if isinstance(tpl, ast.Constant) \
                and isinstance(tpl.value, str) else None
            if not tpl_name:
                continue
            vars_ = None
            for path, vs in unsafe_vars.items():
                if path.endswith(tpl_name):
                    vars_ = vs
                    break
            if not vars_:
                continue
            ctx = None
            if len(child.args) > tpl_idx + 1:
                ctx = child.args[tpl_idx + 1]
            for kw in child.keywords:
                if kw.arg == "context":
                    ctx = kw.value
            if isinstance(ctx, ast.Name):
                ctx = assigns.get(ctx.id)
            if not isinstance(ctx, ast.Dict):
                continue
            for k, v in zip(ctx.keys, ctx.values):
                key = k.value if isinstance(k, ast.Constant) else None
                if key in vars_ and is_tainted(v, assigns):
                    return True
    # mark_safe on tainted input is the same flaw expressed in the view
    for child in ast.walk(node):
        if isinstance(child, ast.Call) and isinstance(child.func, ast.Name) \
                and child.func.id == "mark_safe":
            if any(is_tainted(a, assigns) for a in child.args):
                return True
    return False


def has_path_traversal(node):
    """Path-traversal check: a file sink whose path argument is tainted by
    request-derived user input (directly or via single-hop assignment —
    os.path.join chains resolve through assignment tracking)."""
    assigns = collect_assignments(node)
    for child in ast.walk(node):
        if not isinstance(child, ast.Call) or not is_file_sink_call(child):
            continue
        if any(is_tainted(a, assigns) for a in child.args):
            return True
        if any(is_tainted(k.value, assigns) for k in child.keywords):
            return True
        # Path(...).read_text(): the tainted path lives in the receiver —
        # either the direct call or a variable assigned from a Path(...) call.
        if isinstance(child.func, ast.Attribute) and child.func.attr in ("read_text", "read_bytes"):
            recv = child.func.value
            if isinstance(recv, ast.Call) and any(is_tainted(a, assigns) for a in recv.args):
                return True
            if isinstance(recv, ast.Name):
                v = assigns.get(recv.id)
                if isinstance(v, ast.Call) and isinstance(v.func, ast.Name) \
                        and v.func.id == "Path" \
                        and any(is_tainted(a, assigns) for a in v.args):
                    return True
    return False


def extract_calls(node, unsafe_vars=None, imports=None, module_constants=None, global_constants=None):
    """Extract function call names from a function body (first-level only).

    Attribute calls emit the full qualified chain (e.g. user.change_password,
    User.objects.create_user) so rules can distinguish framework-delegated
    calls from custom same-named functions. Bare-name calls stay as-is.
    Source-level checks emit synthetic marker calls: unparameterized SQL,
    SSRF, path traversal, XSS, eval, hardcoded secrets, command flow, CSRF,
    and the semantic markers for framework auth / form delegation / token
    issuance / auth guards / credential checks / dynamic commands."""
    calls = []
    seen = set()
    for child in ast.walk(node):
        if isinstance(child, ast.Call):
            func = child.func
            name = None
            if isinstance(func, ast.Name):
                name = func.id
            elif isinstance(func, ast.Attribute):
                # Walk the attribute chain: User.objects.create_user
                parts = []
                cur = func
                while isinstance(cur, ast.Attribute):
                    parts.append(cur.attr)
                    cur = cur.value
                if isinstance(cur, ast.Name):
                    parts.append(cur.id)
                name = ".".join(reversed(parts)) if len(parts) > 1 else func.attr
            if name and name not in seen:
                seen.add(name)
                calls.append(name)
    if has_unparameterized_sql(node) and SQL_MARKER not in calls:
        calls.append(SQL_MARKER)
    if has_ssrf(node) and SSRF_MARKER not in calls:
        calls.append(SSRF_MARKER)
    if has_path_traversal(node) and PATH_MARKER not in calls:
        calls.append(PATH_MARKER)
    if unsafe_vars and has_xss(node, unsafe_vars) and XSS_MARKER not in calls:
        calls.append(XSS_MARKER)
    if has_ssti(node) and SSTI_MARKER not in calls:
        calls.append(SSTI_MARKER)
    if has_xxe(node) and XXE_MARKER not in calls:
        calls.append(XXE_MARKER)
    if has_dynamic_eval(node) and EVAL_MARKER not in calls:
        calls.append(EVAL_MARKER)
    if has_hardcoded_secret(node, module_constants, imports, global_constants) and SECRET_MARKER not in calls:
        calls.append(SECRET_MARKER)
    if has_cookie_authorization(node) and COOKIE_AUTH_MARKER not in calls:
        calls.append(COOKIE_AUTH_MARKER)
    if has_template_tag_decorator(node) and TEMPLATE_TAG_MARKER not in calls:
        calls.append(TEMPLATE_TAG_MARKER)
    if has_ownership_checked(node) and OWNERSHIP_CHECKED_MARKER not in calls:
        calls.append(OWNERSHIP_CHECKED_MARKER)
    if has_command_taint_flow(node) and CMD_FLOW_MARKER not in calls:
        calls.append(CMD_FLOW_MARKER)
    if has_csrf_exempt(node) and CSRF_MARKER not in calls:
        calls.append(CSRF_MARKER)
    if has_get_state_change(node) and GET_STATE_MARKER not in calls:
        calls.append(GET_STATE_MARKER)
    if imports and has_framework_auth(node, imports) and FRAMEWORK_AUTH_MARKER not in calls:
        calls.append(FRAMEWORK_AUTH_MARKER)
    if has_form_delegation(node) and FORM_DELEGATION_MARKER not in calls:
        calls.append(FORM_DELEGATION_MARKER)
    if has_token_issued(node) and TOKEN_ISSUED_MARKER not in calls:
        calls.append(TOKEN_ISSUED_MARKER)
    if has_auth_checked(node) and AUTH_CHECKED_MARKER not in calls:
        calls.append(AUTH_CHECKED_MARKER)
    if has_credential_check(node) and CREDENTIAL_CHECK_MARKER not in calls:
        calls.append(CREDENTIAL_CHECK_MARKER)
    if has_dynamic_command(node) and CMD_DYNAMIC_MARKER not in calls:
        calls.append(CMD_DYNAMIC_MARKER)
    return calls

# ── Protocol annotation extraction ──

def extract_protocol_from_decorators(node):
    """
    Extract protocol state annotation from decorators.
    Supports: @progmune(namespace="auth", pre=["S1"], post=["S2"])
             @protocol(namespace="auth", pre_states=[...], post_states=[...])
    """
    for dec in getattr(node, 'decorator_list', []):
        dec_str = None
        try:
            dec_str = ast.unparse(dec)
        except Exception:
            continue
        if not dec_str:
            continue
        # Match @progmune(...) or @protocol(...) — unparse drops the @ prefix
        m = re.search(r'(?:progmune|protocol)\s*\((.*)\)', dec_str)
        if m:
            kwargs_str = m.group(1)
            kwargs = {}
            # Parse keyword arguments: key=value, key="value", key=[...]
            for match in re.finditer(
                r'''(\w+)\s*=\s*(?:(\[[^\]]*\])|"([^"]*)"|'([^']*)'|(\w+))''',
                kwargs_str
            ):
                key = match.group(1)
                if match.group(2):  # list [...]
                    # Handle both single and double quoted items inside list
                    items = re.findall(r'''["']([^"']*)["']''', match.group(2))
                    if not items:
                        # Also try bare words in list
                        items = [w.strip() for w in match.group(2).strip('[]').split(',') if w.strip()]
                    kwargs[key] = items
                elif match.group(3):  # "string"
                    kwargs[key] = match.group(3)
                elif match.group(4):  # 'string'
                    kwargs[key] = match.group(4)
                elif match.group(5):  # bare word
                    kwargs[key] = match.group(5)
            return {
                "namespace": kwargs.get("namespace"),
                "pre_states": kwargs.get("pre_states") or kwargs.get("pre") or [],
                "post_states": kwargs.get("post_states") or kwargs.get("post") or [],
                "invalidate": kwargs.get("invalidate") or kwargs.get("inv") or [],
            }
    return None

# ── Docstring metadata extraction ──

def extract_docstring_meta(node):
    """Extract metadata from function docstring @ tags."""
    doc = ast.get_docstring(node)
    if not doc:
        return {}
    meta = {}
    patterns = {
        "purpose": r'@purpose\s+(.+)',
        "description": r'@description\s+(.+)',
        "requires": r'@requires\s+(.+)',
        "produces": r'@produces\s+(.+)',
        "useWhen": r'@useWhen\s+(.+)',
    }
    for key, pat in patterns.items():
        m = re.search(pat, doc)
        if m:
            meta[key] = m.group(1).strip()

    # @tags: comma-separated
    tags_match = re.search(r'@tags\s+(.+)', doc)
    if tags_match:
        meta["tags"] = [t.strip() for t in tags_match.group(1).split(",")]

    # @inputs / @outputs: function names
    for dir_key in ("inputs", "outputs"):
        m = re.search(rf'@{dir_key}\s+(.+)', doc)
        if m:
            meta[dir_key] = [t.strip() for t in m.group(1).split(",")]

    return meta

# ── Is a function exported? ──

def is_exported(name, parent_class=None):
    """Module-level functions are exported unless _-prefixed."""
    if parent_class:
        return not name.startswith('_')
    return not name.startswith('_')

# ── File-level extraction ──

def extract_functions_from_file(filepath: str, root_dir: str, unsafe_vars=None, global_constants=None):
    """Extract all functions and class methods from a Python file."""
    with open(filepath, 'r', encoding='utf-8') as f:
        try:
            tree = ast.parse(f.read())
        except SyntaxError:
            return []

    funcs = []
    rel_path = os.path.relpath(filepath, root_dir)
    imports = build_import_map(tree)
    module_constants = build_module_constants(tree)

    # Classes declaring DRF permission/authentication class attributes
    # (permission_classes = (...)) — their methods are framework-guarded.
    drf_permission_classes = set()
    for cls in ast.walk(tree):
        if not isinstance(cls, ast.ClassDef):
            continue
        for stmt in cls.body:
            if isinstance(stmt, ast.Assign):
                for t in stmt.targets:
                    if isinstance(t, ast.Name) and t.id in (
                            "permission_classes", "authentication_classes"):
                        drf_permission_classes.add(cls.name)

    # Single-pass parent map (O(n)). The old per-node full-tree walk was O(n²)
    # and hung on large real-world files (e.g. fastapi's bigger modules).
    parent_map = {}
    for parent in ast.walk(tree):
        for child in ast.iter_child_nodes(parent):
            parent_map[child] = parent

    def enclosing_class(node):
        cur = parent_map.get(node)
        while cur is not None:
            if isinstance(cur, ast.ClassDef):
                return cur.name
            cur = parent_map.get(cur)
        return None

    for node in ast.walk(tree):
        parent_class = None
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            parent_class = enclosing_class(node)
            name = node.name

            # Params
            params = []
            for arg in node.args.args:
                if arg.arg == 'self' or arg.arg == 'cls':
                    continue
                ptype = get_annotation(arg.annotation) if arg.annotation else "any"
                params.append({"name": arg.arg, "type": ptype})

            return_type = get_annotation(node.returns) if node.returns else "any"
            calls = extract_calls(node, unsafe_vars, imports, module_constants, global_constants)
            # Class-level framework guards: DRF permission classes, auth machinery
            if parent_class:
                if parent_class in drf_permission_classes \
                        and "__progmune_drf_permissions__" not in calls:
                    calls = calls + ["__progmune_drf_permissions__"]
                if re.search(r'authenticat', parent_class, re.I) \
                        and "__progmune_auth_machinery__" not in calls:
                    calls = calls + ["__progmune_auth_machinery__"]
            exported = is_exported(name, parent_class)
            protocol = extract_protocol_from_decorators(node)
            doc_meta = extract_docstring_meta(node)

            func_info = {
                "name": f"{parent_class}.{name}" if parent_class else name,
                "params": params,
                "returnType": return_type,
                "file": rel_path,
                "calls": calls,
                "exported": exported,
                "external": False,
                "description": doc_meta.get("description") or doc_meta.get("purpose") or "",
                "purpose": doc_meta.get("purpose") or "",
                "tags": doc_meta.get("tags") or [],
                "inputs": doc_meta.get("inputs") or [],
                "outputs": doc_meta.get("outputs") or [],
                "requires": doc_meta.get("requires") or "",
                "produces": doc_meta.get("produces") or "",
                "useWhen": doc_meta.get("useWhen") or "",
                "language": "python",
            }

            if protocol:
                func_info["protocol"] = protocol

            funcs.append(func_info)

    return funcs

# ── Main ──

def extract_ir(project_root: str):
    """Walk all .py files and extract IR."""
    all_funcs = []
    unsafe_vars = scan_unsafe_template_vars(project_root)
    global_constants = build_global_constants(project_root)
    for path in Path(project_root).rglob("*.py"):
        # Skip hidden dirs, node_modules, site-packages
        parts = path.parts
        if any(p.startswith('.') for p in parts):
            continue
        if 'node_modules' in parts or 'site-packages' in parts or 'venv' in parts:
            continue
        # Skip test files — tests are not production surface for a security scanner.
        # Checks run on the path RELATIVE to project_root (absolute parts would
        # accidentally match the repo's parent dirs, e.g. .../benchmarks/...).
        rel_parts = path.relative_to(Path(project_root)).parts
        fname = path.name
        if fname.startswith('test_') or fname.endswith('_test.py'):
            continue
        if 'tests' in rel_parts or 'test' in rel_parts[:-1]:
            continue
        # Skip docs/example/benchmark/script dirs — not shipped production surface
        nonsurface = ('docs', 'docs_src', 'examples', 'benchmarks', 'scripts')
        if any(p in nonsurface for p in rel_parts[:-1]):
            continue
        all_funcs.extend(extract_functions_from_file(str(path), project_root, unsafe_vars, global_constants))
    return all_funcs

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python tools/extract_ir.py <project_root> [output_path]")
        sys.exit(1)
    root = sys.argv[1]
    output = sys.argv[2] if len(sys.argv) > 2 else "ir.json"
    functions = extract_ir(root)
    with open(output, "w", encoding="utf-8") as f:
        json.dump(functions, f, indent=2, ensure_ascii=False)
    print(f"✅ IR extracted: {len(functions)} functions → {output}")
