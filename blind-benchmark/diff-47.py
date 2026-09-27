#!/usr/bin/env python3
"""
diff-47.py —— 比对 post-47（刀在）与 pre-47（刀已摘）两份**同刻** batch-scan 结果。

按 R57，抑制类改动必须回答三件事：
  · 压了几条（LOST）
  · 新增了几条（ADDED）
  · 其中确认 FP / 确认 TP 各多少（用 fp-gold 逐条核）
并且 LOST 要能逐个归因到「为什么被压」。
零漂移不等于通过（R56）——反过来要问「这一刀在哪个语料上被触发」，
一次都没被触发说明本轮的语料覆盖不住这一刀。

用法：python3 blind-benchmark/diff-47.py
"""
import json
import sys
import collections
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPORTS = ROOT / "blind-benchmark" / "reports"
GOLD = ROOT / "blind-benchmark" / "fp-gold.jsonl"


def load(p):
    d = json.load(open(p))
    return d.get("projects", d) if isinstance(d, dict) else d


def index(rows):
    """(project, fn) -> {rule: count}"""
    idx = collections.defaultdict(collections.Counter)
    for p in rows:
        proj = p.get("project") or p.get("name") or p.get("repo")
        for f in p.get("perFunction", []):
            for v in f.get("safeguardViolations", []):
                idx[(proj, (f.get("name") or "").strip())][v.get("rule")] += 1
    return idx


def main():
    pre_p, post_p = REPORTS / "batch-scan-results.pre-47.json", REPORTS / "batch-scan-results.post-47.json"
    if not pre_p.exists() or not post_p.exists():
        sys.exit("缺文件：先跑 blind-benchmark/base-47.py")
    pre, post = index(load(pre_p)), index(load(post_p))

    lost = collections.Counter()
    added = collections.Counter()
    for k, c in pre.items():
        d = post.get(k, collections.Counter())
        for rule, n in c.items():
            gap = n - d.get(rule, 0)
            if gap > 0: lost[rule] += gap
    for k, c in post.items():
        d = pre.get(k, collections.Counter())
        for rule, n in c.items():
            gap = n - d.get(rule, 0)
            if gap > 0: added[rule] += gap

    print("=" * 72)
    print("§47 同刻基线比对（pre-47 = 摘刀重跑，post-47 = 刀在）")
    print("=" * 72)
    print(f"LOST（这一刀压掉的）: {sum(lost.values())}")
    for rule, n in lost.most_common():
        print(f"   -{n:5d}  {rule}")
    print(f"\nADDED（这一刀引出的）: {sum(added.values())}")
    for rule, n in added.most_common():
        print(f"   +{n:5d}  {rule}")

    if not lost and not added:
        print("\n⚠ 零漂移。R56：这**不等于**通过 —— 必须回答「这一刀在哪个语料上被触发」。")
        print("   若 batch-scan 的合成语料里没有任何函数带 Session 类型参数，")
        print("   说明那里覆盖不住 §47，本轮只能靠真实池的 4 条确认 FP 支撑。")

    # LOST 逐个归因
    if lost:
        print("\n--- LOST 明细（前 30 条，用于逐条归因）---")
        rows = []
        for k, c in pre.items():
            d = post.get(k, collections.Counter())
            for rule, n in c.items():
                gap = n - d.get(rule, 0)
                if gap > 0: rows.append((k[0], k[1], rule, gap))
        for proj, fn, rule, n in rows[:30]:
            print(f"  {proj[:24]:24s} {fn[:34]:34s} {rule}")

    # 与真值核：LOST 落在哪些 gold 上
    gold = [json.loads(l) for l in open(GOLD) if l.strip()]
    gold_idx = collections.defaultdict(set)
    for r in gold:
        gold_idx[(r["repo"], r["fn"].strip())].add(r["gold"])
    lost_keys = {(k[0], k[1]) for k in pre if sum(
        max(0, n - post.get(k, collections.Counter()).get(rule, 0))
        for rule, n in pre[k].items()) > 0}
    hit = [(k, sorted(gold_idx[k])) for k in lost_keys if k in gold_idx]
    print(f"\nLOST 涉及 {len(lost_keys)} 个函数；其中能为 gold 标注命中的 {len(hit)} 个")
    for k, gs in hit[:20]:
        print(f"   {k[0][:24]:24s} {k[1][:34]:34s} gold={gs}")


if __name__ == "__main__":
    main()
