#!/usr/bin/env python3
"""E5 反向验证（R18）：退回旧行为，看转红清单是否只落在自己那组。

为什么脚本化：手改源码跑完容易忘记还原，残留会污染后续验收
（MEMORY 里有 /tmp 脚本被清理误伤的前科，故本脚本是**入库的正式资产**）。

三刀：
  CUT-A 提取侧恒 false  ⇒ 副作用证据永不产出 ⇒ 该报的那些转红
  CUT-B 规则侧移除 requireMarker ⇒ 无副作用的函数也报 ⇒ 反面护栏转红
  CUT-C 提取侧恒 true（无条件注入）⇒ 全部带标记 ⇒ 标记维度 + 违规维度转红

期望从哪来（R44，2026-09-23 起）
──────────────────────────────────────────────────────────────────────────────
**不再手列**。转红集合由 `derive-cut-expectations.ts` 从期望表机械推导：
它把每个 case 的 5 个维度（have/none/traversal/reportRules/suppressRules）全部
重算，并配两条不变量（never⇒have 必红、always⇒none 必红）。

为什么要改：R34 三次同形踩坑（§二十六 CUT-4/5 漏 traversal、§三十 CUT-C 漏
reportRules、§三十一 CUT-A 漏 have 少算 uploadDraft）—— 每次修的都是推导逻辑
不是代码，说明手列期望这个动作本身不可靠。工具化后漏维度在结构上不可能。

本脚本只做「源码实测」：真的改源码 → 跑闸门 → 与工具推导的期望比对。
两侧一致才有意义：
  · 不一致 ⇒ IR 层等价性假设不成立，或源码改动点根本没生效（后者正是
    「改了源码但没生效」这类静默失效的探测器）。

用法：python3 blind-benchmark/reverse-verify-e5.py
退出码 0 = 三刀的转红集合均符合预期且源码已还原。
"""
import subprocess, sys, pathlib, re, shutil, json

ROOT = pathlib.Path(__file__).resolve().parent.parent
EXTRACT = ROOT / "src" / "extract-ir.ts"
DETECTOR = ROOT / "src" / "protocol-detector.ts"

CUTS = [
    {
        "id": "CUT-A",
        "desc": "提取侧恒 false：副作用证据永不产出",
        "file": EXTRACT,
        "old": 'if (bodyHasExternalEffect(node.getText?.() ?? "")) out.add(`${fileRel}|${name}`);',
        "new": 'if (false && bodyHasExternalEffect(node.getText?.() ?? "")) out.add(`${fileRel}|${name}`);',
        # expect_fail 已移除 —— 由 derive-cut-expectations.ts 机械推导（R44）。
        # 历史值（手列，曾漏 uploadDraft 的 have 维度）：createWidget, createOrder,
        # postMetric, uploadBanner, uploadIcon, uploadThumb, uploadDraft
    },
    {
        "id": "CUT-B",
        "desc": "规则侧移除 requireMarker：无副作用的函数也报",
        "file": DETECTOR,
        "old": '    requireMarker: "__progmune_input_effect__",',
        "new": '    // [CUT-B] requireMarker 已移除\n',
        # expect_fail 由 derive-cut-expectations.ts 推导（R44）
    },
    {
        "id": "CUT-C",
        "desc": "提取侧恒 true：无条件注入标记",
        "file": EXTRACT,
        "old": 'if (bodyHasExternalEffect(node.getText?.() ?? "")) out.add(`${fileRel}|${name}`);',
        "new": 'if (true || bodyHasExternalEffect(node.getText?.() ?? "")) out.add(`${fileRel}|${name}`);',
        # expect_fail 由 derive-cut-expectations.ts 推导（R44）
    },
]

EXPECT_JSON = ROOT / "blind-benchmark" / "reports" / "cut-expectations.json"


