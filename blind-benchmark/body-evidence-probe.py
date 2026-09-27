#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
body-evidence-probe.py —— 函数体证据探针（只读，不改判别逻辑）
=============================================================

为什么要有这个工具
------------------
判别器 `detectSafeguardViolations` 的入参只有 `calls / ownName / params / exposed / paramTypes`
——**单函数视角，看不到函数体**。于是「它为什么是 FP」我们经常知道，「机器怎么知道」不知道。

本探针把「函数体文本」这一层证据拉出来，回答：
  给定一批 safeguard 违规，它们的函数体里究竟有没有 / 有哪些可判别的证据形态？

证据形态（§46 ②/③ 共用）
------------------------
  SUBJECT_ARG       调用实参里出现主体标识（user.id / user.uid / user._id / user.email …）
                    ⇒ 被操作对象由主体定位 ⇒ 已按属主限定
  SELF_OBJECT       对象字面量里 `userId|ownerId|authorId|createdBy: <主体>.id`
                    ⇒ 新建资源的属主就是主体自身
  SCOPED_QUERY      `where:{…userId:…}` / find*(…, { userId: <主体>.id })
                    ⇒ 查询已按属主过滤
  GUARDED_RESULT    `const x = <auth调用>(…)` 之后紧跟 `if (!x) return|throw`
                    ⇒ 认证结果**被检查了**（对应 §46 ③ 的顶层债务）
  BARE_AUTH_CALL    调用了 auth 词表里的词，但结果既没被检查也没被使用
                    ⇒ 顶层债务的反面：认证调用被丢弃

用法
----
  # 合成语料（盲测结果）
  python3 blind-benchmark/body-evidence-probe.py blind \
      --results blind-benchmark/reports/batch-scan-results.json \
      --rule "Authorization (Ownership Check)" \
      --root blind-benchmark/generated

  # 真实切片（FP 池）
  python3 blind-benchmark/body-evidence-probe.py pool \
      --results blind-benchmark/reports/fp-pool-results.post-45.json \
      --rule "Authorization (Ownership Check)" \
      --root blind-benchmark/fp-pool
