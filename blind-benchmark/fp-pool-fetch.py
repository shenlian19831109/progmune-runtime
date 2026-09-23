#!/usr/bin/env python3
"""
FP 观测池切片抓取器（2026-09-21）

用途：把真实 GitHub 仓库切成「能安全扫」的小切片，放进 blind-benchmark/fp-pool/。

为什么需要它：本机 8GB + swap 常年吃满，单文件 >~400KB 的 TS 会让 ts-morph OOM；
整仓扫描必挂。切片只留 .ts/.tsx + package.json + tsconfig.json，并砍掉大文件。

用法：
    python3 blind-benchmark/fp-pool-fetch.py <owner/repo> [--ref main] [--max-files 120]
                                             [--dir 切片目录名] [--keep-tests]

约定（与既有 4 个切片保持一致）：
  - 排除 .d.ts / *.test.ts / *.spec.ts（默认；--keep-tests 可保留）
  - 排除 node_modules / dist / build / coverage / .git / e2e
  - 单文件 >400KB 直接丢（OOM 防线）
  - 优先保留 src/ api/ server/ app/ packages/ lib/ 下的文件；超上限时按路径排序截断（确定性）

只做「取 + 切」，不扫描。扫描是 fp-pool-scan.ts 的事（口径与 batch-scan 一致）。
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request

POOL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fp-pool")

# 排除目录
EXCLUDE_DIRS = {
    "node_modules", "dist", "build", "coverage", ".git", "e2e", "__tests__",
    "test", "tests", "docs", "examples", "scripts", "benchmark", "vendor",
    ".next", ".nuxt", "out", "public", "static", "assets", "migrations",
}

# 优先目录（打分用，越大越优先）
PREFERRED = ("src/", "api/", "server/", "app/", "packages/", "lib/")


def should_skip_file(name: str, size: int, keep_tests: bool) -> bool:
    if size > 400 * 1024:
        return True
    if not keep_tests:
        if name.endswith(".test.ts") or name.endswith(".spec.ts"):
            return True
        if name.endswith(".test.tsx") or name.endswith(".spec.tsx"):
            return True
    if name.endswith(".d.ts"):
        return True
    return False


def priority(rel: str) -> int:
    """越大越优先。优先业务源码目录，其次其它。"""
    low = rel.lower()
    score = 0
    for i, p in enumerate(PREFERRED):
        if p in low:
            score = max(score, len(PREFERRED) - i)
    if "/test" in low or "/spec" in low:
        score -= 5
    return score


def round_robin(kept: list, max_files: int) -> list:
    """按「目录」轮转取样，避免名额被单一子树吃光。

    kept 已按（优先分降序, 路径升序）排好；这里保持组内顺序，组间轮转。
    分组键取路径的前两级目录（顶层目录只有一层时用一层）。
    """
    groups: dict = {}
    order: list = []
    for item in kept:
        parts = item[0].split(os.sep)
        key = os.sep.join(parts[:2]) if len(parts) > 2 else (
            parts[0] if parts else "."
        )
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append(item)

    chosen, i = [], 0
    while len(chosen) < max_files:
        progressed = False
        for key in order:
            if i < len(groups[key]):
                chosen.append(groups[key][i])
                progressed = True
                if len(chosen) >= max_files:
                    break
        if not progressed:
            break
        i += 1
    return chosen


def slice_repo(
    tarball: str, dest: str, max_files: int, keep_tests: bool, prefix: str = ""
) -> dict:
    kept, skipped_big, skipped_other = [], 0, 0
    with tempfile.TemporaryDirectory() as td:
        with tarfile.open(tarball) as tf:
            tf.extractall(td)
        root = os.path.join(td, os.listdir(td)[0])
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d.lower() not in EXCLUDE_DIRS]
            for fn in filenames:
                full = os.path.join(dirpath, fn)
                rel = os.path.relpath(full, root)
                if prefix and not rel.startswith(prefix.rstrip("/") + os.sep):
                    continue
                try:
                    size = os.path.getsize(full)
                except OSError:
                    continue
                if fn.endswith((".ts", ".tsx")):
                    if should_skip_file(fn, size, keep_tests):
                        skipped_big += 1
                        continue
                    kept.append((rel, size, priority(rel)))
                elif fn == "package.json" or (fn.startswith("tsconfig") and fn.endswith(".json")):
                    # 只留最靠近根的两层，避免每个 package 都塞一份
                    # ⚠ tsconfig 必须用前缀匹配而非只认 `tsconfig.json`（2026-09-22）：
                    #   solution 风格仓库的根 tsconfig 只是容器（`files: []` +
                    #   `include: []` + references 指向 tsconfig.app.json），
                    #   只留它会让切片加载出 **0 个源文件 ⇒ 0 个函数**，
                    #   并且**静默**——切出来的片在池里以「0 违规」假装参与统计。
                    #   实测踩到：gothinkster/node-express-realworld-example-app。
                    depth = rel.count(os.sep)
                    if depth <= 2:
                        kept.append((rel, size, 10))
                else:
                    skipped_other += 1

    # 确定性排序：优先分降序，其次路径升序
    kept.sort(key=lambda x: (-x[2], x[0]))
    # ⚠ 不能直接取前 N：按分数取会把名额全喂给同一棵子树（outline 那次 110 个文件
    #   几乎全是 routes/api/*，因为路径含 "api/" 得分最高）⇒ 切片有偏，扫出来的
    #   函数数只有别的片的零头。改成**按目录轮转**：各目录轮流取，保证切片铺得开。
    chosen = round_robin(kept, max_files)

    os.makedirs(dest, exist_ok=True)
    with tempfile.TemporaryDirectory() as td:
        with tarfile.open(tarball) as tf:
            tf.extractall(td)
        root = os.path.join(td, os.listdir(td)[0])
        n = 0
        for rel, _size, _p in chosen:
            src = os.path.join(root, rel)
            # --prefix 模式下把前缀剥掉，让切片根目录就是那个 package 的根
            out_rel = rel[len(prefix.rstrip("/")) + 1:] if prefix else rel
            dst = os.path.join(dest, out_rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copyfile(src, dst)
            n += 1

    # 根配置兜底：扫切片必须有 <slice>/tsconfig.json（ts-morph 缺它直接抛错）
    ensure_root_config(dest, tarball)
    return {
        "kept": n,
        "candidates": len(kept),
        "skipped_big_or_test": skipped_big,
        "truncated": max(0, len(kept) - max_files),
    }


def ensure_root_config(dest: str, tarball: str) -> None:
    """切片根必须有 package.json 与 tsconfig.json。monorepo 的 tsconfig 常在子包里，
    切片时若没带上，扫描会直接 `File not found: tsconfig.json` 失败（2026-09-21 踩到）。
    这里从原 tarball 里捞一份最浅的补到根。"""
    if os.path.exists(os.path.join(dest, "tsconfig.json")) and os.path.exists(
        os.path.join(dest, "package.json")
    ):
        return
    best = {}
    with tempfile.TemporaryDirectory() as td:
        with tarfile.open(tarball) as tf:
            tf.extractall(td)
        root = os.path.join(td, os.listdir(td)[0])
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d.lower() not in EXCLUDE_DIRS]
            for fn in filenames:
                if fn in ("tsconfig.json", "package.json"):
                    rel = os.path.relpath(os.path.join(dirpath, fn), root)
                    depth = rel.count(os.sep)
                    if fn not in best or depth < best[fn][0]:
                        best[fn] = (depth, rel)
        for fn, (_d, rel) in best.items():
            dst = os.path.join(dest, fn)
            if os.path.exists(dst):
                continue
            if fn == "tsconfig.json":
                # 子包 tsconfig 常带 extends/references 指向切片外的路径（monorepo 根配置、
                # 其它子包），照抄会让 ts-morph 读到不存在的基配置 ⇒ 剥掉，只留本包选项。
                try:
                    cfg = json.load(open(os.path.join(root, rel)))
                    cfg.pop("extends", None)
                    cfg.pop("references", None)
                    cfg.pop("include", None)
                    cfg.pop("exclude", None)
                    json.dump(cfg, open(dst, "w"), indent=2)
                except Exception:  # noqa: BLE001
                    shutil.copyfile(os.path.join(root, rel), dst)
            else:
                shutil.copyfile(os.path.join(root, rel), dst)
            print(f"[config] 根目录补 {fn}（取自 {rel}，已剥 extends/references）")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("repo", help="owner/repo")
    ap.add_argument("--ref", default=None, help="git ref（默认用默认分支）")
    ap.add_argument("--max-files", type=int, default=120)
    ap.add_argument("--dir", default=None, help="切片目录名（默认取 repo 名）")
    ap.add_argument("--prefix", default="", help="只保留该子目录（monorepo 用，前缀会被剥掉）")
    ap.add_argument("--keep-tests", action="store_true")
    args = ap.parse_args()

    owner, name = args.repo.split("/")
    ref = args.ref or default_branch(owner, name)
    dest_name = args.dir or name
    dest = os.path.join(POOL, dest_name)
    if os.path.exists(dest):
        print(f"[skip] {dest} 已存在，先手工删除再抓")
        return 1

    url = f"https://codeload.github.com/{owner}/{name}/tar.gz/{ref}"
    tmp = os.path.join(tempfile.gettempdir(), f"fp-pool-{name}-{ref}.tar.gz")
    print(f"[fetch] {url}")
    try:
        urllib.request.urlretrieve(url, tmp)
    except Exception as e:  # noqa: BLE001
        print(f"[fail] 下载失败：{e}")
        return 2
    print(f"[fetch] {os.path.getsize(tmp) / 1024:.0f} KB")

    stat = slice_repo(tmp, dest, args.max_files, args.keep_tests, args.prefix)
    print(
        f"[slice] {dest_name}: 保留 {stat['kept']} / 候选 {stat['candidates']}"
        f"（丢弃 {stat['skipped_big_or_test']} 个大文件或测试，截断 {stat['truncated']}）"
    )
    print(f"[done] {dest}")
    return 0


def default_branch(owner: str, name: str) -> str:
    """问 GitHub 默认分支；失败就退回 main（调用方可用 --ref 兜）。"""
    try:
        import json
        import urllib.request
        req = urllib.request.Request(
            f"https://api.github.com/repos/{owner}/{name}",
            headers={"User-Agent": "progmune-fp-pool"},
        )
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.load(r).get("default_branch", "main")
    except Exception:  # noqa: BLE001
        return "main"


if __name__ == "__main__":
    sys.exit(main())
