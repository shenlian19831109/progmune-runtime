#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""jev（TypeSafe System One）在本项目 FP 池上的可用性实验。

【这个实验要回答的唯一问题】
    「语义判定模型能不能替我们做 FP/TP 初筛？」
    —— 不是「jev 快不快 / 便宜不便宜」（那是官方宣传，与我们无关），
       而是「它的判定准不准、概率可不可信」。

【硬边界】本脚本**只在离线校准环节使用，绝不可进扫描路径**。
    引擎必须本地确定性、可离线、可复现（见设计稿 §二十三）。

【为什么必须这么设计】
  1. **真值分层**：fp-gold.jsonl 里只有 40+ 条是人工核验过的（verified），
     其余是启发式打标。用启发式当 gold 算一致率 = 拿猜测当标准答案。
     默认只用 verified，--include-heuristic 才放开（且分开报告）。
  2. **类别不平衡**：verified 集 FP 远多于 TP。一个「永远判 FP」的傻瓜
     能拿很高的一致率 ⇒ 必须同时报告 per-class 召回与**多数类基线**。
     低于多数类基线的模型 = 没用，无论总准确率多好看。
  3. **校准必须验**：jev 的卖点是 RLCD「说 0.9 就有九成对」。这个声明
     要在本数据集上自己测（ECE），不能直接信官方数字。
  4. **信息公平**：detector 本身只看「函数名 + 路径 + calls 词表」，
     所以给 jev 的 state 默认也是这些 —— 公平对照。--with-source 可加源码，
     用于测量「补源码能提升多少」。
  5. **口径可比**：结果必须记录 model 版本；换模型即换口径，跨版本不可比（R38）。

用法：
    # 无 key 也能跑：打印 payload 样例 + 基线（零成本）
    python3 blind-benchmark/jev-experiment.py --dry-run
    python3 blind-benchmark/jev-experiment.py --baseline-only

    # 真跑（需要 key）
    TYPESAFE_API_KEY=sk-... python3 blind-benchmark/jev-experiment.py
    TYPESAFE_API_KEY=sk-... python3 blind-benchmark/jev-experiment.py --with-source