def load_expected() -> dict:
    """调 derive-cut-expectations.ts 机械推导转红集合（R44：期望不得手列）。"""
    p = subprocess.run(
        ["npx", "tsx", "blind-benchmark/derive-cut-expectations.ts", "--json"],
        cwd=ROOT, capture_output=True, text=True,
        env={"PATH": "/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:"
                     "/Users/shenlian/.workbuddy/binaries/node/versions/22.12.0/bin",
             "NODE_OPTIONS": "--max-old-space-size=2048",
             "PROGMUNE_HUB": "off", "PROGMUNE_MAX_LLM_CALLS": "0",
             "HOME": "/Users/shenlian"},
    )
    if p.returncode != 0:
        print("✗ 期望推导失败（基线未全绿或语料缺失）：")
        print(p.stdout[-2000:], p.stderr[-2000:])
        sys.exit(1)
    data = json.loads(EXPECT_JSON.read_text())
    out = {}
    for c in data["cuts"]:
        out[c["id"]] = {
            "fns": set(c["redFns"]),
            "ruleMediated": set(x["fn"] for x in c.get("ruleMediated", [])
                                if isinstance(x, dict)) or set(c.get("ruleMediated", [])),
            "invariantOk": c["invariantOk"],
        }
    print(f"[expect] 由期望表机械推导：{len(out)} 刀，"
          f"基线 {data['baselineTotal']} 条 / 违反 {data['baselineViolations']}")
    for cid, v in out.items():
        if not v["invariantOk"]:
            print(f"✗ {cid} 不变量失败，推导不可信")
            sys.exit(1)
    return out


def run_gate():
    p = subprocess.run(
        ["npx", "tsx", "blind-benchmark/check-webshape.ts"],
        cwd=ROOT, capture_output=True, text=True,
        env={"PATH": "/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:"
                     "/Users/shenlian/.workbuddy/binaries/node/versions/22.12.0/bin",
             "NODE_OPTIONS": "--max-old-space-size=2048",
             "PROGMUNE_HUB": "off", "PROGMUNE_MAX_LLM_CALLS": "0",
             "HOME": "/Users/shenlian"},
    )
    out = p.stdout + p.stderr
    bad = set()
    for line in out.splitlines():
        m = re.match(r"\s*!\s+(\w+)\s+✗", line)
        if m:
            bad.add(m.group(1))
    return bad, out


def main():
    expected = load_expected()
    backups = {}
    ok = True
    try:
        for cut in CUTS:
            f = cut["file"]
            if f not in backups:
                backups[f] = f.read_text()
            src = f.read_text()
            if cut["old"] not in src:
                print(f"✗ {cut['id']} 找不到锚点，脚本与源码已漂移：{cut['old'][:60]}")
                ok = False
                continue
            f.write_text(src.replace(cut["old"], cut["new"], 1))
            bad, out = run_gate()
            exp = expected.get(cut["id"])
            if exp is None:
                print(f"✗ {cut['id']} 不在推导结果里（工具与本脚本的 cut id 对不上）")
                ok = False
                continue
            expect = exp["fns"]
            missing = expect - bad      # 该转红却没转红 ⇒ 机制没被真正验证到
            extra = bad - expect        # 转红落在别人身上 ⇒ 机制牵连过广
            status = "✓" if not missing and not extra else "✗"
            if missing or extra:
                ok = False
            print(f"{status} {cut['id']} {cut['desc']}")
            print(f"     转红 {len(bad)} 条：{sorted(bad)}")
            if missing:
                print(f"     ⚠ 应转红未转红：{sorted(missing)}")
            if extra:
                print(f"     ⚠ 转红落在预期之外：{sorted(extra)}")
            f.write_text(backups[f])    # 每刀跑完立刻还原
    finally:
        for f, txt in backups.items():
            f.write_text(txt)
        print("\n[restore] 源码已还原")

    # 还原后必须全绿
    bad, out = run_gate()
    print(f"[baseline] 还原后转红 {len(bad)} 条（应为 0）：{sorted(bad) if bad else '—'}")
    if bad:
        ok = False
    print("\n结论：", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
