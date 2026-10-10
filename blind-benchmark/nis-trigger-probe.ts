/**
 * §49.19 补标注后续：No Input Sanitization 触发词裁剪离线重放（只读，不改 src）
 *
 * 数据背景：
 * - docmost 补标注队列 174 条：No Input Sanitization 32 条全 FP——
 *   30 条 Kysely insertInto 数据入库（"insert" 词撞）、1 条 react-email
 *   render（服务端渲染代码内静态模板）、1 条 cheerio append（导入管线 DOM 重组）
 * - TS 盲测 10 条 flag：8 条 writeFileSync（"write" 词撞）、2 条
 *   insertInto/insert（webshape_F）
 * - Python 盲测 270 条 flag：全部 list.append（"append" 词撞）
 *
 * 原理：该规则无 paramGate/requireMarker/triggerOwnNameOnly 等门，
 *       flag(f) ⟺ trigger 命中 effectiveCalls(f) ∧ safeguard 未命中。
 *       trigger 改动只影响前者（safeguard 不变）⇒
 *       LOST(f) ⟺ 旧 trigger 命中 ∧ 新 trigger 不命中。
 *       effectiveCalls 用 detector 导出的 identifierParse 重算，
 *       与真实实现同口径。
 */
import * as fs from "fs";
import { identifierParse } from "/Users/shenlian/progmune-runtime/src/protocol-detector";

const RULE = "No Input Sanitization";

// 旧 trigger（src/protocol-detector.ts 现行定义）
const TRIG_OLD =
  /\b(render|display|write|output|append|insert|innerHTML|dangerouslySetInnerHTML|document\.write|echo|printf|sprintf)\b/i;
// 候选变体（+insertAdjacentHTML：insert 词的本意 DOM sink，收窄后显式保留）
const VARIANTS: Record<string, RegExp> = {
  "V1 drop insert": new RegExp(
    "\\b(render|display|write|output|append|innerHTML|dangerouslySetInnerHTML|document\\.write|echo|printf|sprintf|insertAdjacentHTML)\\b",
    "i"
  ),
  "V2 drop insert+append": new RegExp(
    "\\b(render|display|write|output|innerHTML|dangerouslySetInnerHTML|document\\.write|echo|printf|sprintf|insertAdjacentHTML)\\b",
    "i"
  ),
  "V3 drop insert+append+write": new RegExp(
    "\\b(render|display|output|innerHTML|dangerouslySetInnerHTML|document\\.write|echo|printf|sprintf|insertAdjacentHTML)\\b",
    "i"
  ),
};

interface Entry {
  fn: string;
  calls: string[];
  source: string; // 语料标识（docmost-fullscan / ts-blind / py-blind）
}

function effectiveCalls(fn: string, calls: string[]): string[] {
  const ownName = fn.split(".").pop() || fn;
  const raw = [ownName, ...calls];
  const words: string[] = [];
  for (const c of raw) words.push(...identifierParse(c));
  return [...new Set([...raw, ...words])];
}

function loads(): Entry[] {
  const out: Entry[] = [];
  // docmost fullscan（1202 条，含 calls 记录）
  const fsP = "/Users/shenlian/progmune-runtime/blind-benchmark/reports/advisories/fullscan-docmost.jsonl";
  for (const line of fs.readFileSync(fsP, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const e = JSON.parse(line);
    if (e.rule !== RULE) continue;
    out.push({ fn: e.fn, calls: e.calls || [], source: "docmost-fullscan" });
  }
  // TS 盲测（119 项目 perFunction 记录）
  const tsB = JSON.parse(
    fs.readFileSync("/Users/shenlian/progmune-runtime/blind-benchmark/reports/batch-scan-results.json", "utf8")
  );
  for (const p of tsB.projects) {
    for (const pf of p.perFunction || []) {
      const f = typeof pf === "string" ? JSON.parse(pf) : pf;
      const svs = f.safeguardViolations || [];
      if (!svs.some((s: any) => (typeof s === "string" ? s : s.rule) === RULE)) continue;
      out.push({ fn: f.name, calls: f.calls || [], source: `ts-blind:${p.project}` });
    }
  }
  // Python 盲测（90 项目 perFunction 记录）
  const pyB = JSON.parse(
    fs.readFileSync("/Users/shenlian/progmune-runtime/blind-benchmark/reports/batch-scan-python-results.json", "utf8")
  );
  for (const p of pyB.projects) {
    for (const pf of p.perFunction || []) {
      const f = typeof pf === "string" ? JSON.parse(pf) : pf;
      const svs = f.safeguardViolations || [];
      if (!svs.some((s: any) => (typeof s === "string" ? s : s.rule) === RULE)) continue;
      out.push({ fn: f.name, calls: f.calls || [], source: `py-blind:${p.project}` });
    }
  }
  return out;
}

const entries = loads();
console.log(`当前 No Input Sanitization flag 总数（重放口径）: ${entries.length}`);
const bySource = new Map<string, number>();
for (const e of entries) bySource.set(e.source.split(":")[0], (bySource.get(e.source.split(":")[0]) || 0) + 1);
console.log("按语料：", [...bySource.entries()].map(([k, n]) => `${k}=${n}`).join("  "));

// 触发词归因：旧 trigger 具体由哪个词命中
function matchedWords(fn: string, calls: string[]): string[] {
  const eff = effectiveCalls(fn, calls);
  const words = ["render", "display", "write", "output", "append", "insert", "innerHTML", "dangerouslySetInnerHTML", "echo", "printf", "sprintf"];
  return words.filter((w) => {
    if (w === "document.write") return eff.some((c) => /document\.write/i.test(c));
    return eff.some((c) => new RegExp(`\\b${w}\\b`, "i").test(c));
  });
}
const attrib = new Map<string, number>();
for (const e of entries) {
  for (const w of matchedWords(e.fn, e.calls)) attrib.set(w, (attrib.get(w) || 0) + 1);
}
console.log("\n旧 trigger 命中词归因：", [...attrib.entries()].map(([k, n]) => `${k}=${n}`).join("  "));

for (const [vname, re] of Object.entries(VARIANTS)) {
  const lost = entries.filter((e) => !effectiveCalls(e.fn, e.calls).some((c) => re.test(c)));
  const bySrc = new Map<string, number>();
  for (const e of lost) bySrc.set(e.source.split(":")[0], (bySrc.get(e.source.split(":")[0]) || 0) + 1);
  console.log(`\n${vname}: LOST ${lost.length}/${entries.length}`);
  console.log("  按语料：", [...bySrc.entries()].map(([k, n]) => `${k}=${n}`).join("  "));
  if (vname === "V1 drop insert") {
    console.log("  docmost 丢失明细（应为 30 条 insertInto 族）:");
    for (const e of lost.filter((x) => x.source === "docmost-fullscan").slice(0, 8)) console.log("   -", e.fn);
    if (lost.filter((x) => x.source === "docmost-fullscan").length > 8)
      console.log("   …");
  }
}
