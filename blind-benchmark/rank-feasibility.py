#!/usr/bin/env python3
"""
§49.10 路线 A 可行性 —— 「把链上信号做成**排序**」到底值不值？（2026-09-27）

背景：§49.9 把压制型判据三方向全否决了，只剩**正向提级/排序**。但「信号可分」
（TP 83% 撞到请求入口 vs FP 28%）从来不等于「排序有用」（R79）——必须落到排序指标上：
用户实际看到的是一个**列表**，真正决定体验的是**列表前段**里真漏洞的密度。

所以本脚本只回答一个问句：把「追到请求入口」这一条信号当作排序依据，列表前 k% 里
真漏洞的密度比随机排高多少？为此算 precision@k、lift、以及 ROC 的 AUC。

口径（要挑明，否则数字会被误读）：
  - **只用 TP / FP 两组**（gold 确定的两组）。UNKNOWN 组真值未知，混进来会让分母虚高、
    两边的可比性丧失（R77 的分母意识）。
  - 样本是 **gold 覆盖到的告警**（226 条），不是全量告警 —— 因此这里的「precision」
    是**真值已知的样本内的**精度，不等于线上精度；它回答的是「排序信号的提升倍数」。
  - 打平时按 Python tuple 稳定排序，同分不打乱 ⇒ 结果可复现。

用法：
  python3 blind-benchmark/rank-feasibility.py blind-benchmark/reports/xfn-49-feats-*.jsonl
"""
import json
import sys
from pathlib import Path

GROUPS = ("TP", "FP")


def load(paths):
    rows = []
    for p in paths:
        for line in Path(p).read_text(encoding="utf-8").strip().splitlines():
            if line.strip():
                rows.append(json.loads(line))
    return [r for r in rows if r.get("gold") in GROUPS]


def score_key(r, name):
    """打分键。**元组** = 先比主信号，同分再用次级连续量排序。"""
    if name == "①入口信号（二值）":
        return (1 if r["reachReq"] else 0,)
    if name == "②四个信号求和":
        return (
            sum(
                (
                    1 if r["reachReq"] else 0,
                    1 if r["reachAuth"] else 0,
                    1 if r["reachRoute"] else 0,
                    1 if r["inDeg"] > 0 else 0,
                )
            ),
        )
    # ③：二值信号一旦只能把列表切成两半，前半部分内部**仍是随机序** ——
    # 实测直接导致前 10% 一条真漏洞都没有。加一个连续次级键（上溯可达节点数）试试能不能救。
    return (1 if r["reachReq"] else 0, r["upReached"])


def main():
    paths = sys.argv[1:]
    if not paths:
        print("用法: rank-feasibility.py <feats jsonl...>")
        return 1
    rows = load(paths)
    n_tp = sum(1 for r in rows if r["gold"] == "TP")
    n_fp = len(rows) - n_tp
    base = n_tp / len(rows) if rows else 0
    print(f"\n══ §49.10 路线 A：排序可行性 ══")
    print(f"样本 {len(rows)} 条（TP {n_tp} / FP {n_fp}，已排除 UNKNOWN）")
    print(f"随机排的基线密度 {base:.1%}\n")

    forms = ["①入口信号（二值）", "②四个信号求和", "③入口+上溯可达数"]


def auc(scored):
    """Mann-Whitney U：随机抽一条 TP 和一条 FP，TP 排在前的概率"""
    tp = [s for s, g in scored if g == "TP"]
    fp = [s for s, g in scored if g == "FP"]
    if not tp or not fp:
        return float("nan")
    wins = ties = 0
    for t in tp:
        for f in fp:
            wins += 1 if t > f else 0
            ties += 0.5 if t == f else 0
    return (wins + ties) / (len(tp) * len(fp))


def precision_at_k(scored, k):
    top = scored[:k]
    return sum(1 for _, g in top if g == "TP") / len(top) if top else float("nan")


def main():
    paths = sys.argv[1:]
    if not paths:
        print("用法: rank-feasibility.py <feats jsonl...>")
        return 1
    rows = load(paths)
    n_tp = sum(1 for r in rows if r["gold"] == "TP")
    n_fp = len(rows) - n_tp
    base = n_tp / len(rows) if rows else 0
    print(f"\n══ §49.10 路线 A：排序可行性 ══")
    print(f"样本 {len(rows)} 条（TP {n_tp} / FP {n_fp}，已排除 UNKNOWN）")
    print(f"随机排的基线密度 {base:.1%}\n")

    forms = ["①入口信号（二值）", "②四个信号求和", "③入口+上溯可达数"]

    for name in forms:
        scored = sorted(
            ((score_key(r, name), r["gold"]) for r in rows),
            key=lambda x: x[0],
            reverse=True,
        )
        print(f"── 打分方式：{name} ──")
        print(f"   AUC {auc(scored):.3f}  （0.5 = 随机；1.0 = 完美）")
        for frac in (0.1, 0.2, 0.3, 0.5):
            k = max(1, int(len(scored) * frac))
            p = precision_at_k(scored, k)
            recall = sum(1 for _, g in scored[:k] if g == "TP") / n_tp
            print(
                f"   前 {frac:.0%}（{k:>3} 条）密度 {p:>6.1%}  提升 {p / base:.2f}×  "
                f"覆盖到真漏洞 {recall:.0%}"
            )
        print()

    print("读法：")
    print("  ① 只看「密度提升」倍数 —— 用户扫的是列表前段，能不能少看些假警报；")
    print("  ② 「覆盖到真漏洞」是同一件事的另一面：提升越高，通常漏在后面的越多；")
    print("  ③ 两套打分若没差别，说明四个信号互相冗余（§49.9 已见 req≈auth），不必多算；")
    print("  ④ 这是**排序**，不是压制：总条数一条不少。\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
