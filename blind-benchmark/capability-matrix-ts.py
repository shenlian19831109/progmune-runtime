#!/usr/bin/env python3
"""§49.18 能力矩阵（**按语言口径重算**）—— 规则存在 ≠ 规则会在目标语言上执行。

§49.17 的 L1 矩阵按 CWE 映射算「54% 覆盖」，但那个映射**没有考虑 `languages` 字段**：
`SAFEGUARD_RULES` 里 15 条规则声明了 `languages: ["python"]` / `["c"]`（XSS / SSTI / XXE /
CSRF / 命令注入 / SQL 注入 / 硬编码密钥 / 反序列化 / 跨用户写 …），在 **TypeScript 项目上
永远不会触发**。docmost 全量扫描（1202 条告警）实证只覆盖 **21 个族**，也印证了这一点。

本脚本把「宣称覆盖」拆成三档：
    WIRED      命中的规则在 TS 上可触发
    NOT_WIRED  规则存在、CWE 也映射上了，但那条规则是 python/c-only ⇒ TS 上 never fires
    NONE       根本没有对应规则（能力外）

用法：python3 blind-benchmark/capability-matrix-ts.py
"""
import json
import os
from collections import Counter, defaultdict

BASE = "/Users/shenlian/progmune-runtime/blind-benchmark"
GHSA = os.path.join(BASE, "reports", "advisories", "ghsa.jsonl")
FULL = os.path.join(BASE, "reports", "advisories", "fullscan-docmost.jsonl")

# ① 静态：src/protocol-detector.ts 里声明了 languages 且不含 typescript/javascript 的规则
STATIC_NON_TS = {
    "Key Derivation Safety", "Certificate Pinning Validation",
    "Unsafe Deserialization (Pickle)", "Command Injection", "Hardcoded Secrets",
    "Dynamic Code Execution", "Context Manager Usage", "SQL Injection (Python)",
    "Authorization (Cross-User Resource Write)", "XSS (Unsafe Template Rendering)",
    "SSTI (Template Injection)", "XXE (External Entity Processing)",
    "CSRF Protection Disabled", "CSRF Exposed GET State Change",
    "Authorization via Client Cookie",
}

# ② 实证：docmost（TypeScript）全量扫描里真的触发过的族
def ts_fired_rules():
    s = set()
    if os.path.exists(FULL):
        for l in open(FULL):
            if l.strip():
                s.add(json.loads(l)["rule"])
    return s


# ── 与 advisory-match.py 相同的 CWE→规则映射（保持单一口径，复制而非 import 以免耦合）──
CWE_MAP = {
    "CWE-79": "XSS (Unsafe Template Rendering)",
    "CWE-80": "XSS (Unsafe Template Rendering)",
    "CWE-116": "No Input Sanitization",
    "CWE-74": "No Input Sanitization",
    "CWE-78": "Command Injection",
    "CWE-89": "SQL Injection (Python)",
    "CWE-94": "Dynamic Code Execution",
    "CWE-1336": "SSTI (Template Injection)",
    "CWE-917": "SSTI (Template Injection)",
    "CWE-611": "XXE (External Entity Processing)",
    "CWE-502": "Unsafe Deserialization (Pickle)",
    "CWE-22": "Path Traversal (User-Controlled File Path)",
    "CWE-23": "Path Traversal (User-Controlled File Path)",
    "CWE-59": "Path Traversal (User-Controlled File Path)",
    "CWE-73": "File Upload Without Validation",
    "CWE-434": "File Upload Without Validation",
    "CWE-639": "Authorization (Ownership Check) / Authorization (Cross-User Resource Write)",
    "CWE-284": "Authorization (Ownership Check)",
    "CWE-285": "Authorization (Unauthenticated Access)",
    "CWE-862": "Authorization (Unauthenticated Mutation)",
    "CWE-863": "Authorization (Cross-User Resource Write) / Authorization (Ownership Check)",
    "CWE-287": "Authorization (Unauthenticated Access)",
    "CWE-306": "Authorization (Unauthenticated Mutation)",
    "CWE-269": "Privilege Escalation (Admin without Role Check)",
    "CWE-732": "Authorization (Resource Ownership)",
    "CWE-200": "Authorization (Unauthenticated Access)",
    "CWE-201": "Authorization (Unauthenticated Access)",
    "CWE-359": "Authorization (Resource Ownership)",
    "CWE-352": "CSRF Protection Disabled",
    "CWE-384": "Session Fixation (Logout without Invalidation)",
    "CWE-613": "Session No Timeout",
    "CWE-307": "API Without Rate Limiting",
    "CWE-522": "Token Security (Weak Generation)",
    "CWE-798": "Hardcoded Secrets",
    "CWE-321": "Hardcoded Secrets",
    "CWE-327": "Password Hashing (Weak)",
    "CWE-916": "Password Hashing (Weak)",
    "CWE-330": "Token Security (Weak Generation)",
    "CWE-338": "Token Security (Weak Generation)",
    "CWE-918": "SSRF (User-Controlled URL Fetch)",
    "CWE-295": "Certificate Pinning Validation",
    "CWE-319": "TLS Enforcement",
    "CWE-20": "Input Validation",
    "CWE-1284": "Input Validation",
    "CWE-346": "Payment Webhook (No Signature Check)",
    "CWE-347": "Payment Webhook (No Signature Check)",
    "CWE-345": "Payment Order Verification",
    "CWE-1021": "API Without Rate Limiting",
    "CWE-601": None, "CWE-915": None, "CWE-532": None, "CWE-1286": None, "CWE-1289": None,
    "CWE-289": None, "CWE-208": None, "CWE-209": None, "CWE-362": None, "CWE-843": None,
    "CWE-400": None, "CWE-409": None, "CWE-770": None, "CWE-835": None, "CWE-674": None,
    "CWE-476": None, "CWE-620": None, "CWE-203": None,
}
MANUAL_CWE = {
    "GHSA-84fx-mvqx-p5gx": ["CWE-269"],
    "GHSA-rxm9-xp9h-4c84": ["CWE-639"],
    "GHSA-7cq4-577p-wp6p": ["CWE-79"],
    "GHSA-r4hj-mc62-jmwj": ["CWE-79"],
    "GHSA-qvxv-4pj5-64xq": ["CWE-79"],
}


