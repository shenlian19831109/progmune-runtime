#!/usr/bin/env python3
"""
§49.12 排序信号评估器（v2，2026-09-28）—— **先修尺子，再量信号**

为什么要有 v2：§49.10 的评估器用 Python 稳定排序**保留输入顺序**给同分项排序。
gold 恰好把 TP 全排在列表尾部 ⇒ 「前 10% 真漏洞密度 0%」——那是输入顺序，不是信号质量。
同一批数据随机打散后期望密度是 19.2%（90% 区间 10.7%~28.6%）。
**一个坏评估器差点让整条路线被误判死刑。** v2 的全部改动都围绕「不重蹈覆辙」：

  ① 同分**随机打散**，蒙特卡洛 2000 次 ⇒ 报均值 + 90% 区间，不再报单点数字；
  ② 信号评估看 **Wilson 置信区间**（TP 只有 24 条，点估计极易过拟合）；
  ③ 任何「从数据估出来的参数」（如族先验）必须过 **留一仓交叉验证**：
     用另外 8 个仓估，在留出的那个仓上测 ⇒ 报的是泛化性能，不是拟合性能；
  ④ 打印**连接率**：gold 与扫描结果对不上的条数必须先暴露（R77 的分母意识）。

用法：
  python3 blind-benchmark/rank-signals.py \
      blind-benchmark/reports/xfn-49-signals.jsonl blind-benchmark/fp-gold.jsonl
"""
import json
import math
import random
import sys
from collections import defaultdict, Counter
from pathlib import Path

SEED = 20260928
N_MC = 2000
random.seed(SEED)


# ───────────────────────────── 加载与连接 ─────────────────────────────
def load(path):
    return [json.loads(l) for l in Path(path).read_text(encoding="utf-8").splitlines() if l.strip()]


def join(signals, gold):
    """连接 gold。**先精确后兜底**，并把两类命中的条数分别报出来。"""
    gk = {}
    for g in gold:
        gk[(g.get("repo"), g.get("fn"), g.get("file"), g.get("rule"))] = g.get("gold")
        # 兜底键：fn 只取裸名（IR 对类方法给的是 "Class.method"）
        gk.setdefault((g.get("repo"), str(g.get("fn", "")).split(".")[-1], g.get("file"), g.get("rule")),
                      g.get("gold"))
    rows, exact, bare, miss = [], 0, 0, 0
    for s in signals:
        k1 = (s["repo"], s["fn"], s["file"], s["rule"])
        k2 = (s["repo"], s["bare"], s["file"], s["rule"])
        if k1 in gk:
            s["gold"] = gk[k1]; exact += 1; rows.append(s)
        elif k2 in gk:
            s["gold"] = gk[k2]; bare += 1; rows.append(s)
        else:
            miss += 1
    return rows, {"精确": exact, "裸名兜底": bare, "未连上": miss}


# ───────────────────────────── 统计工具 ─────────────────────────────
def wilson(k, n, z=1.645):
    """Wilson 比例置信区间（90%, z=1.645）。小样本下比 k/n 诚实得多。"""
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - h), min(1.0, c + h))


def auc(pairs):
    """Mann-Whitney U，同分计 0.5。pairs = [(score, gold)]"""
    tp = [s for s, g in pairs if g == "TP"]
    fp = [s for s, g in pairs if g == "FP"]
    if not tp or not fp:
        return float("nan")
    wins = ties = 0
    for t in tp:
        for f in fp:
            wins += 1 if t > f else 0
            ties += 0.5 if t == f else 0
    return (wins + ties) / (len(tp) * len(fp))


def eval_ranking(scored, base, fracs=(0.05, 0.1, 0.2, 0.3)):
    """
    蒙特卡洛评估：同分项随机打散 N_MC 次。
    返回每个 k 的 (均值, 5%分位, 95%分位) 与 recall。
    """
    n = len(scored)
    out = {}
    for frac in fracs:
        k = max(1, int(n * frac))
        prec, rec = [], []
        for _ in range(N_MC):
            perm = scored[:]
            random.shuffle(perm)
            # 关键：先按分数排序（稳定），再对**同分块**内部打散 —— 用 (score, rand) 排序实现
            perm = sorted(scored, key=lambda x: (x[0], random.random()), reverse=True)
            top = perm[:k]
            prec.append(sum(1 for _, g in top if g == "TP") / k)
            rec.append(sum(1 for _, g in top if g == "TP") / max(1, sum(1 for _, g in scored if g == "TP")))
        prec.sort(); rec.sort()
        lo, hi = prec[int(0.05 * len(prec))], prec[int(0.95 * len(prec)) - 1]
        out[frac] = {
            "k": k,
            "mean": sum(prec) / len(prec),
            "lo": lo, "hi": hi,
            "lift": (sum(prec) / len(prec)) / base if base else float("nan"),
            "recall": sum(rec) / len(rec),
        }
    return out


