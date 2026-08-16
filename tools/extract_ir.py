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


def extract_calls(node, unsafe_vars=None):
    """Extract function call names from a function body (first-level only).

    Attribute calls emit the full qualified chain (e.g. user.change_password,
    User.objects.create_user) so rules can distinguish framework-delegated
    calls from custom same-named functions. Bare-name calls stay as-is.
    Source-level checks emit synthetic marker calls: unparameterized SQL,
    SSRF (user-controlled URL fetch), path traversal, and XSS (unsafe
    template rendering)."""
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

def extract_functions_from_file(filepath: str, root_dir: str, unsafe_vars=None):
    """Extract all functions and class methods from a Python file."""
    with open(filepath, 'r', encoding='utf-8') as f:
        try:
            tree = ast.parse(f.read())
        except SyntaxError:
            return []

    funcs = []
    rel_path = os.path.relpath(filepath, root_dir)

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
            calls = extract_calls(node, unsafe_vars)
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
        all_funcs.extend(extract_functions_from_file(str(path), project_root, unsafe_vars))
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
