#!/usr/bin/env python3
"""§49.17 召回对照（第二层）：把自动候选 + **人工审核**的判定固化成数据。

为什么必须人工：候选是 token 匹配出来的，会撞同名巧合（例如 GHSA-cf68
「attachment URL XSS」撞到一个叫 NoUrls 的校验器）。机器只能给候选，
「这是不是同一个漏洞所在的位置」必须由人来判定，且判定要留痕。

输出：reports/advisories/recall-verdict.jsonl  +  终端汇总表
"""
import json
import os
import sys

BASE = "/Users/shenlian/progmune-runtime/blind-benchmark"
ADV = os.path.join(BASE, "reports", "advisories", "ghsa.jsonl")
OUT = os.path.join(BASE, "reports", "advisories", "recall-verdict.jsonl")

# ── 人工判定（docmost 全 18 条，2026-09-28 人工核 code://... ）──
#   verdict: HIT=位置命中 / PARTIAL=函数命中但规则族不对 / MISS=能力内但没报位置
#            OUT_OF_SCOPE=规则集里根本没有这类规则
#   evidence: 支撑这个判定的告警（fn @ file，取自 fullscan-<repo>.jsonl）
VERDICT = {
    "GHSA-vp6f-78w7-v422": ("MISS", "MFA 相关路由与 service 无告警（命中的是同名 migration 脚本）"),
    "GHSA-r4cx-rg3p-25g7": ("HIT", "getFileTaskFolderPath @ integrations/import/utils/file.utils.ts"),
    "GHSA-vqrf-cjv6-rf89": ("HIT", "SearchController.searchShare @ core/search/search.controller.ts"),
    "GHSA-frjw-66gr-799m": ("OUT_OF_SCOPE", "zip-bomb / 资源耗尽类无对应规则"),
    "GHSA-84fx-mvqx-p5gx": ("HIT", "WorkspaceInvitationService.createInvitation @ workspace/services（族偏：报的是 Unauthenticated Mutation 而非 Privilege Escalation）"),
    "GHSA-5vhf-cgf2-c9cq": ("HIT", "TransclusionService.lookup @ core/page/transclusion/transclusion.service.ts"),
    "GHSA-rxm9-xp9h-4c84": ("HIT", "ExportService.exportSpace / PageRepo.getSpacePagesExcludingChildren @ integrations/export"),
    "GHSA-9f58-29hm-mgp2": ("PARTIAL", "AttachmentRepo.deleteAttachment* @ database/repos/attachment —— 同文件但不是 fileName 处理那条路径"),
    "GHSA-95f8-h5hf-8248": ("HIT", "FileTaskProcessor.processExportCleanup @ integrations/import/processors"),
    "GHSA-4gv6-jw3v-wc34": ("MISS", "评论模块（comment）在告警池里零命中"),
    "GHSA-cf68-cff9-hq4w": ("MISS", "候选 NoUrls @ common/validators 只是同名巧合，不是附件 URL 渲染路径"),
    "GHSA-89fp-2hch-j9gp": ("MISS", "attachmentService 的 overwrite 校验路径无告警"),
    "GHSA-qq4c-8rjr-w42c": ("HIT", "SearchController.searchShare @ core/search/search.controller.ts"),
    "GHSA-7cq4-577p-wp6p": ("PARTIAL", "getMimeType @ common/helpers/file.helper.ts —— 同一函数，但报的是 Authorization 族，不是 XSS"),
    "GHSA-h7fp-4f37-29wq": ("MISS", "ShareSeoController 只有 SSR meta 告警，漏洞面在前端渲染"),
    "GHSA-r4hj-mc62-jmwj": ("MISS", "Mermaid 渲染路径零命中"),
    "GHSA-54pm-hqxm-54wg": ("HIT", "FileTaskProcessor.processExportTask / getPdfExportService @ integrations/import/processors"),
    "GHSA-qvxv-4pj5-64xq": ("MISS", "编辑器 embed 渲染路径零命中"),
}

