#!/usr/bin/env python3
"""§49.17 把 gold 的每族命中率按**全量告警的族分布**加权。

gold 已被证明严重偏向全量里的小族（见 gold-bias.py），所以要问
「线上（全量）精确率大概是多少」，必须对族分布做再加权。
"""
import json
from collections import Counter, defaultdict

BASE = "/Users/shenlian/progmune-runtime/blind-benchmark"

full = {}
for line in open(f"{BASE}/reports/advisories/fullscan-docmost.jsonl"):
    if line.strip():
        a = json.loads(line)
        full[(a["fn"], a["file"], a["rule"])] = a

gold = [json.loads(l) for l in open(f"{BASE}/fp-gold.jsonl") if l.strip()]
g_doc = [g for g in gold if g["repo"] == "docmost"]

# ── gold 每族命中率（分母只算 TP+FP，UNKNOWN 不计入 —— 两种口径都给）──
tp_cnt, fp_cnt, unk_cnt = Counter(), Counter(), Counter()
for g in g_doc:
    if g["gold"] == "TP":
        tp_cnt[g["rule"]] += 1
    elif g["gold"] == "FP":
        fp_cnt[g["rule"]] += 1
    else:
        unk_cnt[g["rule"]] += 1

# 全量族分布
cfull = Counter(a["rule"] for a in full.values())
ntot = sum(cfull.values())

print("=" * 100)
print("gold 每族的命中率 × 全量族分布 ⇒ 加权后的「线上」精确率")
print("=" * 100)
print(f"{'规则族':40} {'gold TP':>7} {'gold TP+FP':>10} {'gold命中率':>9} {'全量条数':>8} {'加权贡献':>9}")
rows = sorted(set(cfull) | set(tp_cnt) | set(fp_cnt), key=lambda r: -cfull.get(r, 0))

#  被 gold 采到的族 vs 完全没采到的族分开算
covered = 0.0          # 有 gold 命中率估计的部分
covered_mass = 0
uncovered_mass = 0
uncovered_rules = []
for r in rows:
    n_g = tp_cnt[r] + fp_cnt[r]
    w = cfull.get(r, 0) / ntot
    if n_g:
        rate = tp_cnt[r] / n_g
        covered += w * rate
        covered_mass += cfull.get(r, 0)
    else:
        uncovered_mass += cfull.get(r, 0)
        uncovered_rules.append((r, cfull.get(r, 0)))
        rate = None
    print(
        f"{r[:40]:40} {tp_cnt[r]:7} {n_g:10} "
        f"{(f'{rate*100:.1f}%' if rate is not None else '  (无样本)'):>9} "
        f"{cfull.get(r,0):8} {(f'{w*rate*100:.2f}%' if rate is not None else '   —'):>9}"
    )

# gold 本身的整体精确率
n_tp_all = sum(tp_cnt.values())
n_lab = n_tp_all + sum(fp_cnt.values())
print()
print(f"gold 自身（未加权）精确率     : {n_tp_all}/{n_lab} = {n_tp_all/n_lab*100:.1f}%")
print(f"  其中 UNKNOWN（未计入分母）  : {sum(unk_cnt.values())} 条")
print()
print(f"有 gold 样本覆盖到的全量告警  : {covered_mass} 条（占全量 {covered_mass/ntot*100:.1f}%）")
print(f"  这部分加权精确率            : {covered/(covered_mass/ntot)*100:.1f}%  ← 只在该子集上")
print(f"  折算到全量的 TP 贡献        : {covered*100:.2f}% × {ntot} = {covered*ntot:.0f} 条（期望值）")
print()
print(f"⚠ 全量里**完全没有 gold 样本**的告警: {uncovered_mass} 条（{uncovered_mass/ntot*100:.1f}%）")
for r, n in sorted(uncovered_rules, key=lambda x: -x[1])[:10]:
    print(f"   {r[:50]:52} {n:6} 条")
print()
print("读法：这 **1100 条**告警的命中率我们一无所知 —— 连一个样本都没标过。")
print("      所以「线上精确率」的上界/下界必须把它们的两种极端都算进去：")
lo = covered * ntot
hi = covered * ntot + uncovered_mass
print(f"      下界（未覆盖部分全是 FP）: {lo}/{ntot} = {lo/ntot*100:.1f}%")
print(f"      上界（未覆盖部分全是 TP）: {hi}/{ntot} = {hi/ntot*100:.1f}%  ← 不可能，但说明能差到哪去")
