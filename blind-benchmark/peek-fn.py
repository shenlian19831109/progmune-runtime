#!/usr/bin/env python3
"""§40 人工核验辅助：按 (repo, file, fn) 取回源码片段，供逐条判 TP/FP。

用法：
  python3 blind-benchmark/peek-fn.py <repo> <file> <fn> [ctx行数]
  python3 blind-benchmark/peek-fn.py --batch residual-pool.json   # 取剩余池全部

只读，不改任何东西。
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
POOL = os.path.join(ROOT, "blind-benchmark", "fp-pool")


def peek(repo: str, file: str, fn: str, ctx: int = 26) -> str:
    p = os.path.join(POOL, repo, file)
    if not os.path.exists(p):
        return f"[缺失] {p}"
    lines = open(p, encoding="utf-8", errors="replace").read().split("\n")
    # 方法名：Class.method → method；顶层函数 → fn
    bare = fn.split(".")[-1]
    # 先找定义行： async? bare(  或  bare =  或 bare(params)
    pats = [
        re.compile(r"^\s*(?:public |private |protected |static |async |readonly )*" + re.escape(bare) + r"\s*\("),
        re.compile(r"^\s*(?:public |private |protected |static |async |readonly )*" + re.escape(bare) + r"\s*=\s*(?:async\s*)?\("),
        re.compile(r"^\s*" + re.escape(bare) + r"\s*[:=]"),
    ]
    hits = []
    for i, ln in enumerate(lines):
        for p_ in pats:
            if p_.match(ln):
                hits.append(i)
                break
    if not hits:
        return f"[未找到定义] {repo}/{file} :: {fn}"
    out = []
    for i in hits[:2]:
        lo = max(0, i - 6)
        hi = min(len(lines), i + ctx)
        out.append(f"----- {repo}/{file}:{i+1} :: {fn} -----")
        for j in range(lo, hi):
            out.append(f"{j+1:5d}| {lines[j]}")
    return "\n".join(out)


def main() -> None:
    if sys.argv[1] == "--batch":
        rows = json.load(open(sys.argv[2]))["rows"]
        seen = set()
        for r in rows:
            k = (r["repo"], r["file"], r["fn"])
            if k in seen:
                continue
            seen.add(k)
            print(peek(r["repo"], r["file"], r["fn"]))
            print()
        return
    repo, file, fn = sys.argv[1], sys.argv[2], sys.argv[3]
    ctx = int(sys.argv[4]) if len(sys.argv) > 4 else 26
    print(peek(repo, file, fn, ctx))


if __name__ == "__main__":
    main()