"""
import argparse, json, os, re, sys, collections

# ---------------------------------------------------------------- 主体标识
# 「当前调用者」的表达式形态。注意不含裸 `user` —— 裸 user 可能是被操作对象。
SUBJECT_EXPR = re.compile(
    r"\b(?:user|currentUser|authUser|me|self|actor|principal|adminUser|"
    r"request\.user|req\.user|session\.user|ctx\.user|context\.user)"
    r"\s*\.\s*(?:id|uid|_id|userId|email|username|workspaceId|sub)\b",
    re.I,
)
# 调用实参里的主体标识：出现在 (… ) 内部
CALL_ARGS = re.compile(r"\(([^()]*)\)")
# 属主字段
OWNER_FIELD = r"(?:userId|ownerId|authorId|createdBy|user_id|owner_id|created_by)"
SELF_OBJECT = re.compile(OWNER_FIELD + r"\s*:\s*" + SUBJECT_EXPR.pattern, re.I)
SCOPED_QUERY = re.compile(
    r"(?:where|filter|criteria)\s*:\s*\{[^}]*" + OWNER_FIELD + r"\s*:\s*[^,}]+",
    re.I | re.S,
)
# 认证调用被守卫：const x = <name>(…); … if (!x) return|throw
AUTH_WORD = (
    r"(?:getUser|getSession|getSessionUser|getCurrentUser|validateToken|verifyToken|"
    r"validateSession|verifySession|authenticate|checkAuth|requireAuth|"
    r"get_user|validate_session|verify_token|authenticate_user)"
)
GUARDED = re.compile(
    r"(?:const|let|var)\s+(\w+)\s*=\s*(?:await\s+)?[\w.]*" + AUTH_WORD + r"\w*\s*\([^)]*\)"
    r"[\s\S]{0,400}?if\s*\(\s*!\s*\1\s*\)\s*(?:return|throw)",
    re.I,
)
BARE_AUTH = re.compile(r"(?:await\s+)?[\w.]*" + AUTH_WORD + r"\w*\s*\(", re.I)


# ---------------------------------------------------------------- 取函数体
def find_body(src: str, name: str):
    """按函数名定位定义，括号配平取出函数体。

    三种载体，按优先级尝试（合成语料是 `export function f(`，
    真实切片多是类方法 `async f(`，少数是箭头 `const f = (`）：
      1. [export] [async] function f(
      2. 类方法 —— 行首 + 修饰符 + f(
      3. 任何 `f(...) {` 形态（避免匹配到调用点：要求后面紧跟 `{`）
    """
    pats = [
        re.compile(r"(?:export\s+)?(?:async\s+)?function\s+" + re.escape(name) + r"\s*\("),
        re.compile(r"\n[ \t]*(?:public |private |protected |async |static |\s)*"
                   + re.escape(name) + r"\s*\("),
        re.compile(r"\b" + re.escape(name) + r"\s*\([^()]*(?:\([^()]*\)[^()]*)*\)\s*(?::[^{;=>]+)?\{"),
    ]
    m = None
    for p in pats:
        m = p.search(src)
        if m:
            break
    if not m:
        return None
    i = src.find("{", m.start())
    if i < 0:
        # 表达式体箭头函数：取到本行末
        eol = src.find("\n", m.start())
        return src[m.start(): eol if eol > 0 else len(src)]
    depth, j = 0, i
    while j < len(src):
        if src[j] == "{":
            depth += 1
        elif src[j] == "}":
            depth -= 1
            if depth == 0:
                break
        j += 1
    return src[m.start(): j + 1]


def evidence(body: str):
    if not body:
        return {"BODY_MISSING"}
    e = set()
    if SUBJECT_EXPR.search(body):
        # 细分：是否落在调用实参内
        for args in CALL_ARGS.findall(body):
            if SUBJECT_EXPR.search(args):
                e.add("SUBJECT_ARG")
                break
        if "SUBJECT_ARG" not in e:
            e.add("SUBJECT_EXPR_OTHER")   # 出现在别处（比较式、赋值右侧…）
    if SELF_OBJECT.search(body):
        e.add("SELF_OBJECT")
    if SCOPED_QUERY.search(body):
        e.add("SCOPED_QUERY")
    if GUARDED.search(body):
        e.add("GUARDED_RESULT")
    if BARE_AUTH.search(body) and "GUARDED_RESULT" not in e:
        e.add("BARE_AUTH_CALL")
    if not e:
        e.add("(none)")
    return e


# ---------------------------------------------------------------- 载入违规
def load_blind(results, rule):
    d = json.load(open(results))
    out = []
    for pr in d["projects"]:
        for v in pr.get("perFunction", []):
            if any(s["rule"] == rule for s in v.get("safeguardViolations", [])):
                out.append((pr["project"], v["file"], v["name"]))
    return out


def load_pool(results, rule):
    d = json.load(open(results))
    out = []
    for r in d:
        for v in r["perFunction"]:
            if any(s["rule"] == rule for s in v.get("safeguardViolations", [])):
                out.append((r["repo"], v["file"], v["name"]))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["blind", "pool"])
    ap.add_argument("--results", required=True)
    ap.add_argument("--rule", required=True)
    ap.add_argument("--root", required=True)
    ap.add_argument("--show", type=int, default=12, help="打印样例条数")
    a = ap.parse_args()

    rows = load_blind(a.results, a.rule) if a.mode == "blind" else load_pool(a.results, a.rule)
    print(f"违规函数总数: {len(rows)}   (rule = {a.rule})")

    cnt = collections.Counter()
    per_row = []
    for proj, rel, name in rows:
        path = os.path.join(a.root, proj, rel) if a.mode == "blind" else os.path.join(a.root, proj, rel)
        if not os.path.exists(path):
            per_row.append((proj, name, {"FILE_MISSING"}))
            cnt["FILE_MISSING"] += 1
            continue
        src = open(path, encoding="utf-8", errors="replace").read()
        body = find_body(src, name.split(".")[-1])
        e = evidence(body)
        per_row.append((proj, name, e))
        for k in e:
            cnt[k] += 1

    print("\n=== 证据形态覆盖（可重叠） ===")
    for k, v in cnt.most_common():
        print(f"  {v:5d}  {k}")

    print(f"\n=== 样例（前 {a.show} 条） ===")
    for proj, name, e in per_row[: a.show]:
        print(f"  [{proj}] {name}\n        {sorted(e)}")

    # 关键组合：有多少「完全没有任何体证据」
    bare = [(p, n) for p, n, e in per_row if e == {"(none)"}]
    print(f"\n零体证据（真正无据可依）: {len(bare)}")
    for p, n in bare[: a.show]:
        print(f"    [{p}] {n}")


if __name__ == "__main__":
    main()
