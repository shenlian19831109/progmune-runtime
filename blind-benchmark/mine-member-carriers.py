#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""量化「成员/容器承载」这条漏报轴的真实规模。

背景：C4k 第一轮探针实测发现 —— 对象字面量就地初始化 + 直接读属性（`f.path`）是
传播成功的，但下面几种**不传播**（均漏报）：
    this.p = <污>（含构造函数） → sink o.p
    f.path = <污>（后挂）       → sink f.path
    const { path: p } = f       → sink p
    arr.push(<污>)              → sink arr[0]
    m.set("p", <污>)            → sink m.get("p")

入库时间：2026-09-21（C4k 寻址轮）。它是 `mine-path-shapes.py` 的姊妹脚本 ——
后者回答「真实代码里的路径长什么样」，本脚本回答「把某条召回轴做出来能拿到多少」。

本脚本回答两个问题（只读文本，不跑 ts-morph）：
  Q1 真实代码里 sink 的第一实参有多少是「成员读取 / 下标 / 容器 get」形态？
  Q2 其中有多少能在同文件里找到对应的「属性写入」，且写入的 RHS 疑似带污点？
     —— 这才是做「属性写入→容器传播」能拿到的真实收益上限。
"""
import os, re, collections

ROOTS = os.environ.get(
    "PM_ROOTS",
    "blind-benchmark/fr-corpus/fr-016-redocly/pre,blind-benchmark/fr-corpus/fr-007-openhop/pre,demo-realworld",
).split(",")

SINK = re.compile(
    r"\b(fs\s*\.\s*|fsp\s*\.\s*)?(readFileSync|writeFileSync|appendFileSync|readFile|writeFile|appendFile|"
    r"createWriteStream|createReadStream|mkdirSync|mkdir|rmSync|unlinkSync|copyFileSync|renameSync|"
    r"sendFile|sendfile|outputFile|outputJson|writeJson|writeJSON)\s*\(",
)

TAINT_HINT = re.compile(
    r"\b(req|request|ctx|context)\s*\.\s*(params|query|body|headers|cookies|files)"
    r"|\b(params|query|body|headers)\s*\["
    r"|\bnew\s+URL\s*\("
    r"|\b(decodeURIComponent|decodeURI)\s*\("
    r"|\bURLSearchParams\b"
    r"|\bObject\s*\.\s*keys\s*\("
    r"|\.clientName\b|\.filename\b|\.originalname\b|\.path\b",
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
            q = c
            out.append(c)
            i += 1
            while i < len(text) and text[i] != q:
                if text[i] == "\\":
                    out.append(text[i])
                    i += 1
                out.append(text[i])
                i += 1
            out.append(q)
            i += 1
            continue
        out.append(c)
        i += 1
    return "".join(out).strip()


MEMBER = re.compile(r"^(?:this|[A-Za-z_$][\w$]*)(?:\s*\.\s*[A-Za-z_$][\w$]*)+$")
INDEX = re.compile(r"^[A-Za-z_$][\w$]*\s*\[.+\]$")
GETCALL = re.compile(r"^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*\.\s*get\s*\(")
PLAIN = re.compile(r"^[A-Za-z_$][\w$]*$")

kinds = collections.Counter()
rows = []
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
                line = src[: m.start()].count("\n") + 1
                if MEMBER.fullmatch(a):
                    k = "成员读取 a.b / this.b"
                elif GETCALL.match(a):
                    k = "容器 get()"
                elif INDEX.match(a):
                    k = "下标取值 a[i]"
                elif PLAIN.fullmatch(a):
                    k = "裸标识符(局部变量)"
                else:
                    k = "其它(拼接/调用/字面量)"
                kinds[k] += 1
                rows.append((k, p, line, a))

print(f"扫描 .ts 文件 {files} 个；sink 调用 {len(rows)} 处\n")
print(f"{'实参形态':28s} {'次数':>4s} {'占比':>7s}")
tot = len(rows) or 1
for k, n in kinds.most_common():
    print(f"{k:28s} {n:4d} {100.0*n/tot:6.1f}%")

print("\n── Q2：成员读取里，同文件能找到「属性写入」且 RHS 疑似带污点的（= 收益上限）")
hit = 0
checked = 0
for k, p, line, a in rows:
    if k not in ("成员读取 a.b / this.b", "下标取值 a[i]", "容器 get()"):
        continue
    checked += 1
    src = open(p, encoding="utf-8", errors="replace").read()
    # 取属性名（最后一段）或容器名
    prop = a.split(".")[-1].strip() if k.startswith("成员读取") else None
    obj = a.split(".")[0].strip() if k.startswith("成员读取") else a.split("[")[0].strip()
    pats = []
    if prop:
        pats.append(re.compile(r"(?:this|" + re.escape(obj) + r")\s*\.\s*" + re.escape(prop) + r"\s*=[^=]"))
    if k == "下标取值 a[i]":
        pats.append(re.compile(r"\b" + re.escape(obj) + r"\s*\.\s*push\s*\("))
    if k == "容器 get()":
        pats.append(re.compile(r"\b" + re.escape(obj) + r"\s*\.\s*set\s*\("))
    found = None
    for pt in pats:
        m = pt.search(src)
        if m:
            # 取该行 RHS
            ls = src[: m.start()].count("\n")
            txt = src.split("\n")[ls]
            rhs = txt.split("=", 1)[1] if "=" in txt else txt
            found = (ls + 1, txt.strip()[:110], bool(TAINT_HINT.search(rhs)))
            break
    if found:
        ln, txt, tainted = found
        tag = "疑似污" if tainted else "疑似净"
        if tainted:
            hit += 1
        print(f"  [{tag}] {p}:{line}  sink: {a[:44]:44s} ← 写入 {p.split('/')[-1]}:{ln}  {txt}")
print(f"\n成员/容器形态 {checked} 处；其中能追到写入且 RHS 疑似带污点 = {hit} 处")

# ── 2026-09-21 首次跑的读数（fr-016 pre / fr-007 pre / demo-realworld）──────────
#   扫描 219 个 .ts、48 处 sink：裸标识符 26(54%) / 其它 12(25%) / 成员读取 8(17%) /
#   下标 2(4%)。成员+容器 10 处里能追到属性写入的只有 4 处（全是 redocly
#   oauth-client.ts 的 this.credentialsFile*Path），且 RHS 全部是常量
#   （path.join(homeDirPath, '.redocly')）⇒ **收益上限 0，风险为正**。
# ⇒ C4k 的「属性写入 → 容器传播」轴据此判定为**不修**（见设计稿 §十七）。
#   注意样本只有 219 文件 / 48 sink，结论的强度受样本量限制；换更大的真实语料应重跑。
