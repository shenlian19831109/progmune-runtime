#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
auth-result-probe.py —— §46 ③ 顶层债务的量化（只读）

债务描述
--------
safeguard 只看「**是否调用**」了 auth 词表里的函数，不看「**是否检查其结果**」。
于是这两种写法被同等对待：

    const u = getSession(t); if (!u) return null;   ← 真检查了
    getSession(t); return data;                     ← 调用了但结果被丢弃（真漏洞）

收紧（要求检查结果）会把后者变成告警 ⇒ **增报**。本探针回答：增报面有多大？

做法
----
扫 **全部** 函数（不是只扫违规的 —— 被豁免的函数才是收紧的对象）：
  对每个函数体，检测是否调用了 auth 词表里的函数，以及结果是否被 `if (!x) return|throw` 守卫。
  · GUARDED   —— 调用了且守卫了 ⇒ 收紧后仍豁免（安全）
  · BARE      —— 调用了但没守卫 ⇒ 收紧后会**新增告警**（风险面）
  · NO_AUTH   —— 压根没调用 ⇒ 收紧前后都报（不受影响）

用法
----
  python3 blind-benchmark/auth-result-probe.py blind \
      --results blind-benchmark/reports/batch-scan-results.json --root blind-benchmark/generated
  python3 blind-benchmark/auth-result-probe.py pool \
      --results blind-benchmark/reports/fp-pool-results.post-45.json --root blind-benchmark/fp-pool
"""
import argparse, json, os, re, sys, collections, importlib.util

spec = importlib.util.spec_from_file_location(
    "bep", os.path.join(os.path.dirname(os.path.abspath(__file__)), "body-evidence-probe.py"))
bep = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bep)

# 与 protocol-detector 的 auth_check 词表同源的**核心校验动词**（不含标记/装饰器）
AUTH_CALL = re.compile(
    r"\b(getUser|getSession|getSessionUser|getCurrentUser|validateToken|verifyToken|"
    r"validateSession|verifySession|requireAuth|withAuth|checkAuth|isAuth|hasAuth|"
    r"authenticate|get_user|get_session_user|get_current_user|validate_session|verify_token)\b",
    re.I,
)


def classify(body: str):
    if not body:
        return "BODY_MISSING"
    if not AUTH_CALL.search(body):
        return "NO_AUTH"
    if bep.GUARDED.search(body):
        return "GUARDED"
    return "BARE"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["blind", "pool"])
    ap.add_argument("--results", required=True)
    ap.add_argument("--root", required=True)
    ap.add_argument("--show", type=int, default=8)
    ap.add_argument("--dump-bare", help="把 BARE 清单写为 json（供 auth-result-impact-probe 交叉）")
    a = ap.parse_args()

    d = json.load(open(a.results))
    rows = []
    if a.mode == "blind":
        for pr in d["projects"]:
            for v in pr.get("perFunction", []):
                rows.append((pr["project"], v["file"], v["name"]))
    else:
        for r in d:
            for v in r["perFunction"]:
                rows.append((r["repo"], v["file"], v["name"]))

    print(f"函数总数: {len(rows)}")
    cnt = collections.Counter()
    bare_examples = []
    cache = {}
    for proj, rel, name in rows:
        path = os.path.join(a.root, proj, rel)
        if path not in cache:
            if not os.path.exists(path):
                cache[path] = ""
            else:
                cache[path] = open(path, encoding="utf-8", errors="replace").read()
        src = cache[path]
        if not src:
            cnt["FILE_MISSING"] += 1
            continue
        body = bep.find_body(src, name.split(".")[-1])
        k = classify(body)
        cnt[k] += 1
        if k == "BARE" and len(bare_examples) < a.show:
            bare_examples.append((proj, name, body))

    print("\n=== 分类（收紧后的影响面） ===")
    for k in ["GUARDED", "BARE", "NO_AUTH", "BODY_MISSING", "FILE_MISSING"]:
        if cnt[k]:
            print(f"  {cnt[k]:6d}  {k}")
    bare_total = cnt["BARE"]
    guarded_total = cnt["GUARDED"]
    if guarded_total + bare_total:
        print(f"\n  收紧后新增告警面 = BARE / (GUARDED+BARE) = "
              f"{bare_total}/{guarded_total + bare_total} = "
              f"{bare_total / (guarded_total + bare_total) * 100:.1f}%")

    if a.dump_bare:
        all_bare = []
        for proj, rel, name in rows:
            path = os.path.join(a.root, proj, rel)
            src = cache.get(path, "")
            if not src:
                continue
            body = bep.find_body(src, name.split(".")[-1])
            if classify(body) == "BARE":
                all_bare.append({"project": proj, "file": rel, "name": name})
        json.dump(all_bare, open(a.dump_bare, "w"), ensure_ascii=False, indent=1)
        print(f"\nBARE 清单已写入 {a.dump_bare}（{len(all_bare)} 条）")

    print(f"\n=== BARE 样例（前 {a.show} 条，收紧后会新增告警） ===")
    for proj, name, body in bare_examples:
        print(f"----- [{proj}] {name} -----")
        if body:
            print("\n".join(body.split("\n")[:10]))
        print()


if __name__ == "__main__":
    main()