def classify(rule_expr, fired):
    """给定一条 CWE 映射出的规则表达式，判断它在 TS 上接没接线。"""
    if not rule_expr:
        return "NONE", rule_expr
    cands = [c.strip() for c in rule_expr.split("/")]
    ts_ok = [c for c in cands if c not in STATIC_NON_TS]
    # 实证下界：在 docmost 上真触发过 ⇒ 一定接线
    empirical = [c for c in ts_ok if c in fired]
    if empirical:
        return "WIRED(实证)", rule_expr
    if ts_ok:
        return "WIRED(静态)", rule_expr
    return "NOT_WIRED", rule_expr


def main():
    fired = ts_fired_rules()
    advs = [json.loads(l) for l in open(GHSA)]
    print(f"TypeScript 实证触发过的规则族（docmost 全量扫描）：{len(fired)} 个")
    print(f"静态声明为非 TS 语言的规则：{len(STATIC_NON_TS)} 条")
    print()
    stat = Counter()
    detail = defaultdict(list)
    per_repo = defaultdict(Counter)
    for a in advs:
        cs = a["cwes"] or MANUAL_CWE.get(a["ghsa"]) or []
        best = "NONE"
        expr = None
        for c in cs:
            k, e = classify(CWE_MAP.get(c), fired)
            rank = {"NONE": 0, "NOT_WIRED": 1, "WIRED(静态)": 2, "WIRED(实证)": 3}
            if rank[k] > rank[best]:
                best, expr = k, e
        stat[best] += 1
        per_repo[a["repo"]][best] += 1
        detail[best].append((a["repo"], a["ghsa"], ",".join(cs) or "-", expr, a["summary"][:52]))

    tot = sum(stat.values())
    print("=" * 100)
    print(f"§49.18 能力矩阵（TypeScript 口径）  —— 84 条官方公告")
    print("=" * 100)
    for k in ("WIRED(实证)", "WIRED(静态)", "NOT_WIRED", "NONE"):
        print(f"  {k:12} {stat[k]:3} / {tot}   ({stat[k]/tot*100:.0f}%)")
    print()
    print("  ⚠ NOT_WIRED：**规则存在、CWE 也映射上了，但那条规则是 python/c-only**")
    print("    ⇒ 在 TS 项目上永远不会触发。比「没有规则」更隐蔽 —— 能力矩阵会说它覆盖。")
    for r, g, c, e, s in detail["NOT_WIRED"]:
        print(f"     [{r:10}] {g:24} {c:22} → {e[:44]:46} {s}")
    print()
    print("  ⚠ NONE：规则集根本没有对应规则（能力外）")
    for r, g, c, e, s in detail["NONE"][:12]:
        print(f"     [{r:10}] {g:24} {c:22} {s}")
    if len(detail["NONE"]) > 12:
        print(f"     … 另 {len(detail['NONE'])-12} 条")
    print()
    print("── 按仓库 ──")
    for repo, cc in per_repo.items():
        n = sum(cc.values())
        print(f"  {repo:11} {n:3} 条   实证接线 {cc['WIRED(实证)']:2} / 静态 {cc['WIRED(静态)']:2} "
              f"/ 未接线 {cc['NOT_WIRED']:2} / 能力外 {cc['NONE']:2}")
    print()
    wired = stat["WIRED(实证)"] + stat["WIRED(静态)"]
    print(f"§49.17 名义覆盖（不看语言）：54% strong / 28 条 none")
    print(f"§49.18 TS 实际可触发：      {wired/tot*100:.0f}%"
          f"（另有 {stat['NOT_WIRED']/tot*100:.0f}% 是「看着有、其实没接线」）")


if __name__ == "__main__":
    main()