"""

import argparse
import json
import math
import os
import sys
import time
import urllib.error
import urllib.request

GOLD = "blind-benchmark/fp-gold.jsonl"
REPORT = "blind-benchmark/reports/jev-experiment.json"
ENDPOINT = "https://api.typesafe.ai/v1/systemone"
DEFAULT_MODEL = os.environ.get("JEV_MODEL", "jev-1.13")
TIMEOUT = 20  # 必须设超时。教训：src/llm.ts 无 timeout，缺 key 时会挂死整个流程。

# 误报原因选项。**必须互斥**，且必须留兜底项（官方文档明说：语义重叠会污染概率分布）
FP_REASONS = {
    "config_builder": "纯配置/选项装配（如 ConfigBuilder.addXxx、Options.setXxx），不处理外部输入，"
                      "告警只因函数名里带 add/create 触发",
    "frontend_client": "前端/客户端的 API 封装（路径含 frontend/、api/、client/），只发 HTTP 请求，"
                       "不是后端业务主体",
    "framework_word_ambiguity": "框架 API 的词义歧义（如 registerDecorator 被切成 register+Decorator，"
                                "命中『注册』类规则），与业务无关",
    "framework_mechanism_body": "框架机制自己的实现体（Guard/Strategy/Interceptor/Middleware/Pipe），"
                                "实现的是机制本身，不是机制的调用方",
    "test_or_factory": "测试夹具或工厂/构造器，不处理真实外部输入",
    "internal_private_helper": "内部私有工具方法，不是对外入口",
    "not_false_positive": "不是误报 —— 这条告警报得对（确实缺相应的安全措施）",
    "uncertain": "信息不足，无法判断（宁可选此项也不要猜）",
}


# ---------------------------------------------------------------- state
def build_state(row: dict, with_source: bool) -> str:
    """构造喂给 jev 的 state。

    默认只给 detector 自己也能看到的信息（函数名/路径/规则/调用列表）——
    公平对照。加源码是另一个实验档位，用 --with-source。
    """
    calls = ", ".join(row["calls"]) if row["calls"] else "（该函数体内未识别到任何调用）"
    s = (
        f"代码仓库：{row['repo']}\n"
        f"文件路径：{row['file']}\n"
        f"函数/方法名：{row['fn']}\n"
        f"静态扫描器报出的告警规则：{row['rule']}\n"
        f"该函数体内出现的调用：{calls}\n"
    )
    if with_source and row.get("source"):
        s += f"\n函数源码：\n{row['source']}\n"
    return s


def build_questions() -> dict:
    """一次请求并行问三个问题（官方设计：加问题几乎不增加延迟）。"""
    return {
        "is_true_positive": {
            "type": "noul",
            "instructions": (
                "这条静态扫描告警是真阳性吗？即：被报的这个位置确实缺少该规则所指的安全措施。"
                "注意：只依据给定的调用列表判断，不要假设存在你没看到的代码。"
                "如果该函数明显不处理外部输入（纯配置装配、前端请求封装、框架机制实现），回答『否』的概率应当高。"
            ),
        },
        "fp_reason": {
            "type": "choice",
            "instructions": "如果这条告警是误报，最主要的原因是什么？如果认为不是误报，选 not_false_positive。",
            "criteria": FP_REASONS,
        },
        "info_sufficient": {
            "type": "noul",
            "instructions": (
                "仅凭上面给出的信息（没有完整源码），是否足以对『真阳性与否』做出可靠判断？"
                "信息不足时回答『否』的概率应当高 —— 这用于识别哪些条目必须转人工看源码。"
            ),
        },
    }


def load_source(row: dict) -> str:
    """从 fp-pool 切片里取函数源码片段（尽力而为，取不到就空）。"""
    path = os.path.join("blind-benchmark/fp-pool", row["repo"], row["file"])
    if not os.path.isfile(path):
        return ""
    base = row["fn"].split(".")[-1]
    try:
        lines = open(path, encoding="utf-8", errors="replace").read().splitlines()
    except OSError:
        return ""
    for i, ln in enumerate(lines):
        if base in ln and ("(" in ln):
            return "\n".join(lines[i:i + 25])
    return ""


# ---------------------------------------------------------------- call
def call_jev(state: str, model: str, key: str) -> dict:
    payload = json.dumps(
        {"model": model, "state": state, "questions": build_questions()},
        ensure_ascii=False,
    ).encode("utf-8")
    req = urllib.request.Request(
        ENDPOINT, data=payload, method="POST",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return json.loads(resp.read().decode("utf-8"))


def parse_answers(resp: dict) -> dict:
    """苛刻解析：缺字段/类型不对一律抛，不静默容错（学 fast-jev-compaction 的 request.ts）。"""
    a = resp.get("answers")
    if not isinstance(a, dict):
        raise ValueError(f"返回体缺 answers: {str(resp)[:200]}")
    out = {}
    for name in ("is_true_positive", "info_sufficient"):
        v = a.get(name, {}).get("noul")
        if not isinstance(v, (int, float)) or not math.isfinite(v):
            raise ValueError(f"{name} 的 noul 不是有限数字: {a.get(name)}")
        out[name] = float(v)
    ch = a.get("fp_reason", {}).get("choice")
    out["fp_reason"] = ch if isinstance(ch, str) else "uncertain"
    return out


# ---------------------------------------------------------------- score
def report(results: list, label: str) -> dict:
    """评分。核心：per-class 召回 + 多数类基线 + ECE 校准。"""
    scored = [r for r in results if r["gold"] in ("FP", "TP")]
    if not scored:
        print(f"[{label}] 无可评分条目")
        return {}

    n = len(scored)
    n_fp = sum(1 for r in scored if r["gold"] == "FP")
    n_tp = sum(1 for r in scored if r["gold"] == "TP")
    majority = max(n_fp, n_tp) / n  # ← 傻瓜基线

    tp_recall = sum(1 for r in scored if r["gold"] == "TP" and r["pred"] == "TP") / n_tp if n_tp else None
    fp_recall = sum(1 for r in scored if r["gold"] == "FP" and r["pred"] == "FP") / n_fp if n_fp else None
    acc = sum(1 for r in scored if r["pred"] == r["gold"]) / n

    # ECE（期望校准误差）：把置信度分 10 桶，比 |平均置信 − 实际正确率|
    conf = [(max(r["p"], 1 - r["p"]), 1 if r["pred"] == r["gold"] else 0) for r in scored]
    buckets = {}
    for c, ok in conf:
        b = min(9, int(c * 10))
        buckets.setdefault(b, []).append((c, ok))
    ece, rows = 0.0, []
    for b in sorted(buckets):
        vs = buckets[b]
        ac = sum(c for c, _ in vs) / len(vs)
        ao = sum(o for _, o in vs) / len(vs)
        ece += len(vs) / n * abs(ac - ao)
        rows.append({"bucket": b, "n": len(vs), "avg_conf": round(ac, 3), "acc": round(ao, 3)})

    print(f"\n===== {label} =====")
    print(f"  样本 {n} 条（FP {n_fp} / TP {n_tp}）")
    print(f"  总一致率        {acc:.1%}")
    print(f"  多数类基线      {majority:.1%}   ← 低于它就没用，无论总准确率多好看")
    print(f"  FP 召回         {fp_recall:.1%}" if fp_recall is not None else "  FP 召回  n/a")
    print(f"  TP 召回         {tp_recall:.1%}" if tp_recall is not None else "  TP 召回  n/a")
    print(f"  ECE（校准误差） {ece:.3f}   ← 越小越可信；>0.15 说明概率不能直接当阈值用")
    low = sum(1 for r in scored if r.get("info", 1.0) < 0.5)
    if low:
        print(f"  自报信息不足    {low} 条（{low/n:.0%}）← 这些本就该转人工，不该自动接受")

    return dict(label=label, n=n, n_fp=n_fp, n_tp=n_tp, acc=round(acc, 4),
                majority_baseline=round(majority, 4),
                fp_recall=None if fp_recall is None else round(fp_recall, 4),
                tp_recall=None if tp_recall is None else round(tp_recall, 4),
                ece=round(ece, 4), info_insufficient=low,
                calibration_buckets=rows)


# ---------------------------------------------------------------- main
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--with-source", action="store_true", help="state 里加源码片段（第二档实验）")
    ap.add_argument("--include-heuristic", action="store_true",
                    help="把启发式打标的条目也纳入（分开报告，不能与 verified 混算）")
    ap.add_argument("--dry-run", action="store_true", help="不联网，只打印 payload 与基线")
    ap.add_argument("--baseline-only", action="store_true", help="只算基线，不发请求")
    args = ap.parse_args()

    rows = [json.loads(l) for l in open(GOLD, encoding="utf-8")]
    if args.with_source:
        for r in rows:
            r["source"] = load_source(r)

    verified = [r for r in rows if r["gold_confidence"] == "verified"]
    heur = [r for r in rows if r["gold_confidence"] == "heuristic" and r["gold"] in ("FP", "TP")]

    print(f"真值集：共 {len(rows)} 条 | verified {len(verified)} | heuristic {len(heur)}")

    # -------- 基线（零成本，永远先算）--------
    for name, subset in (("verified", verified), ("heuristic", heur)):
        if not subset:
            continue
        n = len(subset)
        n_fp = sum(1 for r in subset if r["gold"] == "FP")
        n_tp = n - n_fp
        print(f"\n[基线·{name}] 样本 {n}（FP {n_fp} / TP {n_tp}）"
              f" ⇒ 多数类基线 {max(n_fp, n_tp)/n:.1%}、类别比 {n_fp}:{n_tp}")
        if n_fp and n_tp and min(n_fp, n_tp) / n < 0.2:
            print("   ⚠ 严重不平衡：少数类占比 <20%。总一致率会被多数类主导，"
                  "**必须看 per-class 召回**，否则实验会假成功。")

    if args.baseline_only:
        return 0

    # -------- dry-run：打印一条 payload 供人工检查 --------
    if args.dry_run:
        sample = verified[0] if verified else rows[0]
        payload = {"model": args.model, "state": build_state(sample, args.with_source),
                   "questions": build_questions()}
        print(f"\n[dry-run] 不发请求。payload 样例（条目 {sample['id']}，gold={sample['gold']}）：")
        print(json.dumps(payload, ensure_ascii=False, indent=2)[:2600])
        print("\n[dry-run] 用 --baseline-only 可只算基线；去掉 --dry-run 且设置 "
              "TYPESAFE_API_KEY 后才会真发请求。")
        return 0

    key = os.environ.get("TYPESAFE_API_KEY")
    if not key:
        print("\n✗ 未设置 TYPESAFE_API_KEY，无法发请求。（先跑 --dry-run / --baseline-only）")
        return 2

    targets = verified + (heur if args.include_heuristic else [])
    if args.limit:
        targets = targets[:args.limit]

    results, errs, t0 = [], [], time.time()
    for i, r in enumerate(targets, 1):
        try:
            ans = parse_answers(call_jev(build_state(r, args.with_source), args.model, key))
        except (urllib.error.URLError, ValueError, TimeoutError, OSError) as e:
            errs.append({"id": r["id"], "err": str(e)[:160]})
            continue
        p = ans["is_true_positive"]
        results.append(dict(
            id=r["id"], gold=r["gold"], gold_confidence=r["gold_confidence"],
            p=p, pred="TP" if p >= 0.5 else "FP",
            info=ans["info_sufficient"], fp_reason=ans["fp_reason"],
        ))
        if i % 20 == 0:
            print(f"  ...{i}/{len(targets)}", flush=True)

    print(f"\n耗时 {time.time()-t0:.1f}s，成功 {len(results)}，失败 {len(errs)}")
    if errs:
        print("失败样例：", errs[:3])

    out = {"model": args.model, "schema": "v1", "with_source": args.with_source,
           "timestamp": time.strftime("%Y-%m-%d %H:%M"), "errors": errs[:10]}
    scores = []
    scores.append(report([r for r in results if r["gold_confidence"] == "verified"], "verified 集"))
    if args.include_heuristic:
        scores.append(report([r for r in results if r["gold_confidence"] == "heuristic"],
                             "heuristic 集（**参考**，gold 本身未核验）"))
    out["scores"] = [s for s in scores if s]
    out["raw"] = results
    os.makedirs(os.path.dirname(REPORT), exist_ok=True)
    with open(REPORT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, indent=2)
    print(f"\n报告已写出 → {REPORT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
