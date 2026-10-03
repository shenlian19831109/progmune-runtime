#!/usr/bin/env python3
"""
§51 held-out 主路径对照（2026-10-03）

用法: python3 heldout-compare.py <trust-output.json> [<another.json> ...]

这个脚本**不评价检测器好坏**，只回答 §50 那个未回答的问题：
  「四刀修复是在 docmost 上找根因、又在 docmost 上量疗效（in-sample）；
   放到一个从未看过的项目上，产品判定路径还是不是同样的行为？」

纪律：只读 `dist/trust/cli.js --json` 的产物，不改任何 src。

输出：decision / score / 违规总数 / 按 policy_ref / 按规则族 / 同(file,fn,rule) 跨维度重复计数 /
      多项目同刻对照表。CHANGELOG 里的 132→6 只是参考锚点，**不是同刻基线**（R73）。
"""
import json, sys, collections

REF = {
    # CHANGELOG 3.7.55 记录的数字 —— 仅作参考锚点，**不是同刻基线**
    "参考锚点（非同刻）": None,
}


def load(p):
    d = json.load(open(p))
    return d


def summarize(name, d):
    o = d.get("overall", {})
    print("=" * 78)
    print(f"【{name}】  project={d.get('project')}  engine={d.get('engineVersion')}")
    print(f"  decision = {o.get('decision')}   score = {o.get('score')}   confidence = {o.get('confidence')}")
    if o.get("extractionWarning"):
        print(f"  ⚠ extractionWarning: {o['extractionWarning'][:200]}  ⇒ 本次扫描是废票")
    cc = o.get("coverageConfidence")
    if cc:
        print(f"  coverageConfidence: {cc.get('score')} / level {cc.get('level')}")
    mc = o.get("mappingCoverage")
    if mc:
        print(f"  mappingCoverage: rate {mc.get('rate')}% level {mc.get('level')} ({mc.get('totalApis')} APIs)")
    sc = o.get("ssgCoverage")
    if sc:
        print(f"  ssgCoverage: {sc.get('matchedCalls')}/{sc.get('totalCalls')} calls matched, {sc.get('ssgViolations')} violations")
    sa = o.get("safeguardAlerts")
    if sa:
        print(f"  safeguardAlerts(不进判定): total {sa.get('total')}, 族 {len(sa.get('groups', []))}")

    # 违规明细：项目生/history 维度 + 规则维度
    vios = []
    for k in ("violations",):
        if isinstance(d.get(k), list):
            vios = d[k]
    # 有些版本把 violations 放在 subscores/dimensions 下
    dims = d.get("dimensions") or d.get("subscores") or {}
    print(f"  违规总数(top-level violations): {len(vios)}")
    if dims:
        print(f"  维度: { {k: (v if not isinstance(v, dict) else v.get('count', v)) for k, v in dims.items() if isinstance(v,(int,float,dict))} }")

    by_rule = collections.Counter()
    by_dim = collections.Counter()
    for v in vios:
        r = v.get("rule") or v.get("type") or v.get("id") or "?"
        by_rule[r] += 1
        pr = v.get("policy_ref") or "(none)"
        by_dim[pr.split("/")[0] if pr else "(none)"] += 1
        dim2 = (v.get("policy_ref") or "").split("/")[:1]
    print("  ── 按规则 top12 ──")
    for r, n in by_rule.most_common(12):
        print(f"     {n:5}  {r}")
    print("  ── 按 policy_ref 前缀 ──")
    for r, n in by_dim.most_common(10):
        print(f"     {n:5}  {r}")

    # 同一违规是否跨维度重复计数（§50 修复点 #4）
    ids = collections.Counter()
    for v in vios:
        key = (v.get("file"), v.get("function") or v.get("fn"), v.get("rule") or v.get("type"))
        ids[key] += 1
    dup = {k: n for k, n in ids.items() if n > 1}
    print(f"  同一(file,fn,rule) 被计多次的对象: {len(dup)} 个，额外重复 {sum(dup.values())-len(dup)} 次")
    return {
        "name": name, "decision": o.get("decision"), "score": o.get("score"),
        "n": len(vios), "rules": by_rule, "dup_objs": len(dup),
        "dup_extra": sum(dup.values()) - len(dup),
        "alerts": (sa or {}).get("total", 0),
        "warn": bool(o.get("extractionWarning")),
    }


def main():
    rows = []
    for p in sys.argv[1:]:
        name = p.split("/")[-1].replace("trust-", "").replace(".json", "")
        rows.append(summarize(name, load(p)))
    if len(rows) > 1:
        print("=" * 78)
        print("【对照表】")
        print(f"  {'项目':<14}{'decision':<12}{'score':>6}{'违规':>7}{'重复额外':>9}{'告警流':>8}{'废票':>6}")
        for r in rows:
            print(f"  {r['name']:<14}{str(r['decision']):<12}{r['score']:>6}{r['n']:>7}{r['dup_extra']:>9}{r['alerts']:>8}{('是' if r['warn'] else '否'):>6}")
        print()
        print("  注：同表格内的多行是**同刻同 binaries**跑出来的；CHANGELOG 里的历史数字不得用于同刻对比（R73）。")


if __name__ == "__main__":
    main()
