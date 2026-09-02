/**
 * Go 提取器恢复率对比（步骤②——桥决策的裁决数据）
 *
 * 同一语料两路提取：
 *   gold   = tools/go-fn-list.go（标准库 go/parser，真 AST）
 *   lexical = extractIRGo（纯 TS 词法）
 * 恢复率 = |lexical ∩ gold| / |gold|（按文件对齐，同一文件集口径——
 * *_test.go 双方都排除；解析失败文件两边都跳过）。
 *
 * 顺带测量「命名鸿沟」：词法提取到的函数名里，有多少能被词段匹配
 * （≥2 规则词）桥接到内置规则名——孵化器理论的核心数据（C 死在这里：
 * ngx_read_file 类前缀包装 0 命中；Go 的 os.ReadFile 类命名预期跨过）。
 *
 * Usage: npx ts-node blind-benchmark/scan-go-recovery.ts [corpusDir]
 * 默认语料：GOROOT/src 的 net/http + crypto/tls + os + database/sql
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { extractIRGo } from "../src/extract-ir-go";

function goRoot(): string {
  try {
    return execSync("go env GOROOT", { encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}

function goldFunctions(corpusDir: string): Map<string, Set<string>> {
  const tmp = path.join(require("os").tmpdir(), `go-gold-${process.pid}.json`);
  const helper = path.resolve(__dirname, "..", "tools", "go-fn-list.go");
  execSync(`go run "${helper}" "${corpusDir}" "${tmp}"`, { encoding: "utf-8", stdio: "pipe" });
  const data = JSON.parse(fs.readFileSync(tmp, "utf-8"));
  fs.unlinkSync(tmp);
  const map = new Map<string, Set<string>>();
  for (const [file, names] of Object.entries(data)) {
    map.set(file, new Set(names as string[]));
  }
  return map;
}

function main() {
  const goRootPath = goRoot();
  const corpuses: Array<{ name: string; dir: string }> = [];
  const explicit = process.argv[2];
  if (explicit) {
    corpuses.push({ name: path.basename(explicit), dir: explicit });
  } else if (goRootPath) {
    for (const pkg of ["net/http", "crypto/tls", "os", "database/sql"]) {
      const dir = path.join(goRootPath, "src", pkg);
      if (fs.existsSync(dir)) corpuses.push({ name: pkg, dir });
    }
  }
  if (corpuses.length === 0) {
    console.error("无可用语料（go 未安装或 GOROOT 不可读）");
    process.exit(1);
  }

  const rules = loadRuleNames();
  let totalGold = 0, totalHit = 0;
  const rows: any[] = [];

  for (const { name, dir } of corpuses) {
    const gold = goldFunctions(dir);
    const lexical = new Map<string, Set<string>>();
    for (const fn of extractIRGo(dir)) {
      if (!lexical.has(fn.file)) lexical.set(fn.file, new Set());
      lexical.get(fn.file)!.add(fn.name);
    }

    let goldCount = 0, hit = 0;
    const missed: string[] = [];
    let bridgeable = 0, totalNames = 0;
    for (const [file, names] of gold) {
      const lexNames = lexical.get(file) || new Set<string>();
      for (const n of names) {
        goldCount++;
        totalNames++;
        if (lexNames.has(n)) { hit++; continue; }
        if (missed.length < 8) missed.push(`${file}::${n}`);
      }
      // 命名鸿沟：词段可桥接数（≥2 规则词全部出现在函数名）
      for (const n of names) {
        if (wordSegmentBridgeable(n, rules)) bridgeable++;
      }
    }

    totalGold += goldCount;
    totalHit += hit;
    const rate = goldCount > 0 ? (hit / goldCount) * 100 : 0;
    const bridgeRate = totalNames > 0 ? (bridgeable / totalNames) * 100 : 0;
    rows.push({ corpus: name, gold: goldCount, recovered: hit, recoveryRate: rate, bridgeable, totalNames, bridgeRate });
    console.log(`${name}: 恢复 ${hit}/${goldCount} = ${rate.toFixed(1)}% | 词段可桥接 ${bridgeable}/${totalNames} = ${bridgeRate.toFixed(1)}%`);
    if (missed.length > 0) console.log(`  漏检样例: ${missed.join(", ")}`);
  }

  const overall = totalGold > 0 ? (totalHit / totalGold) * 100 : 0;
  console.log(`\n总体恢复率: ${totalHit}/${totalGold} = ${overall.toFixed(1)}%`);
  fs.writeFileSync(
    path.join(__dirname, "reports", "scan-go-recovery-results.json"),
    JSON.stringify({
      generated: new Date().toISOString(),
      method: "go/parser（gold） vs extractIRGo（词法），同一文件集口径",
      summary: { totalGold, totalHit, recoveryRate: overall },
      rows,
    }, null, 2)
  );
  console.log("报告 → blind-benchmark/reports/scan-go-recovery-results.json");
}

/** 内置规则名（protocols.json）——词段桥接词汇表 */
function loadRuleNames(): string[] {
  const p = path.resolve(__dirname, "..", "protocols.json");
  const data = JSON.parse(fs.readFileSync(p, "utf-8"));
  return Object.keys(data.rules || {});
}

/** 词段可桥接：某规则名拆分出的 ≥2 词全部出现在函数名（CamelCase/snake 双形态） */
function wordSegmentBridgeable(fnName: string, ruleNames: string[]): boolean {
  const lower = fnName.toLowerCase();
  for (const rule of ruleNames) {
    const words = rule.split("_").filter((w) => w.length >= 2);
    if (words.length < 2) continue;
    if (words.every((w) => lower.includes(w))) return true;
  }
  return false;
}

main();