# ───────────────────────────── 信号定义 ─────────────────────────────
# 全部只用 IR 可得字段：calls / params / name / file / 规则聚合。
# ⇒ 产品路径（FunctionInfo）能算出完全一样的值，信号才落得了地。
GUARD_MARKS = ("__progmune_input_guard__", "__progmune_input_schema__")
AUTHZ_CALL = {"can", "cannot", "authorize", "isauthorized", "checkpermission",
              "haspermission", "verifyjwt", "hasrole", "requireauth", "isallowed"}
DATA_STRONG = {"insert", "where", "select", "executetx", "add"}      # §49.12 数据驱动选出
DB_WRITE = {"create", "update", "delete", "save", "remove", "upsert", "patch", "destroy", "write"}
MIDDLEWARE = {"next", "send", "json", "status"}


def calls_lc(r):
    return {c.lower() for c in r.get("calls") or []}


def sig_guard(r):
    return 1 if any(m in (r.get("calls") or []) for m in GUARD_MARKS) else 0


def sig_authz(r):
    return 1 if calls_lc(r) & AUTHZ_CALL else 0


def sig_token(r):
    return 1 if "__progmune_token_issued__" in (r.get("calls") or []) else 0


def sig_data(r):
    return 1 if calls_lc(r) & DATA_STRONG else 0


def sig_dbwrite(r):
    return 1 if calls_lc(r) & DB_WRITE else 0


def sig_multi(r):
    return 1 if r.get("nRules", 1) >= 2 else 0


def sig_inputeffect(r):
    return 1 if "__progmune_input_effect__" in (r.get("calls") or []) else 0


def sig_ncalls(r):
    return len(r.get("calls") or [])


def sig_dto(r):
    return 1 if any("Dto" in (p.get("t") or "") for p in r.get("params") or []) else 0


SIGNALS = {
    "guard 有校验证据": sig_guard,
    "authz 有鉴权调用": sig_authz,
    "token 已签发": sig_token,
    "data 强数据操作": sig_data,
    "dbwrite 写库": sig_dbwrite,
    "multiRule 同函数多规则": sig_multi,
    "inputEffect 输入被使用": sig_inputeffect,
    "dto 参数是 DTO": sig_dto,
}


# ───────────────────────────── 打分方案 ─────────────────────────────
def make_rule_prior(train, base, alpha=8.0):
    """族先验：rule → TP 率，用贝叶斯平滑（alpha 条伪计数按基线注入）。
    alpha 越大越保守（越接近全局基线）。只吃 train，绝不看测试仓。"""
    cnt = defaultdict(lambda: [0, 0])
    for r in train:
        cnt[r["rule"]][0 if r["gold"] == "TP" else 1] += 1
    return {k: (tp + alpha * base) / (tp + fp + alpha) for k, (tp, fp) in cnt.items()}


def score_prior(r, prior, base):
    return prior.get(r["rule"], base)


def score_prior_minus_guard(r, prior, base):
    return score_prior(r, prior, base) - 0.20 * sig_guard(r) - 0.10 * sig_authz(r)


def score_prior_full(r, prior, base):
    return (score_prior(r, prior, base)
            - 0.20 * sig_guard(r)
            - 0.10 * sig_authz(r)
            - 0.08 * sig_token(r)
            + 0.10 * sig_data(r)
            + 0.05 * sig_multi(r))


def score_guard_only(r, prior, base):
    """只用一个信号：有防护证据 ⇒ 降权（最简、最可解释）"""
    return -(sig_guard(r) + sig_authz(r))


def score_data_only(r, prior, base):
    return sig_data(r) + sig_dbwrite(r)


SCORERS = {
    "① 族先验（留一仓估）": score_prior,
    "② 族先验 − 防护证据": score_prior_minus_guard,
    "③ 族先验 + 全部信号": score_prior_full,
    "④ 只用防护证据（不用先验）": score_guard_only,
    "⑤ 只用数据操作（不用先验）": score_data_only,
}


