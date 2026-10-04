/**
 * nestjs-pipe-probe.ts — §52 NestJS 注册事件探针（只看不改）
 *
 * 用途：在真实项目上回答三件事 ——
 *   1. 发现了哪些 app-level provider 注册事件（APP_PIPE / APP_GUARD），从哪来
 *   2. 每条 NO_VALIDATION 违规，它的路由入参是不是「已校验 DTO」
 *   3. 因此：本次修复豁免的是哪些、豁免得对不对（不是无差别压制）
 *
 * 依赖落地实现（dist），不重写 dnc（R59）。
 *
 * 用法：
 *   NODE_OPTIONS="--max-old-space-size=1536" npx tsx blind-benchmark/nestjs-pipe-probe.ts \
 *     immich=benchmarks/ts-apps/immich/server \
 *     docmost=benchmarks/ts-apps/docmost/apps/server
 */
import * as fs from "fs";
import * as path from "path";

interface Args { [name: string]: string }

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (const a of argv.slice(2)) {
    const idx = a.indexOf("=");
    if (idx <= 0) continue;
    out[a.slice(0, idx)] = a.slice(idx + 1);
  }
  return out;
}

async function main() {
  const targets = parseArgs(process.argv);
  const entries = Object.entries(targets);
  if (entries.length === 0) {
    console.error("用法: nestjs-pipe-probe.ts <name>=<dir> [<name>=<dir> ...]");
    process.exit(1);
  }

  const { analyzeNestJSProject } = require("../dist/frameworks/nestjs-detector.js");
  const report: any = { generated_at: new Date().toISOString(), projects: {} };

  for (const [name, dir] of entries) {
    const t0 = Date.now();
    const prefix = path.resolve(dir) + path.sep;
    let analysis: any;
    try {
      analysis = analyzeNestJSProject(dir);
    } catch (err: any) {
      console.error(`[${name}] 分析失败: ${err?.message}`);
      continue;
    }
    const ms = Date.now() - t0;

    const regs = analysis.registrations || [];
    const byToken: Record<string, number> = {};
    for (const r of regs) byToken[r.token] = (byToken[r.token] || 0) + 1;

    const counts: Record<string, number> = {};
    for (const i of analysis.issues) counts[i.type] = (counts[i.type] || 0) + 1;

    report.projects[name] = {
      dir,
      ms,
      controllers: analysis.controllers.length,
      routes: analysis.routes.length,
      globalValidationPipes: analysis.globalValidationPipes || [],
      globalAuthGuards: analysis.globalAuthGuards || [],
      registrations: regs.map((r: any) => ({
        token: r.token,
        impl: r.impl,
        source: r.source,
        via: r.via,
        file: String(r.file).replace(prefix, ""),
        line: r.line,
      })),
      registrationCounts: byToken,
      issueCounts: counts,
      issues: analysis.issues.map((i: any) => ({
        type: i.type, severity: i.severity, route: i.route, controller: i.controller,
      })),
      routes_detail: analysis.routes.map((r: any) => ({
        route: `${r.method} ${r.path}`,
        controller: r.controller,
        handler: r.handler,
        hasAuthGuard: r.hasAuthGuard,
        hasValidationPipe: r.hasValidationPipe,
        hasValidatedDto: r.hasValidatedDto,
        hasStructuredInput: r.hasStructuredInput,
        guards: r.guards,
        pipes: r.pipes,
      })),
    };

    console.log(`\n=== ${name} (${dir}) ${ms}ms ===`);
    console.log(`controllers=${analysis.controllers.length} routes=${analysis.routes.length}`);
    console.log(`registrations: ${JSON.stringify(byToken)}`);
    console.log(`globalValidationPipes: ${JSON.stringify(analysis.globalValidationPipes)}`);
    console.log(`globalAuthGuards: ${JSON.stringify(analysis.globalAuthGuards)}`);
    console.log(`issues: ${JSON.stringify(counts)}`);
    for (const r of regs.filter((x: any) => x.token === "APP_PIPE" || x.token === "APP_GUARD")) {
      console.log(`  [${r.token}] ${r.impl ?? "?"}  source=${r.source} via=${r.via.join("<") || "-"}  ${String(r.file).replace(dir, "")}:${r.line}`);
    }
  }

  const outPath = process.env.PROBE_OUT || "blind-benchmark/reports/nestjs-pipe-probe.json";
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\n→ ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
