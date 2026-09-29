#!/usr/bin/env python3
"""§49.17 召回对照：把官方安全公告（GHSA）对到我们的全量告警上。

两个 layered 输出：

  Part 1  能力矩阵：每条 advisory 的漏洞类型（CWE / 人工推断标签）在我们的规则集里
          **有没有对应规则**。没有 ⇒「能力外」，不是漏报（记 'OUT_OF_SCOPE'）。
  Part 2  实例对照：在能力内的 advisory，去全量告警里找它在**代码位置**上的对应者，
          输出 top-N 候选供人工判定（是否真的是同一个漏洞）。

用法：
  python3 blind-benchmark/advisory-match.py <repo>            # 只看某个仓
  python3 blind-benchmark/advisory-match.py --matrix          # 只看 84 条的能力矩阵
"""
import json
import os
import re
import sys
from collections import Counter, defaultdict

BASE = "/Users/shenlian/progmune-runtime/blind-benchmark"
GHSA = os.path.join(BASE, "reports", "advisories", "ghsa.jsonl")

# ── CWE → 我们的规则族（据 src/protocol-detector.ts 的 SAFEGUARD_RULES 手工映射）──
#   strength: strong = 规则确实针对这个类型；weak = 只能擦边；none = 无对应规则
CWE_MAP = {
    # 注入类
    "CWE-79": ("XSS (Unsafe Template Rendering)", "strong"),
    "CWE-80": ("XSS (Unsafe Template Rendering)", "strong"),
    "CWE-116": ("No Input Sanitization", "weak"),
    "CWE-74": ("No Input Sanitization / Command Injection", "weak"),
    "CWE-78": ("Command Injection", "strong"),
    "CWE-89": ("SQL Injection (Python)", "weak"),   # 仅 Python 形态
    "CWE-94": ("Dynamic Code Execution", "strong"),
    "CWE-1336": ("SSTI (Template Injection)", "strong"),
    "CWE-917": ("SSTI (Template Injection)", "strong"),
    "CWE-611": ("XXE (External Entity Processing)", "strong"),
    "CWE-502": ("Unsafe Deserialization (Pickle)", "weak"),  # 仅 pickle
    "CWE-502-other": (None, "none"),
    # 路径 / 文件
    "CWE-22": ("Path Traversal (User-Controlled File Path)", "strong"),
    "CWE-23": ("Path Traversal (User-Controlled File Path)", "strong"),
    "CWE-59": ("Path Traversal (User-Controlled File Path)", "weak"),
    "CWE-73": ("File Upload Without Validation", "weak"),
    "CWE-434": ("File Upload Without Validation", "strong"),
    # 访问控制
    "CWE-639": ("Authorization (Ownership Check) / (Resource Ownership)", "strong"),
    "CWE-284": ("Authorization (Ownership Check)", "weak"),
    "CWE-285": ("Authorization (Unauthenticated Access)", "strong"),
    "CWE-862": ("Authorization (Unauthenticated Mutation)", "strong"),
    "CWE-863": ("Authorization (Cross-User Resource Write)", "strong"),
    "CWE-287": ("Authorization (Unauthenticated Access)", "weak"),
    "CWE-306": ("Authorization (Unauthenticated Mutation)", "weak"),
    "CWE-269": ("Privilege Escalation (Admin without Role Check)", "strong"),
    "CWE-732": ("Authorization (Resource Ownership)", "weak"),
    # 信息暴露
    "CWE-200": ("Authorization (Unauthenticated Access)", "weak"),
    "CWE-201": ("Authorization (Unauthenticated Access)", "weak"),
    "CWE-209": (None, "none"),
    "CWE-532": (None, "none"),
    "CWE-359": ("Authorization (Resource Ownership)", "weak"),
    # CSRF / Session / 认证
    "CWE-352": ("CSRF Protection Disabled / Exposed GET", "strong"),
    "CWE-384": ("Session Fixation (Logout without Invalidation)", "strong"),
    "CWE-613": ("Session No Timeout", "strong"),
    "CWE-307": ("API Without Rate Limiting / Rate Limiting", "weak"),
    "CWE-384-session": (None, "none"),
    "CWE-620": (None, "none"),
    # 凭据 / 加密
    "CWE-522": ("Token Security (Weak Generation) / Hardcoded Secrets", "weak"),
    "CWE-798": ("Hardcoded Secrets", "strong"),
    "CWE-321": ("Hardcoded Secrets", "weak"),
    "CWE-327": ("Password Hashing (Weak) / Key Derivation Safety", "strong"),
    "CWE-916": ("Password Hashing (Weak) / Key Derivation Safety", "strong"),
    "CWE-330": ("Token Security (Weak Generation)", "weak"),
    "CWE-338": ("Token Security (Weak Generation)", "weak"),
    "CWE-208": (None, "none"),
    "CWE-203": (None, "none"),
    # SSRF / 网络
    "CWE-918": ("SSRF (User-Controlled URL Fetch)", "strong"),
    "CWE-295": ("Certificate Pinning Validation", "weak"),
    "CWE-319": ("TLS Enforcement", "strong"),
    # 输入校验 / DoS
    "CWE-20": ("Input Validation / No Input Sanitization", "strong"),
    "CWE-1284": ("Input Validation", "weak"),
    "CWE-400": (None, "none"),      # 资源耗尽
    "CWE-409": (None, "none"),      # 解压炸弹
    "CWE-770": (None, "none"),      # 无限制资源分配
    "CWE-770-alloc": (None, "none"),
    "CWE-835": (None, "none"),
    "CWE-674": (None, "none"),
    "CWE-476": (None, "none"),
    "CWE-362": (None, "none"),      # 竞态
    "CWE-843": (None, "none"),
    "CWE-346": ("Payment Webhook (No Signature Check)", "weak"),
    "CWE-347": ("Payment Webhook (No Signature Check)", "weak"),
    "CWE-345": ("Payment Order Verification", "weak"),
    "CWE-1021": ("API Without Rate Limiting", "weak"),
    "CWE-770-exhaust": (None, "none"),
}