# ───────────────────────────── 主流程 ─────────────────────────────
def main():
    if len(sys.argv) < 3:
        print("用法: rank-signals.py <signals.jsonl> <fp-gold.jsonl>")
        return 1
    rows, stat = join(load(sys.argv[1]), load(sys.argv[2]))
    rows = [r for r in rows if r.get("gold") in ("TP", "FP")]
    n_tp = sum(1 for r in rows if r["gold"] == "TP")
    n_fp = len(rows) - n_tp
    base = n_tp / len(rows)
    print(f"\n══ §49.12 排序信号评估（评估器 v2：同分随机打散 ×{N_MC}）══")
    print(f"连接：精确 {stat['精确']} / 裸名兜底 {stat['裸名兜底']} / 未连上 {stat['未连上']}")
    print(f"样本 {len(rows)} 条（TP {n_tp} / FP {n_fp}）  基线密度 {base:.1%}")
    print(f"仓库 {len(set(r['repo'] for r in rows))} 个；"
          f"TP 所在仓 {sorted(set(r['repo'] for r in rows if r['gold']=='TP'))}")

    # ── 单信号诊断 ──
    print("\n── 单信号诊断（覆盖率 + Wilson 90% 区间 + 跨仓一致性）──")
    print(f"{'信号':26}{'TP中命中':>10}{'FP中命中':>10}{'TP率':>8}{'90%区间':>16}{'仓数(有TP)':>11}")
    for name, fn in SIGNALS.items():
        tp_hit = [r for r in rows if r["gold"] == "TP" and fn(r)]
        fp_hit = [r for r in rows if r["gold"] == "FP" and fn(r)]
        n = len(tp_hit) + len(fp_hit)
        if n == 0:
            continue
        lo, hi = wilson(len(tp_hit), n)
        repos_tp = len(set(r["repo"] for r in tp_hit))
        flag = "  ↑提" if len(tp_hit) / max(1, len([r for r in rows if r['gold']=='TP'])) > \
                          len(fp_hit) / max(1, len([r for r in rows if r['gold']=='FP'])) else "  ↓降"
        print(f"  {name:24}{len(tp_hit):>6}/{n_tp:<4}{len(fp_hit):>6}/{n_fp:<4}"
              f"{len(tp_hit)/n:>7.0%}  [{lo:.0%},{hi:.0%}]{'':>2}{repos_tp:>6}{flag}")

    # ── 留一仓交叉验证 ──
    print("\n── 打分方案：留一仓交叉验证（先验只用其余仓估，绝不看测试仓）──")
    repos = sorted(set(r["repo"] for r in rows))
    results = {}
    for sname, scorer in SCORERS.items():
        all_scored = []
        for held in repos:
            train = [r for r in rows if r["repo"] != held]
            test = [r for r in rows if r["repo"] == held]
            if not train or not test:
                continue
            b_train = sum(1 for r in train if r["gold"] == "TP") / len(train)
            prior = make_rule_prior(train, b_train)
            for r in test:
                all_scored.append((scorer(r, prior, b_train), r["gold"]))
        results[sname] = all_scored

    print(f"{'方案':30}{'AUC':>7}" + "".join(f"{f'前{f:.0%}':>18}" for f in (0.05, 0.1, 0.2, 0.3)))
    print(f"{'':30}{'':>7}" + "".join(f"{'密度[90%区间]':>18}" for _ in (0.05, 0.1, 0.2, 0.3)))
    for sname, scored in results.items():
        a = auc(scored)
        ev = eval_ranking(scored, base)
        cells = "".join(
            f"{ev[f]['mean']:>6.1%}[{ev[f]['lo']:.0%},{ev[f]['hi']:.0%}]" for f in (0.05, 0.1, 0.2, 0.3)
        )
        print(f"  {sname:28}{a:>7.3f}{cells}")

    print(f"\n  随机排的基线密度 {base:.1%}；lift 已含在上表（均值 ÷ 基线）")
    print("\n── 读法 ──")
    print("  ① 区间跨越基线的方案 = 与随机排**不可区分**，不可用；")
    print("  ② 留一仓 = 先验只从别的仓学 ⇒ 这里报的是泛化性能，不是拟合性能；")
    print("  ③ 单信号「仓数(有TP)」= 该信号命中真漏洞的仓数。=1 意味着它可能只是某一个仓库的巧合。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
