#!/usr/bin/env python3
"""
base-47.py —— §47 的**同刻基线**生成（R73）

`上一次的 results` / 冻结母本都不是同刻基线，直接比对会低估或高估一到两个数量级。
正确分母只有一种：把这一刀摘掉、**当场重跑**。

本脚本自动化整件事，并保证源码一定会被还原（finally）：
  1. 刀在 → 跑 batch-scan → 存 batch-scan-results.post-47.json
  2. 摘刀 → 跑 batch-scan → 存 batch-scan-results.pre-47.json
  3. 还原源码

用法：python3 blind-benchmark/base-47.py
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src" / "protocol-detector.ts"
REPORTS = ROOT / "blind-benchmark" / "reports"
FIXED = REPORTS / "batch-scan-results.json"
KNIFE = "paramTypeSafeguards: [SESSION_BEARING_TYPE_RE],"

orig = SRC.read_text()
occ = orig.count(KNIFE)
print(f"刀的出现次数 = {occ}（应为 2）")
if occ != 2:
    sys.exit("摘刀锚点对不上，脚本不盲跑")

def scan(tag):
    print(f"\n=== 跑 batch-scan（{tag}）===")
    env = {**os.environ, "PROGMUNE_HUB": "off", "PROGMUNE_MAX_LLM_CALLS": "0",
           "NODE_OPTIONS": "--max-old-space-size=1536"}
    r = subprocess.run(["npx", "tsx", "blind-benchmark/batch-scan.ts"],
                       cwd=ROOT, capture_output=True, text=True, env=env)
    tail = (r.stdout + r.stderr).strip().splitlines()[-6:]
    print("\n".join(tail))
    dst = REPORTS / f"batch-scan-results.{tag}.json"
    shutil.copy(FIXED, dst)
    print(f"→ {dst.name}")


try:
    scan("post-47")
    patched = orig.replace(KNIFE + "\n", "")
    SRC.write_text(patched)
    assert patched.count(KNIFE) == 0, "摘刀失败"
    print("\n刀已摘（规则上的 paramTypeSafeguards 已移除），跑反向对照")
    scan("pre-47")
    # R64：新增的 suppress 期望在摘刀后**必须转红**；不转红说明是被别机制抢先压的（假绿）。
    env = {**os.environ, "PROGMUNE_HUB": "off", "PROGMUNE_MAX_LLM_CALLS": "0",
           "NODE_OPTIONS": "--max-old-space-size=1536"}
    print("\n=== 反向验证：摘刀状态下跑 webshape 门（期望 webshape_H 的 suppress 组转红）===")
    r = subprocess.run(["npx", "tsx", "blind-benchmark/check-webshape.ts"],
                       cwd=ROOT, capture_output=True, text=True, env=env)
    out = (r.stdout + r.stderr)
    for line in out.strip().splitlines():
        if "✗" in line or "合计" in line or "webshape_H" in line:
            print("   " + line.strip())
    out_path = REPORTS / "webshape-pre47.txt"
    out_path.write_text(out)
    print(f"→ 全文写入 {out_path.name}")
finally:
    SRC.write_text(orig)
    restored = SRC.read_text() == orig
    print(f"\n源码已还原 = {restored}")
    if not restored:
        sys.exit("!!! 还原失败，请手工 check git diff src/protocol-detector.ts")
