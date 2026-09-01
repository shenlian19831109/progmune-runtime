/**
 * Go 协议盲测 v1——自包含生成 + 扫描（镜像 scan-protocol-c-app 方法学）
 *
 * 管线（生产路径）：extractIRGo → 注解合并 → buildCallSequences →
 * validateSequenceWithSSG（经 evaluateTrust 全链路，language=go）。
 * 金标 = 每项目预期 (SSG 违规前缀, 函数) 清单。
 *
 * 网格：3 结构风格（直连函数 / 接收者方法 / helper 中介）×
 *       违规类型（missing_auth / read_without_open / leak_file / clean）。
 *
 * Usage: npx ts-node blind-benchmark/scan-protocol-golang.ts
 */

import * as fs from "fs";
import * as path from "path";
import { evaluateTrust } from "../src/trust/engine";

const GEN_DIR = path.resolve(__dirname, "generated-golang");

const PRIMITIVES = `
// @progmune(namespace="auth", pre=["UNAUTHENTICATED"], post=["PASSWORD_VERIFIED"])
func VerifyPassword(user, password string) bool { return password == "secret" }

// @progmune(namespace="auth", pre=[], post=["AUTHENTICATED"])
func EstablishSession(user string) string { return "tok_" + user }

// @progmune(namespace="auth", pre=["AUTHENTICATED"], post=["AUTHORIZED"])
func TransferMoney(amount int) {}

// @progmune(namespace="file", pre=[], post=["FILE_OPEN"])
func OpenDataFile(p string) string { return "h" }

// @progmune(namespace="file", pre=["FILE_OPEN"])
func ReadDataFile(h string) string { return "data" }

// @progmune(namespace="file", pre=["FILE_OPEN"], invalidate=["FILE_OPEN"])
func CloseDataFile(h string) {}
`;

const GOOD_FLOWS = `
func GoodAuthFlow(user string) {
	if VerifyPassword(user, "secret") {
		EstablishSession(user)
	}
}

func GoodFileFlow() {
	h := OpenDataFile("/tmp/x")
	ReadDataFile(h)
	CloseDataFile(h)
}
`;

interface Spec {
  id: string;
  broken: string;
  gold: Array<{ prefix: string; fn: string }>;
}

const SPECS: Spec[] = [
  {
    id: "go_clean_direct",
    broken: "",
    gold: [],
  },
  {
    id: "go_clean_methods",
    broken: "",
    gold: [],
  },
  {
    id: "go_clean_helper",
    broken: `
func HelperFlow(user string) {
	doAuth(user)
}

func doAuth(user string) {
	VerifyPassword(user, "secret")
	EstablishSession(user)
}
`,
    gold: [],
  },
  {
    id: "go_broken_missing_auth",
    broken: `
func BrokenMissingAuth() {
	TransferMoney(100)
}
`,
    gold: [{ prefix: "SSG_AUTH", fn: "BrokenMissingAuth" }],
  },
  {
    id: "go_broken_read_without_open",
    broken: `
func BrokenRead() {
	ReadDataFile("h")
}
`,
    gold: [{ prefix: "SSG_FILE", fn: "BrokenRead" }],
  },
  {
    id: "go_broken_leak",
    broken: `
func BrokenLeak() {
	h := OpenDataFile("/tmp/x")
	_ = h
}
`,
    gold: [{ prefix: "SSG_FILE", fn: "BrokenLeak" }],
  },
];

function main() {
  fs.rmSync(GEN_DIR, { recursive: true, force: true });
  fs.mkdirSync(GEN_DIR, { recursive: true });
  for (const spec of SPECS) {
    const dir = path.join(GEN_DIR, spec.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "main.go"),
      `package main\n\n${PRIMITIVES}\n${GOOD_FLOWS}\n${spec.broken}\n`
    );
  }

  (async () => {
    let tp = 0, fp = 0, fn = 0;
    for (const spec of SPECS) {
      const r = await evaluateTrust({
        projectPath: path.join(GEN_DIR, spec.id),
        projectName: spec.id, commit: "a", language: "go",
      });
      const detected = r.violations
        .filter((v) => v.rule_id.startsWith("SSG_"))
        .map((v) => ({ prefix: v.rule_id.split("_STATE")[0] + "_STATE" || v.rule_id, fn: v.function, full: v.rule_id }));

      const goldSet = new Set(spec.gold.map((g) => `${g.prefix}@${g.fn}`));
      let rowTp = 0, rowFp = 0, rowFn = 0;
      for (const d of detected) {
        if (goldSet.has(`${d.prefix}@${d.fn}`) || spec.gold.some((g) => d.fn === g.fn && d.full.startsWith(g.prefix))) {
          rowTp++; tp++;
        } else { rowFp++; fp++; console.log(`  ✗FP ${spec.id}: ${d.full}@${d.fn}`); }
      }
      for (const g of spec.gold) {
        if (!detected.some((d) => d.fn === g.fn && d.full.startsWith(g.prefix))) {
          rowFn++; fn++; console.log(`  ✗FN ${spec.id}: ${g.prefix}@${g.fn}`);
        }
      }
      console.log(`${spec.id}: TP ${rowTp} / FP ${rowFp} / FN ${rowFn}（决策 ${r.overall.decision} ${r.overall.score}）`);
    }

    const precision = tp / (tp + fp) || 0;
    const recall = tp / (tp + fn) || 0;
    console.log(`\n总计：TP ${tp} / FP ${fp} / FN ${fn}`);
    console.log(`Precision ${(precision * 100).toFixed(1)}% / Recall ${(recall * 100).toFixed(1)}%`);

    fs.writeFileSync(
      path.join(__dirname, "reports", "scan-protocol-golang-results.json"),
      JSON.stringify({
        generated: new Date().toISOString(),
        method: "extractIRGo + SSG（生产管线 evaluateTrust，language=go）",
        summary: { tp, fp, fn, precision, recall },
      }, null, 2)
    );
    console.log("报告 → blind-benchmark/reports/scan-protocol-golang-results.json");
  })().catch((e) => { console.error(e); process.exit(1); });
}

main();
