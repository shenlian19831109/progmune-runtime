/**
 * protocol-rules-liveness.test.ts — 协议规则活性守卫（2026-09-06）
 *
 * Kimi 源码审计发现：SSG 验证器按命名空间隔离状态（stateMap 以
 * namespace 为键），而 protocols.json 中多条规则的 pre_states 引用
 * 其他命名空间建立的状态（如 session_fixation 的规则 pre SESSION_ACTIVE，
 * SESSION_ACTIVE 由 auth 的 create_session 建立）——规则在本命名空间
 * 永远无法满足前置，实际永不触发（G5 同族：2026-08-28 data_integrity
 * 的 check_resource_ownership pre AUTHENTICATED 已发现一次个案）。
 *
 * 本测试把该现象固化为硬性校验：每条规则的 pre_states 必须能在其
 * 命名空间内到达（初始状态 + 本命名空间规则的 post_states 闭包）。
 * 例外（printlab 业务链跨命名空间依赖）显式列入 KNOWN_CROSS_NS，
 * 待跨命名空间状态引用特性实现后移除。
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

interface RuleDef {
  namespace?: string;
  pre_states?: string[];
  post_states?: string[];
}

interface ProtocolsFile {
  rules: Record<string, RuleDef>;
  namespaceInitialStates?: Record<string, string>;
}

function loadProtocols(): ProtocolsFile {
  const p = path.join(__dirname, "..", "..", "protocols.json");
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

/** 命名空间内可到达状态：初始状态 + post_states 闭包（同验证器语义） */
function reachableStates(
  ns: string,
  rules: Record<string, RuleDef>,
  nsInit: Record<string, string>,
): Set<string> {
  const states = new Set<string>([nsInit[ns] ?? "INIT"]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of Object.values(rules)) {
      if ((r.namespace ?? "_global") !== ns) continue;
      const pre = new Set(r.pre_states ?? []);
      if (![...pre].every((s) => states.has(s))) continue;
      for (const p of r.post_states ?? []) {
        if (!states.has(p)) {
          states.add(p);
          changed = true;
        }
      }
    }
  }
  return states;
}

describe("protocol rules liveness（跨命名空间死规则守卫）", () => {
  it("每条规则的 pre_states 在其命名空间内可达（跨命名空间引用为显式例外）", () => {
    const { rules, namespaceInitialStates } = loadProtocols();
    const nsInit = namespaceInitialStates ?? {};

    // 文档化例外：printlab 业务链（printlab_order ↔ printlab_print 跨
    // 命名空间依赖：queue_order → start_print、upload_stl pre AUTHENTICATED
    // 等）——待跨命名空间状态引用特性后移除
    const KNOWN_CROSS_NS = new Set([
      "upload_stl", "slice_model", "generate_gcode", "estimate_cost",
      "queue_order", "start_print", "complete_print", "ship_order",
      "deliver_order", "fail_print",
    ]);

    const dead: string[] = [];
    for (const [name, r] of Object.entries(rules)) {
      const ns = r.namespace ?? "_global";
      const reach = reachableStates(ns, rules, nsInit);
      for (const s of r.pre_states ?? []) {
        if (!reach.has(s)) {
          dead.push(`${name} (ns=${ns}, pre=${s} 不可达)`);
        }
      }
    }
    expect(
      dead.filter((d) => !KNOWN_CROSS_NS.has(d.split(" ")[0])),
    ).toEqual([]);
    // 例外清单必须与实际死规则一致（防止例外清单腐化）
    expect(dead.map((d) => d.split(" ")[0]).sort())
      .toEqual([...KNOWN_CROSS_NS].sort());
  });
});
