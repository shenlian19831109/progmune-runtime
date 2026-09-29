#!/usr/bin/env python3
"""§49.17 bootstrap：把 gold 的族命中率加权到全量分布时，**抽样不确定性**有多大。

做法：在 gold 内做 2000 次自助重抽样，每次重算每族 TP 率（无样本族按 0），
再按全量告警的族分布加权 ⇒ 得到「线上精确率」的分布。
"""
import json
import random
from collections import Counter

BASE = "/Users/shenlian/progmune-runtime/blind-benchmark"

full = {}
for line in open(f"{BASE}/reports/advisories/fullscan-docmost.jsonl"):
    if line.strip():
        a = json.loads(line)
        full[(a["fn"], a["file"], a["rule"])] = a

gold = [json.loads(l) for l in open(f"{BASE}/fp-gold.jsonl") if l.strip()]
g_doc = [g for g in gold if g["repo"] == "docmost" and g["gold"] in ("TP", "FP")]

cfull = Counter(a["rule"] for a in full.values())
ntot = sum(cfull.values())
weights = {r: n / ntot for r, n in cfull.items()}

random.seed(20260928)
samples = []
for _ in range(2000):
    boot = [g_doc[random.randrange(len(g_doc))] for _ in range(len(g_doc))]
    tp, lab = Counter(), Counter()
    for g in boot:
        lab[g["rule"]] += 1
        if g["gold"] == "TP":
            tp[g["rule"]] += 1
    s = 0.0
    for r, w in weights.items():
        if lab.get(r, 0):
            s += w * tp.get(r, 0) / lab[r]
    samples.append(s * 100)

samples.sort()
median = samples[len(samples) // 2]
lo = samples[int(len(samples) * 0.05)]
hi = samples[int(len(samples) * 0.95)]

n_tp = sum(1 for g in g_doc if g["gold"] == "TP")
print(f"gold(docmost) 已标注 {len(g_doc)} 条 / 其中 TP {n_tp} 条 ⇒ 未加权精确率 {n_tp/len(g_doc)*100:.1f}%")
print()
print("加权到全量族分布后的「线上精确率」bootstrap:")
print(f"  中位数   {median:.1f}%")
print(f"  90% 区间 [{lo:.1f}%, {hi:.1f}%]")
print(f"  极差     {samples[0]:.1f}% ~ {samples[-1]:.1f}%")
print()

# 逐族的 Wilson 95% 上界：说明主导族的 0 命中到底有多不确定
def wilson_upper(k, n, z=1.96):
    if n == 0:
        return 1.0
    p = k / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * ((p * (1 - p) / n + z * z / (4 * n * n)) ** 0.5) / denom
    return min(1.0, centre + half)

tp_cnt, fp_cnt = Counter(), Counter()
for g in g_doc:
    (tp_cnt if g["gold"] == "TP" else fp_cnt)[g["rule"]] += 1

print("=" * 100)
print("主导族（占全量 ≥5%）的样本量与 Wilson 95% 上界")
print("=" * 100)
print(f"{'规则族':44} {'全量条数':>8} {'占全量':>7} {'gold样本':>8} {'gold TP':>7} {'命中率':>7} {'95%上界':>8}")
dom = sorted(cfull.items(), key=lambda kv: -kv[1])
for r, n in dom:
    if n / ntot < 0.05:
        continue
    n_g = tp_cnt[r] + fp_cnt[r]
    rate = tp_cnt[r] / n_g if n_g else float("nan")
    print(
        f"{r[:44]:44} {n:8} {n/ntot*100:6.1f}% {n_g:8} {tp_cnt[r]:7} "
        f"{(f'{rate*100:.0f}%' if n_g else '  —'):>7} {wilson_upper(tp_cnt[r], n_g)*100:7.1f}%"
    )
print()
print("读法：○ 全量 86% 的告警落在四个族里，而它们的 gold 样本只有 6~39 条。")
print("      ○ 「0 条真漏洞」不等于「真漏洞率 0%」—— 0/6 的 95% 上界是 39%。")
print("      ○ 所以 1.3%~19.9% 这个区间不是算法不好，是**标注量不够**。")
