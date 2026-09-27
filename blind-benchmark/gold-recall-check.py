#!/usr/bin/env python3
"""
gold-recall-check.py —— 真值召回核对（可证伪的安全检查）

背景：授权族 66 条人工标注里真漏洞（TP）为 0，所以「压掉 N 条、真漏洞零伤」在这族上是
不可证伪的空话。但 gold 里还有 **24 条别族的确认真漏洞**（Input Validation 12 /
Data Integrity (Foreign Key) 7 / No Input Sanitization 3 / File Upload 2）。

本脚本做的事：拿当前代码扫真实池的结果，与 gold 真值做连接，回答两个可证伪的问题：
  1. 24 条确认真漏洞，现在还报不报？（漏报 = 真出事）
  2. 66 条确认误报，现在还报多少？（压降 = 真实收益）

用法：
  python3 blind-benchmark/gold-recall-check.py [扫描结果路径]

缺省路径：reports/fp-pool-results.current.json
"""
import json
import sys
import collections
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GOLD = ROOT / "blind-benchmark" / "fp-gold.jsonl"
SCAN = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "reports" / "fp-pool-results.current.json"


def norm(s):
    return (s or "").strip()


def load_scan():
    d = json.load(open(SCAN))
    # 兼容两种结构：顶层 {results:[...]} 或 顶层就是数组
    items = d.get("results") if isinstance(d, dict) and "results" in d else d
    if isinstance(items, dict):
        items = [items]
    idx = {}
    for repo_block in items:
        repo = repo_block.get("repo")
        for f in repo_block.get("perFunction", []):
            name = norm(f.get("name"))
            fired = set()
            for v in f.get("safeguardViolations", []):
                r = v.get("rule") or v.get("label") or v.get("type")
                if r:
                    fired.add(norm(r))
            for v in f.get("protocolViolations", []):
                r = v.get("rule") or v.get("label") or v.get("type")
                if r:
                    fired.add(norm(r))
            for v in repo_block.get("resourceViolations", []) or []:
                r = v.get("rule") or v.get("label") or v.get("type")
                if r:
                    fired.add(norm(r))
            # 同一个 repo 下函数名可能重复（不同文件）→ 用 list 累积
            idx.setdefault((repo, name), set()).update(fired)
    return idx


def main():
    rows = [json.loads(l) for l in open(GOLD) if l.strip()]
    idx = load_scan()

    tp_rows = [r for r in rows if r["gold"] == "TP"]
    fp_rows = [r for r in rows if r["gold"] == "FP"]

    def fires(r):
        key = (r["repo"], norm(r["fn"]))
        if key not in idx:
            return None  # 切片里没这个函数 → 无法判定
        return norm(r["rule"]) in idx[key]

    print(f"扫描结果：{SCAN.name}   函数索引 {len(idx)} 条")
    print()
    print("=" * 78)
    print("【1】24 条确认真漏洞（TP）当前是否还报  —— 漏报即为真事故")
    print("=" * 78)
    tp_hit = tp_miss = tp_unknown = 0
    misses = []
    for r in tp_rows:
        s = fires(r)
        if s is None:
            tp_unknown += 1
            mark = "? 切片无此函数"
        elif s:
            tp_hit += 1
            mark = "✓ 仍报"
        else:
            tp_miss += 1
            misses.append(r)
            mark = "✗ 漏报"
        print(f"  {mark:16s} {r['repo'][:28]:28s} {r['rule'][:32]:32s} {r['fn'][:34]}")
    print()
    print(f"  小计：命中 {tp_hit} / 漏报 {tp_miss} / 无法判定 {tp_unknown}")
    if misses:
        print()
        print("  ⚠ 漏报清单（这些是确认真漏洞，被压掉了）:")
        for r in misses:
            print(f"    - {r['repo']} :: {r['fn']}  [{r['rule']}]  {r['file']}")

    print()
    print("=" * 78)
    print("【2】授权族 66 条确认误报（FP）当前还剩多少  —— 压降即为真实收益")
    print("=" * 78)
    authz_fp = [r for r in fp_rows if "Authorization" in r["rule"] or "Ownership" in r["rule"]]
    a_hit = a_miss = a_unknown = 0
    for r in authz_fp:
        s = fires(r)
        if s is None:
            a_unknown += 1
        elif s:
            a_hit += 1
        else:
            a_miss += 1
    print(f"  授权族确认误报 {len(authz_fp)} 条：仍报 {a_hit} / 已压掉 {a_miss} / 无法判定 {a_unknown}")
    if len(authz_fp):
        print(f"  ⇒ 已压掉比例 {a_miss}/{len(authz_fp)} = {a_miss/len(authz_fp)*100:.0f}%")

    print()
    print("=" * 78)
    print("【3】全量 FP（各族）当前剩余")
    print("=" * 78)
    agg = collections.defaultdict(lambda: [0, 0, 0])  # hit / miss / unknown
    for r in fp_rows:
        s = fires(r)
        k = 0 if s else (1 if s is False else 2)
        agg[r["rule"]][k] += 1
    for rule, (hit, miss, unk) in sorted(agg.items(), key=lambda kv: -sum(kv[1])):
        tot = hit + miss + unk
        print(f"  {tot:4d}  {rule[:44]:44s} 仍报 {hit:4d}  压掉 {miss:4d}  未知 {unk:3d}")


if __name__ == "__main__":
    main()