# 无 CWE / CWE 明显偏了的 advisory，按 summary 人工补一个类型标签（写进 GHSA id）
MANUAL_CWE = {
    "GHSA-84fx-mvqx-p5gx": ["CWE-269"],   # ADMIN 能邀请 OWNER → 权限提升
    "GHSA-rxm9-xp9h-4c84": ["CWE-639"],   # 伪造 attachmentId 越权读附件
    "GHSA-7cq4-577p-wp6p": ["CWE-79"],    # MIME 欺骗导致存储型 XSS
    "GHSA-r4hj-mc62-jmwj": ["CWE-79"],    # Mermaid 集成 XSS
    "GHSA-qvxv-4pj5-64xq": ["CWE-79"],    # 编辑器 Embeds XSS
}

STOP = set(
    """the a an and or of to in on for via with from by at as is are be can allows allow leads
    does not no missing cross over when using use used user users page pages public private
    through leaked leaks exposed exposure disclosure restricts restriction insufficient improper
    unrestricted arbitrary their its his her this that these those it into out up down only
    while before after without within during about more most other than could has have been
    includes include including due feature api apis app value values data content request
    requests response server client side remote local same attachment attachments"""
    .split()
)


def tokens(text):
    """把一句话拆成可匹配的实体 token（小写）。"""
    out = set()
    # 路径片段 /mfa/enable
    for seg in re.findall(r"/([A-Za-z][A-Za-z0-9_-]{2,})", text):
        out.add(seg.lower())
    # 单词与驼峰
    for w in re.findall(r"[A-Za-z][A-Za-z0-9_]{2,}", text):
        w = w.strip("_")
        l = w.lower()
        if l in STOP or len(l) < 4:
            continue
        out.add(l)
        # camelCase 拆分
        parts = re.findall(r"[a-z0-9]+|[A-Z][a-z0-9]*", w)
        for p in parts:
            pl = p.lower()
            if pl in STOP or len(pl) < 4:
                continue
            out.add(pl)
    return out


def alert_surface(a):
    """告警的可匹配面：函数名 + 文件路径 + 规则名。"""
    s = set()
    fn = a.get("fn", "")
    for w in re.findall(r"[A-Za-z][A-Za-z0-9_]{2,}", fn):
        for p in re.findall(r"[a-z0-9]+|[A-Z][a-z0-9]*", w):
            pl = p.lower()
            if pl not in STOP and len(pl) >= 4:
                s.add(pl)
    f = a.get("file", "")
    for seg in re.split(r"[/\\.]", f):
        sl = seg.lower()
        if sl and sl not in STOP and len(sl) >= 4 and sl not in ("node_modules",):
            s.add(sl)
    return s


