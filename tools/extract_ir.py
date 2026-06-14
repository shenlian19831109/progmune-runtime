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

def extract_calls(node):
    """Extract function call names from a function body (first-level only)."""
    calls = []
    seen = set()
    for child in ast.walk(node):
        if isinstance(child, ast.Call):
            func = child.func
            name = None
            if isinstance(func, ast.Name):
                name = func.id
            elif isinstance(func, ast.Attribute):
                name = func.attr
            if name and name not in seen:
                seen.add(name)
                calls.append(name)
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

def extract_functions_from_file(filepath: str, root_dir: str):
    """Extract all functions and class methods from a Python file."""
    with open(filepath, 'r', encoding='utf-8') as f:
        try:
            tree = ast.parse(f.read())
        except SyntaxError:
            return []

    funcs = []
    rel_path = os.path.relpath(filepath, root_dir)
    for node in ast.walk(tree):
        parent_class = None
        # Check if this function is inside a class
        for parent in ast.walk(tree):
            if isinstance(parent, ast.ClassDef):
                for child in ast.walk(parent):
                    if child is node:
                        parent_class = parent.name
                        break
                if parent_class:
                    break

        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            name = node.name

            # Params
            params = []
            for arg in node.args.args:
                if arg.arg == 'self' or arg.arg == 'cls':
                    continue
                ptype = get_annotation(arg.annotation) if arg.annotation else "any"
                params.append({"name": arg.arg, "type": ptype})

            return_type = get_annotation(node.returns) if node.returns else "any"
            calls = extract_calls(node)
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
    for path in Path(project_root).rglob("*.py"):
        # Skip hidden dirs, node_modules, site-packages
        parts = path.parts
        if any(p.startswith('.') for p in parts):
            continue
        if 'node_modules' in parts or 'site-packages' in parts or 'venv' in parts:
            continue
        all_funcs.extend(extract_functions_from_file(str(path), project_root))
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