# 每条 advisory 的漏洞大类（人工按 summary 归类，用于看「哪类我们能碰到」）
CLASS = {
    "VP6F": None,
}
GHC = {
    "GHSA-vp6f-78w7-v422": "认证绕过",
    "GHSA-r4cx-rg3p-25g7": "路径遍历",
    "GHSA-vqrf-cjv6-rf89": "越权读取",
    "GHSA-frjw-66gr-799m": "资源耗尽",
    "GHSA-84fx-mvqx-p5gx": "越权操作",
    "GHSA-5vhf-cgf2-c9cq": "越权读取",
    "GHSA-rxm9-xp9h-4c84": "越权读取",
    "GHSA-9f58-29hm-mgp2": "路径遍历",
    "GHSA-95f8-h5hf-8248": "路径遍历",
    "GHSA-4gv6-jw3v-wc34": "XSS",
    "GHSA-cf68-cff9-hq4w": "XSS",
    "GHSA-89fp-2hch-j9gp": "越权写入",
    "GHSA-qq4c-8rjr-w42c": "越权读取",
    "GHSA-7cq4-577p-wp6p": "XSS",
    "GHSA-h7fp-4f37-29wq": "XSS",
    "GHSA-r4hj-mc62-jmwj": "XSS",
    "GHSA-54pm-hqxm-54wg": "路径遍历",
    "GHSA-qvxv-4pj5-64xq": "XSS",
}


def main():
    repos = sys.argv[1:] or ["docmost"]
    advs = [json.loads(l) for l in open(ADV)]
    rows = []
    for a in advs:
        if a["repo"] not in repos:
            continue
        v, ev = VERDICT.get(a["ghsa"], ("UNAUDITED", ""))
        rows.append(
            {
                "repo": a["repo"],
                "ghsa": a["ghsa"],
                "severity": a["severity"],
                "cls": GHC.get(a["ghsa"], "-"),
                "cwes": a["cwes"],
                "summary": a["summary"],
                "verdict": v,
                "evidence": ev,
            }
        )
    with open(OUT, "w") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    from collections import Counter

    c = Counter(r["verdict"] for r in rows)
    n_in = sum(v for k, v in c.items() if k != "OUT_OF_SCOPE")
    print("=" * 104)
    print(f"召回对照 · {repos} · 共 {len(rows)} 条官方公告")
    print("=" * 104)
    print(f"{'严重':5} {'GHSA':24} {'类别':10} {'判定':12} 摘要")
    for r in rows:
        print(f"{r['severity'][:4].upper():5} {r['ghsa']:24} {r['cls']:10} {r['verdict']:12} {r['summary'][:48]}")
    print()
    for k in ("HIT", "PARTIAL", "MISS", "OUT_OF_SCOPE", "UNAUDITED"):
        if c[k]:
            print(f"  {k:14} {c[k]:3}")
    print(f"\n  能力内（非 OUT_OF_SCOPE）: {n_in} 条")
    print(f"  其中位置-{(' 命中')}: {c['HIT']}  → 位置覆盖率 {c['HIT']/n_in*100:.0f}%"
          f"（含 PARTIAL 则 {(c['HIT']+c['PARTIAL'])/n_in*100:.0f}%）")
    print(f"  其中位置-{(' 未命中')}: {c['MISS']}  → {c['MISS']/n_in*100:.0f}%")
    print()
    print("── 按漏洞大类（我们到底能碰到哪一类真问题）──")
    by = {}
    for r in rows:
        if r["verdict"] == "OUT_OF_SCOPE":
            continue
        by.setdefault(r["cls"], Counter())[r["verdict"]] += 1
    for cls, cc in sorted(by.items(), key=lambda kv: -sum(kv[1].values())):
        tot = sum(cc.values())
        print(f"  {cls:10} {tot:2} 条   命中{cc['HIT']:2} / 擦边{cc['PARTIAL']:1} / 未命中{cc['MISS']:2}")
    print(f"\n已写入 {os.path.relpath(OUT, BASE)}")


if __name__ == "__main__":
    main()
