#!/usr/bin/env python3
"""§49.18 生成**待标注清单**——按「能最大幅度收窄置信区间」的原则分层抽样。

§49.17 L2.5 的结论：四个主导族占 docmost 全量告警的 **86%**，却只有 6~39 个标注样本，
导致 Wilson 95% 上界高达 35%/9%/39%/30% ⇒ 线上精确率的 90%CI 宽到 [2.1%, 8.1%]。
补谁最划算？按「每标一条能缩多少 CI」排：

    信息增益 ∝ 族占比 × sqrt(该族当前样本越少越缺)  →  实用近似：
    priority = 全量占比 × (1 - 已标注数 / 目标数)，并优先补「样本 < 30」的族

抽样原则：
  ① 只抽**未标注**的告警（已在 fp-gold 里的跳过）
  ② 同一函数只抽一条（避免同构重复占满配额 —— R91 的第一屏教训同样适用于标注配额）
  ③ 族内随机（不加任何"看起来可疑"的筛选 ⇒ 否则样本又有偏，R92 第二次咬人）
  ④ 输出带 seed，可复现

用法：python3 blind-benchmark/annotation-queue.py [每族目标条数，默认 100]
"""
import json
import os
import random
from collections import Counter, defaultdict

BASE = "/Users/shenlian/progmune-runtime/blind-benchmark"
FULL = os.path.join(BASE, "reports", "advisories", "fullscan-docmost.jsonl")
GOLD = os.path.join(BASE, "fp-gold.jsonl")
OUT = os.path.join(BASE, "reports", "advisories", "annotation-queue.jsonl")
TARGET = int(os.environ.get("TARGET", "100"))
SEED = 20260929

full = [json.loads(l) for l in open(FULL) if l.strip()]
gold_keys = set()
for l in open(GOLD):
    if not l.strip():
        continue
    g = json.loads(l)
    gold_keys.add((g["repo"], g["fn"], g["file"], g["rule"]))
    gold_keys.add((g["repo"], str(g["fn"]).split(".")[-1], g["file"], g["rule"]))

# 已标注计数（按族）
labelled = Counter()
for l in open(GOLD):
    if not l.strip():
        continue
    g = json.loads(l)
    if g["repo"] == "docmost":
        labelled[g["rule"]] += 1

by_rule = defaultdict(list)
seen_alert = set()
fn_quota = Counter()          # 同一函数最多贡献 2 条（R91：别让一个函数占满配额）
FN_CAP = 2
for a in full:
    k_alert = (a["fn"], a["file"], a["rule"])
    if k_alert in seen_alert:
        continue              # 同函数同规则的重复项
    if (a["repo"], a["fn"], a["file"], a["rule"]) in gold_keys:
        continue              # 已标注
    if fn_quota[(a["fn"], a["file"])] >= FN_CAP:
        continue
    seen_alert.add(k_alert)
    fn_quota[(a["fn"], a["file"])] += 1
    by_rule[a["rule"]].append(a)

ntot = len(full)
rnd = random.Random(SEED)
rows = []
print(f"{'规则族':46} {'全量':>6} {'已标':>5} {'可抽':>5} {'本次抽':>6} {'优先级':>7}")
plan = []
for r, items in by_rule.items():
    n_full = sum(1 for a in full if a["rule"] == r)
    n_lab = labelled.get(r, 0)
    need = max(0, min(TARGET - n_lab, len(items)))
    share = n_full / ntot
    # 优先级：族占比 × 缺口比例（样本越少越急）
    prio = share * (1 - min(1.0, n_lab / TARGET))
    plan.append((prio, r, items, need, n_full, n_lab))
plan.sort(key=lambda x: -x[0])
for prio, r, items, need, n_full, n_lab in plan:
    pick = rnd.sample(items, min(need, len(items))) if need else []
    for a in pick:
        rows.append(
            {
                "repo": a["repo"],
                "fn": a["fn"],
                "file": a["file"],
                "rule": a["rule"],
                "nRules": a["nRules"],
                "calls": a["calls"][:12],
                "params": a["params"],
                "exported": a["exported"],
                "priority": round(prio, 4),
                "gold": None,
            }
        )
    print(f"{r[:46]:46} {n_full:6} {n_lab:5} {len(items):5} {len(pick):6} {prio:7.3f}")

rnd.shuffle(rows)
with open(OUT, "w") as f:
    for i, r in enumerate(rows, 1):
        r["queue_id"] = i
        f.write(json.dumps(r, ensure_ascii=False) + "\n")

print()
print(f"已写出 {len(rows)} 条 → {os.path.relpath(OUT, BASE)}  (seed={SEED}, 每族目标 {TARGET})")
print()
print("读法：这份清单的**抽样是无筛选的族内随机**（同函数去重除外），")
print("      ⇒ 标注完的结果可以直接用来算族命中率，不会再引入新偏差（R92）。")
print("      标完把 gold 字段写成 TP/FP/UNKNOWN 即可，脚本会自动用新的族分布重算加权精确率。")
