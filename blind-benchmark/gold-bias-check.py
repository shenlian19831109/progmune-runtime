#!/usr/bin/env python3
"""§49.17 抽样偏差检查：gold 池是不是「全量告警」的一个随机样本？

若不是随机抽样，那么「精确率 6%」「提升 2.4~6.4×」都不能外推到线上。
"""
import json
from collections import Counter

BASE = "/Users/shenlian/progmune-runtime/blind-benchmark"

full = {}
for line in open(f"{BASE}/reports/advisories/fullscan-docmost.jsonl"):
    if not line.strip():
        continue
    a = json.loads(line)
    full.setdefault((a["fn"], a["file"], a["rule"]), a)

# 兜底：裸函数名匹配
full_bare = {}
for (fn, f, r), a in full.items():
    full_bare.setdefault((fn.split(".")[-1], f, r), a)

gold = [json.loads(l) for l in open(f"{BASE}/fp-gold.jsonl") if l.strip()]
g_doc = [g for g in gold if g["repo"] == "docmost"]

hit = miss = 0
missing_rows = []
for g in g_doc:
    k = (g["fn"], g["file"], g["rule"])
    k2 = (str(g["fn"]).split(".")[-1], g["file"], g["rule"])
    if k in full or k2 in full_bare:
        hit += 1
    else:
        miss += 1
        missing_rows.append(g)

print(f"gold 里 docmost 告警        : {len(g_doc)}")
print(f"  能在全量扫描里找到的      : {hit}")
print(f"  找不到的                  : {miss}")
print(f"全量扫描 docmost 告警总数   : {len(full)}")
print(f"⇒ gold 覆盖全量的比例       : {hit/len(full)*100:.1f}%")
print()
if missing_rows:
    print("  找不到的样例（前 5）：")
    for g in missing_rows[:5]:
        print(f"    {g['rule'][:30]:32} {g['fn'][:28]:30} {g['file'][:50]}")
print()

# ── 规则族分布对比 ──
print("=" * 96)
print("规则族分布：gold 抽样 vs 全量（若两者差得多 ⇒ gold 不是随机样本）")
print("=" * 96)
cf = Counter(a["rule"] for a in full.values())
cg = Counter(g["rule"] for g in g_doc)
nf, ng = sum(cf.values()), sum(cg.values())
print(f"{'规则族':44} {'全量':>6} {'全量%':>7} {'gold':>6} {'gold%':>7} {'偏差':>8}")
rows = sorted(set(cf) | set(cg), key=lambda r: -cf.get(r, 0))
for r in rows:
    pf = cf.get(r, 0) / nf * 100
    pg = cg.get(r, 0) / ng * 100
    d = pg - pf
    flag = "  ⚠" if abs(d) >= 5 and cg.get(r, 0) >= 3 else ""
    print(f"{r[:44]:44} {cf.get(r,0):6} {pf:6.1f}% {cg.get(r,0):6} {pg:6.1f}% {d:+7.1f}{flag}")
print()
print("注：偏差 = gold% − 全量%；|偏差|≥5 且 gold 计数≥3 的标 ⚠。")
print("    正偏差 = 该族在 gold 里被过度代表；负偏差 = 被低估。")
