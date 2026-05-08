#!/usr/bin/env python3
"""提取 Python 项目的函数签名、类型注解和调用关系，输出为 ir.json。"""

import ast
import sys
import json
import os
from pathlib import Path

def get_annotation(node):
    """获取类型注解的字符串表示，若无则返回 'any'。"""
    if node is None:
        return "any"
    # 处理简单类型如 int, str, 自定义类名, 泛型如 List[int] 等
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Constant):
        return str(node.value)
    if isinstance(node, ast.Subscript):
        # 如 List[int], Optional[str]
        value = get_annotation(node.value)
        slice_ = get_annotation(node.slice)
        return f"{value}[{slice_}]"
    if isinstance(node, ast.Tuple):
        return ", ".join(get_annotation(e) for e in node.elts)
    if isinstance(node, ast.BinOp):
        # Union 类型: X | Y
        left = get_annotation(node.left)
        right = get_annotation(node.right)
        return f"{left} | {right}"
    # 其他复杂类型，返回源码
    try:
        return ast.unparse(node)
    except:
        return "any"

def extract_calls(node):
    """提取函数体内一级函数调用名称。"""
    calls = set()
    for child in ast.walk(node):
        if isinstance(child, ast.Call):
            func = child.func
            if isinstance(func, ast.Name):
                calls.add(func.id)
            elif isinstance(func, ast.Attribute):
                # obj.method() -> 记录 method 或完整路径
                calls.add(func.attr)
    return list(calls)

def extract_functions_from_file(filepath: str, root_dir: str):
    """从单个 Python 文件提取函数信息。"""
    with open(filepath, 'r', encoding='utf-8') as f:
        try:
            tree = ast.parse(f.read())
        except SyntaxError:
            return []
    funcs = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            # 跳过类内部的方法，我们只提取顶层函数（可扩展）
            # 简单起见，这里把方法也提取，因为调用图会用到
            name = node.name
            params = []
            for arg in node.args.args:
                param_name = arg.arg
                param_type = get_annotation(arg.annotation) if arg.annotation else "any"
                params.append({"name": param_name, "type": param_type})
            return_type = get_annotation(node.returns) if node.returns else "any"
            calls = extract_calls(node)
            rel_path = os.path.relpath(filepath, root_dir)
            funcs.append({
                "name": name,
                "params": params,
                "returnType": return_type,
                "file": rel_path,
                "calls": calls
            })
    return funcs

def extract_ir(project_root: str):
    """遍历项目下所有 .py 文件，提取 IR。"""
    all_funcs = []
    for path in Path(project_root).rglob("*.py"):
        all_funcs.extend(extract_functions_from_file(str(path), project_root))
    return all_funcs

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python extract_ir.py <项目根目录>")
        sys.exit(1)
    root = sys.argv[1]
    functions = extract_ir(root)
    with open("ir.json", "w", encoding="utf-8") as f:
        json.dump(functions, f, indent=2, ensure_ascii=False)
    print(f"✅ IR 提取完成: {len(functions)} 个函数 -> ir.json")
