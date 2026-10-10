/**
 * 修冤枉第五刀预研：授权族「守卫沿调用链传播」量化探针（只读，不改 src）
 *
 * 数据：docmost 补标注 111 条授权族告警全 FP，其中 49 条（44%）根因是
 * 「守卫在 controller 层，repo/service 层函数名字级看不见」。
 *
 * 量化问题：若「函数的全部直接调用方都已被守卫（自身带 E2 标记或传递
 * 性已守卫）⇒ 该函数视为守卫后」这一保守豁免上线，
 *   (a) docmost 授权族告警流能压掉多少条？
 *   (b) TS 盲测合成语料会 LOST 多少条授权族 flag（逐条看是真报还是词撞）？
 *
 * 保守设计（写死在探针里，与实现保持一致才可信）：
 *   R1 只有【全部】调用方已守卫才豁免（任一调用方无守卫证据→照报）
 *   R2 守卫沿调用链向下传播 ≤3 跳（controller→service→repo 三跳够用）
 *   R3 传播通道只认 __progmune_auth_machinery__ 一个标记（窄通道）
 *   R4 裸名调用解析到函数用名字后缀唯一匹配；同名多处定义⇒歧义，
 *      歧义的调用方按【未守卫】处理（fail-safe）
 *   R5 豁免仅作用于 authorization 类规则
 *   R6 豁免仅作用于【非直接标记】函数——自身带标记的维持既有 E2 语义
 *      （只接受标记的规则由 detector 自身处理；不接受标记的规则照报）
 */
import * as fs from "fs";
import { computeGuardPropagatedSet } from "/Users/shenlian/progmune-runtime/src/protocol-detector";

const MARK = "__progmune_auth_machinery__";
const MAX_DEPTH = 3;

interface Fn {
  name: string;
  file?: string;
  calls: string[];
}

function loadIR(p: string): Fn[] {
  const d = JSON.parse(fs.readFileSync(p, "utf8"));
  return (Array.isArray(d) ? d : d.functions || []).map((f: any) => ({
    name: f.name,
    file: f.file,
    calls: f.calls || [],
  }));
}

function main() {
  const corpus = process.argv[2] || "docmost";
  if (corpus === "docmost") {
    const ir = loadIR("benchmarks/ts-apps/docmost/apps/server/ir.json");
    const guarded = computeGuardPropagatedSet(ir);
    console.log(`docmost IR: ${ir.length} 函数，直接守卫 ${[...guarded].filter(n => ir.find(f=>f.name===n)?.calls.includes(MARK)).length}，传播后已守卫 ${guarded.size}`);
    // 读告警流
    const scan = JSON.parse(fs.readFileSync("blind-benchmark/reports/heldout/trust-docmost-3.7.63.json", "utf8"));
    const alerts = scan.overall.safeguardAlerts.topRanked.map((t: any) => t.alert);
    const auth = alerts.filter((a: any) => String(a.rule).startsWith("Authorization") || a.rule === "Payment Refund (No Authorization)");
    const byName = new Map<string, Fn[]>();
    for (const f of ir) { if (!byName.has(f.name)) byName.set(f.name, []); byName.get(f.name)!.push(f); }
    let supp = 0;
    const suppressed: Array<{ fn: string; rule: string }> = [];
    for (const a of auth) {
      const name = a.function;
      const fInfo = byName.get(name)?.[0];
      const directlyMarked = fInfo ? (fInfo.calls || []).includes(MARK) : true;
      if (guarded.has(name) && !directlyMarked) {
        supp++;
        suppressed.push({ fn: name, rule: a.rule });
      }
    }
    console.log(`授权族告警 ${auth.length} 条 → 传播豁免可压 ${supp} 条 (${(100*supp/auth.length).toFixed(1)}%)`);
    const byRule = new Map<string, number>();
    for (const s of suppressed) byRule.set(s.rule, (byRule.get(s.rule) || 0) + 1);
    console.log("按规则：", [...byRule.entries()].map(([k, n]) => `${k}=${n}`).join("  "));
    // 反向检查：被豁免的函数里有没有「无调用方」的入口（R1 不豁免，但确认统计口径）
    const orphans = suppressed.filter((s) => {
      const f = byName.get(s.fn)?.[0];
      return !f;
    });
    console.log("告警函数不在 IR 中的条数（无法豁免）:", orphans.length);
    // 明细样本
    console.log("\n豁免样本（前 20）:");
    for (const s of suppressed.slice(0, 20)) console.log("  -", s.fn, "::", s.rule);
  } else if (corpus === "ts-blind") {
    const d = JSON.parse(fs.readFileSync("blind-benchmark/reports/batch-scan-results.json", "utf8"));
    let totalAuth = 0, supp = 0;
    const suppressed: Array<{ proj: string; fn: string; rule: string }> = [];
    for (const p of d.projects) {
      const fns: Fn[] = [];
      const authFns = new Map<string, string[]>();
      for (const pf of p.perFunction || []) {
        const f = typeof pf === "string" ? JSON.parse(pf) : pf;
        fns.push({ name: f.name, calls: f.calls || [] });
        const svs = f.safeguardViolations || [];
        const auths = svs.map((s: any) => (typeof s === "string" ? s : s.rule)).filter((r: string) => String(r).startsWith("Authorization"));
        if (auths.length) authFns.set(f.name, auths);
      }
      const guarded = computeGuardPropagatedSet(fns);
      const fnsByName = new Map(fns.map((f) => [f.name, f]));
      for (const [name, rules] of authFns) {
        totalAuth += rules.length;
        const directlyMarked = (fnsByName.get(name)?.calls || []).includes(MARK);
        if (guarded.has(name) && !directlyMarked) {
          supp += rules.length;
          for (const r of rules) suppressed.push({ proj: p.project, fn: name, rule: r });
        }
      }
    }
    console.log(`TS 盲测授权族 flag ${totalAuth} → 可压 ${supp}`);
    const byRule = new Map<string, number>();
    for (const s of suppressed) byRule.set(s.rule, (byRule.get(s.rule) || 0) + 1);
    console.log("按规则：", [...byRule.entries()].map(([k, n]) => `${k}=${n}`).join("  "));
    const byProj = new Map<string, number>();
    for (const s of suppressed) byProj.set(s.proj, (byProj.get(s.proj) || 0) + 1);
    console.log("按项目（前 10）：", [...byProj.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k,n])=>`${k}=${n}`).join("  "));
    console.log("明细（全部）:");
    for (const s of suppressed) console.log(`  [${s.proj}] ${s.fn} :: ${s.rule}`);
  }
}

main();
