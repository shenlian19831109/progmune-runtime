#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
§52 pre/post 归因对照 —— frame-level NestJS 探测器的每一条违规去了哪
"""
import json
import sys
from collections import Counter, defaultdict


def load(p):
    with open(p) as f:
        return json.load(f)["projects"]


def key(i):
    return (i["type"], i["route"], i["controller"])


def main():
    pre = load(sys.argv[1])
    post = load(sys.argv[2])
    print(f"{'project':10} {'routes':>7} {'pre':>5} {'post':>5} {'LOST':>5} {'NEW':>4}  {'by-rule(pre→post)':>28}  guard/pipe 证据")
    print("-" * 118)
    for name in pre:
        a, b = pre[name], post.get(name)
        if b is None:
            print(f"{name:10} (post 缺失)")
            continue
        ka = Counter(key(i) for i in a["issues"])
        kb = Counter(key(i) for i in b["issues"])
        lost = {k: ka[k] for k in ka if k not in kb}
        new = {k: kb[k] for k in kb if k not in ka}
        byrule_pre = Counter(i["type"] for i in a["issues"])
        byrule_post = Counter(i["type"] for i in b["issues"])
        rules = "; ".join(
            f"{r}:{byrule_pre.get(r,0)}→{byrule_post.get(r,0)}"
            for r in sorted(set(byrule_pre) | set(byrule_post))
        )
        g_post = b.get("globalValidationPipes") or []
        guards = b.get("globalAuthGuards") or []
        print(f"{name:10} {b['routes']:>7} {len(a['issues']):>5} {len(b['issues']):>5} "
              f"{len(lost):>5} {len(new):>4}  {rules:>28}  pipes={','.join(sorted(set(g_post))) or '-'}; guards={','.join(guards) or '-'}")

        # LOST 归因：查 post 里那条路由的真相
        detail = {f"{r['route']}": r for r in b["routes_detail"]}
        attr = Counter()
        for (typ, route, ctrl) in lost:
            r = detail.get(route)
            if r is None:
                attr["路由消失(?)"] += 1
                continue
            if typ == "NESTJS_NO_VALIDATION":
                if r["hasValidationPipe"]:
                    attr["NO_VALIDATION←@UsePipes"] += 1
                elif r["hasValidatedDto"]:
                    attr["NO_VALIDATION←全局管道+已校验DTO"] += 1
                elif not r["hasStructuredInput"]:
                    attr["NO_VALIDATION←无结构化入参"] += 1
                else:
                    attr["NO_VALIDATION←无法归因(!)"] += 1
            elif typ == "NESTJS_NO_AUTH":
                attr["NO_AUTH←全局APP_GUARD"] += 1
            else:
                attr[f"{typ}←?"] += 1
        for k, v in attr.most_common():
            flag = "  ⚠" if "无法归因" in k or "?" in k else ""
            print(f"             · LOST 归因 {k}: {v}{flag}")
        # 仍报的：检查一下是否还有「有全局管道+DTO 却仍报」（说明内部不一致）
        resid = [k2 for k2 in kb if k2[0] == "NESTJS_NO_VALIDATION"
                 and (detail.get(k2[1]) or {}).get("hasValidatedDto")
                 and (b.get("globalValidationPipes"))]
        if resid:
            print(f"             · ⚠ 残留中有 {len(resid)} 条「有全局管道+DTO」仍报（口径不一致）")
        for (typ, route, ctrl) in list(new)[:5]:
            print(f"             · NEW {typ} {route} ({ctrl})")
        print()


if __name__ == "__main__":
    main()