def capacity(cwes, ghsa):
    """返回 (最强等级, [命中的规则名])"""
    cs = cwes or MANUAL_CWE.get(ghsa) or []
    best = "none"
    hit = []
    for c in cs:
        rule, strength = CWE_MAP.get(c, (None, "none"))
        if rule:
            hit.append(rule)
        rank = {"none": 0, "weak": 1, "strong": 2}
        if rank[strength] > rank[best]:
            best = strength
    if not hit:
        best = "none"
    return best, hit


def main():
    advs = [json.loads(l) for l in open(GHSA)]
    if "--matrix" in sys.argv:
        repos = None
    else:
        repos = sys.argv[1:]

    print("=" * 100)
    print("Part 1 · 能力矩阵：这 84 条官方公告的类型，我们的规则集覆盖吗？")
    print("=" * 100)
    stat = Counter()
    per_repo = defaultdict(Counter)
    weak_list = defaultdict(list)
    for a in advs:
        if repos and a["repo"] not in repos:
            continue
        best, hit = capacity(a["cwes"], a["ghsa"])
        stat[best] += 1
        per_repo[a["repo"]][best] += 1
        if best != "strong":
            weak_list[best].append((a["repo"], a["ghsa"], ",".join(a["cwes"]) or "-", a["summary"][:64]))
    tot = sum(stat.values())
    for k in ("strong", "weak", "none"):
        print(f"  {k:7} {stat[k]:3} / {tot}   ({stat[k]/tot*100:.0f}%)")
    print()
    print("  ⚠ none（规则集完全没有对应规则 ⇒ 能力外，不算漏报）明细：")
    for r, g, c, s in weak_list["none"]:
        print(f"     [{r:10}] {g:24} {c:24} {s}")
    if repos:
        print()
        print("  ⚠ weak（只有擦边规则）明细：")
        for r, g, c, s in weak_list["weak"]:
            print(f"     [{r:10}] {g:24} {c:24} {s}")
    print()

    for repo in repos or []:
        path = os.path.join(BASE, "reports", "advisories", f"fullscan-{repo}.jsonl")
        if not os.path.exists(path):
            print(f"  (无全量扫描结果 {path}，跳过 Part 2)")
            continue
        alerts = [json.loads(l) for l in open(path) if l.strip()]
        surf = [(a, alert_surface(a)) for a in alerts]
        print("=" * 100)
        print(f"Part 2 · 实例对照 [{repo}]：全量告警 {len(alerts)} 条 / "
              f"命中函数 {len({a['fn'] for a in alerts})} 个")
        print("=" * 100)
        rr = [a for a in advs if a["repo"] == repo]
        for a in rr:
            best, hit = capacity(a["cwes"], a["ghsa"])
            if best == "none":
                print(f"\n{a['ghsa']} [{best}] {a['summary'][:70]}")
                print("   → 规则集无对应规则（能力外）")
                continue
            t = tokens(a["summary"])
            scored = []
            for al, s in surf:
                inter = t & s
                if not inter:
                    continue
                scored.append((len(inter), sorted(inter), al))
            scored.sort(key=lambda x: -x[0])
            print(f"\n{a['ghsa']} [{best}] {','.join(a['cwes']) or '-'} | {a['summary'][:70]}")
            print(f"   期望规则族: {'; '.join(hit)[:80]}")
            # 规则族是否真的出现在候选里
            fam = {h.split(" /")[0] for h in hit}
            for n, inter, al in scored[:4]:
                rule_ok = "✓族" if any(h.split(" (")[0] in al["rule"] for h in hit) else " "
                print(f"   {n:2} {rule_ok} {al['rule'][:34]:36} {al['fn'][:26]:28} {al['file'][:44]}")
                print(f"      ∩{inter[:6]}")
            if not scored:
                print("   ✗ 全量告警里没有任何 token 命中（候选为空）")


if __name__ == "__main__":
    main()
