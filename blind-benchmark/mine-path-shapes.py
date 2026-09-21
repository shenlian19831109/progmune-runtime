#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""按 fs sink 反查真实 TS 代码里的「路径实参形态」，统计分布（不只取样）。

用途：给 C4 系列找**真实代码里的新形状**（R17 要求动工前先复现，而形状本身得先从
真实代码里捞出来，不能凭想象编）。与 taintpath 人造语料互补 —— 人造语料负责把已知
形状钉死，本脚本负责发现我们还不知道的形状。

用法：
    PM_ROOTS="<dir1>,<dir2>" python3 blind-benchmark/mine-path-shapes.py

只读文本、不跑 ts-morph ⇒ 本机内存吃紧时也能跑（约定：PM_ROOTS 一次别给太多目录，
否则可能被 OOM kill —— 见 2026-09-21 日志）。

2026-09-21 首次跑的读数（fr-016/fr-007 pre + demo-realworld，48 处 sink）：
    裸标识符 34（71%）/ dirname()+helper 5 / helper 调用 3 / join()+helper 2 /
    下标取值 2 / 其它 1
⇒ 真实代码里路径大多是**上游算好装在变量或成员里**，不是就地拼出来的。由此提出
  C4k 的三个候选形状：构造函数里 `this.x = <shaping>`、`{ path: <shaping> }` 对象成员、
  跨函数返回值传播。
"""
import os, re, collections

ROOTS = os.environ.get("PM_ROOTS", "blind-benchmark/fr-corpus/fr-016-redocly/pre").split(",")

SINK = re.compile(
    r"\b(fs\s*\.\s*|fsp\s*\.\s*)?(readFileSync|writeFileSync|appendFileSync|readFile|writeFile|appendFile|"
    r"createWriteStream|createReadStream|mkdirSync|mkdir|rmSync|unlinkSync|copyFileSync|renameSync|"
    r"sendFile|sendfile|outputFile|outputJson|writeJson|writeJSON)\s*\(",
)

def arg1(text: str, open_idx: int) -> str:
    i, depth, out = open_idx + 1, 1, []
    while i < len(text):
        c = text[i]
        if c in "([{":
            depth += 1
        elif c in ")]}":
            depth -= 1
            if depth == 0:
                break
        elif c == "," and depth == 1:
            break
        elif c in "\"'`":
            q = c; out.append(c); i += 1
            while i < len(text) and text[i] != q:
                if text[i] == "\\":
                    out.append(text[i]); i += 1
                out.append(text[i]); i += 1
            out.append(q); i += 1
            continue
        out.append(c); i += 1
    return "".join(out).strip()

# 形态标签：粗暴但够用，目的是「看分布」而不是精确分类
def classify(a: str) -> str:
    if not a:
        return "空"
    if re.fullmatch(r"[\"'`](?:[^\"'`\\]|\\.)*[\"'`]", a):
        return "纯字面量"
    tags = []
    if "${" in a:
        tags.append("模板串")
    if re.search(r"\+\s*[\"'a-zA-Z_$]", a) or re.search(r"[\"'a-zA-Z_$]\s*\+", a):
        tags.append("拼接")
    for fn in ("join", "resolve", "dirname", "basename", "normalize", "relative", "format", "extname"):
        if re.search(r"\b" + fn + r"\s*\(", a):
            tags.append(fn + "()")
    if re.search(r"\.(slice|substring|replace|split|padStart|trim)\s*\(", a):
        tags.append("字符串方法")
    if re.search(r"\b(decodeURIComponent|encodeURIComponent|decodeURI)\s*\(", a):
        tags.append("URI 解码")
    if re.search(r"\bnew\s+URL\s*\(", a) or "URLSearchParams" in a:
        tags.append("URL 类")
    if re.match(r"^[a-zA-Z_$][\w$]*\s*\(", a) or re.match(r"^[\w$]+\.[\w$]+\s*\(", a):
        tags.append("helper 调用")
    if re.search(r"\[\s*['\"]", a) or re.search(r"\[\s*\w+\s*\]", a):
        tags.append("下标/字典取值")
    if re.fullmatch(r"[a-zA-Z_$][\w$.]*", a):
        tags.append("裸标识符")
    if not tags:
        tags.append("其它")
    return "·".join(dict.fromkeys(tags))

counts = collections.Counter()
examples = collections.defaultdict(list)
files = 0
for root in ROOTS:
    if not os.path.isdir(root):
        continue
    for dp, dirs, fs_ in os.walk(root):
        dirs[:] = [d for d in dirs if d not in ("node_modules", ".git", "dist", "build", ".next", "coverage", "dist-mcp")]
        for f in fs_:
            if not (f.endswith((".ts", ".tsx")) and not f.endswith(".d.ts")):
                continue
            p = os.path.join(dp, f)
            try:
                src = open(p, encoding="utf-8", errors="replace").read()
            except Exception:
                continue
            files += 1
            for m in SINK.finditer(src):
                a = arg1(src, m.end() - 1)
                if not a:
                    continue
                c = classify(a)
                counts[c] += 1
                if len(examples[c]) < 2:
                    line = src[: m.start()].count("\n") + 1
                    examples[c].append(f"{p}:{line}: {a[:100]}")

print(f"扫描 .ts 文件 {files} 个；sink 调用 {sum(counts.values())} 处\n")
print(f"{'形态':44s} {'次数':>4s}")
for c, n in counts.most_common():
    print(f"{c:44s} {n:4d}")
print()
for c, n in counts.most_common(12):
    print(f"── {c} ({n})")
    for e in examples[c]:
        print("   ", e)
