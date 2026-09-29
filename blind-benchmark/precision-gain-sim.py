#!/usr/bin/env python3
"""§49.18 标注投入的**预期收益**——补到每族 N 条后，加权精确率的置信区间会收成什么样？

做法（保持命中率不变的**样本量效应**下界）：
 ① 对每个族，把样本从 (tp, n) 补到 (tp + round((N-n)*tp/n), N)；
 ② 用二项分布重抽样做 bootstrap，重算「按全量族分布加权」的精确率；
 ③ 对比补齐前后的 90% 区间宽度。

⚠ 这是**只算样本量、不算命中率修正**的下界：真实标注会同时改变命中率估计本身
   （0/7 的族一旦标出真漏洞，加权精确率会往上走），那部分收益这里没算。
"""
import json
import random
from collections import Counter

BASE = "/Users/shenlian/progmune-runtime/blind-benchmark"
FULL = f"{BASE}/reports/advisories/fullscan-docmost.jsonl"
GOLD = f"{BASE}/fp-gold.jsonl"

full = [json.loads(l) for l in open(FULL) if l.strip()]
cfull = Counter(a["rule"] for a in full)
ntot = sum(cfull.values())
weights = {r: n / ntot for r, n in cfull.items()}

tp, lab = Counter(), Counter()
for l in open(GOLD):
    if not l.strip():
        continue
    g = json.loads(l)
    if g["repo"] == "docmost" and g["gold"] in ("TP", "FP"):
        lab[g["rule"]] += 1
        if g["gold"] == "TP":
            tp[g["rule"]] += 1


def wilson_upper(k, n, z=1.96):
    if n == 0:
        return 1.0
    p = k / n
    den = 1 + z * z / n
    c = (p + z * z / (2 * n)) / den
    h = z * ((p * (1 - p) / n + z * z / (4 * n * n)) ** 0.5) / den
    return min(1.0, c + h)


def boot(tp_c, lab_c, iters=2000, seed=20260929):
    rnd = random.Random(seed)
    out = []
    for _ in range(iters):
        s = 0.0
        for r, w in weights.items():
            n = lab_c.get(r, 0)
            if not n:
                continue
            p = tp_c[r] / n
            k = sum(1 for _ in range(n) if rnd.random() < p)
            s += w * k / n
        out.append(s * 100)
    out.sort()
    return out[len(out) // 2], out[int(len(out) * 0.05)], out[int(len(out) * 0.95)]


print("=" * 100)
print("补到每族 N 条后：加权精确率的 90% 区间（只算样本量效应）")
print("=" * 100)
m0, l0, h0 = boot(tp, lab)
print(f"  现状（每族 6~39 条）      中位数 {m0:.1f}%   90%CI [{l0:.1f}%, {h0:.1f}%]   宽度 {h0-l0:.1f}pt")
for N in (30, 40, 60, 100):
    tp2, lab2 = Counter(), Counter()
    for r in set(list(lab.keys()) + list(cfull.keys())):
        n0, t0 = lab.get(r, 0), tp.get(r, 0)
        n1 = max(n0, min(N, cfull.get(r, 0)))
        if n1 <= n0:
            tp2[r], lab2[r] = t0, n0
            continue
        add = n1 - n0
        p = (t0 / n0) if n0 else 0.0
        tp2[r] = t0 + round(add * p)
        lab2[r] = n1
    m, l, h = boot(tp2, lab2)
    extra = sum(max(0, min(N, cfull.get(r, 0)) - lab.get(r, 0)) for r in cfull)
    print(f"  补到每族 {N:3} 条（新增 {extra:3} 条）  中位数 {m:.1f}%   90%CI [{l:.1f}%, {h:.1f}%]   宽度 {h-l:.1f}pt")

print()
print("=" * 100)
print("主导族 Wilson 95% 上界的收缩（假设补齐后仍是 0 条真漏洞 ⇒ 最保守）")
print("=" * 100)
print(f"{'规则族':46} {'现在':>10} {'上界':>8} {'补到40':>8} {'上界':>8}")
for r, n in sorted(cfull.items(), key=lambda kv: -kv[1]):
    if n / ntot < 0.05:
        continue
    n0 = lab.get(r, 0)
    k0 = tp.get(r, 0)
    n1 = max(n0, min(40, n))
    k1 = k0 + round((n1 - n0) * (k0 / n0 if n0 else 0))
    print(f"{r[:46]:46} {k0}/{n0:<7} {wilson_upper(k0,n0)*100:7.1f}% {k1}/{n1:<6} {wilson_upper(k1,n1)*100:7.1f}%")
print()
print("读法：CI 宽度从 ~6pt 收到 ~2pt，靠的是把**样本量**补上去；")
print("      而「0/7 → 0/40」让上界从 35% 掉到 7%，靠的是**证伪**：")
print("      标 40 条一条真漏洞都没有，才有底气说这个族真的没价值。")
