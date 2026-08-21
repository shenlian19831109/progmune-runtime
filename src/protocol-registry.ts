/**
 * Phase 6C: Single Source of Protocol Truth
 *
 * ALL components read namespaceInitialStates, rules, ruleHash, and version
 * from here. No component may hardcode default states or read protocols.json directly.
 *
 * Usage:
 *   import { getProtocolConfig } from "./protocol-registry";
 *   const { nsInit, rules, ruleHash, version } = getProtocolConfig();
 */

import * as fs from "fs";
import * as path from "path";
import type { FunctionProtocol, StateAnnotation } from "./ssg-validator";
import { parseProtocolsFromJSON, hashRules } from "./ssg-validator";

export interface ProtocolConfig {
  /** Per-namespace initial state. NEVER hardcode "_global" or "INIT". */
  nsInit: Map<string, string>;
  /** All protocol rules from protocols.json + IR @protocol annotations. */
  rules: FunctionProtocol[];
  /** SHA256 hash of the rule set — changes when rules change. */
  ruleHash: string;
  /** Protocol schema version. */
  version: string;
}

// ── Singleton cache ──

let cached: ProtocolConfig | null = null;

/** Invalidate the cache (call after protocols.json changes). */
/** Invalidate cached protocol configuration for reload. */
export function invalidateProtocolCache(): void {
  cached = null;
}

/** Get the authoritative protocol configuration.
 *  Cached after first call; call invalidateProtocolCache() to force reload. */
/** Get the authoritative protocol configuration from the single source of truth. */
/** @requires PROJECT_CONFIG @produces PROTOCOL_CONFIG */
export function getProtocolConfig(): ProtocolConfig {
  if (cached) return cached;

  const nsInit = new Map<string, string>();
  let rules: FunctionProtocol[] = [];
  let version = "1.0";

  const protoPath = path.resolve(
    process.env.PROGMUNE_PROJECT_DIR || process.cwd(),
    "protocols.json"
  );

  // 解析顺序与 loadIR 一致：显式目录 → CWD → 包目录回退。
  // 修复：在无 protocols.json 的项目目录里运行时（如 agent CLI chdir 到
  // demo-project），此前 nsInit 退化为仅 _global —— session 只记录 1 个
  // 命名空间，而 check 在仓库根跑用全量 27 个 ns 重建 → before-consistency
  // 全量误报（1308/1308）。包目录回退保证任何 cwd 下世界一致。
  const candidates = [protoPath];
  try {
    candidates.push(path.resolve(__dirname, "../protocols.json"));
  } catch { /* __dirname 不可用时跳过 */ }

  let loaded = false;
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const proto = JSON.parse(fs.readFileSync(p, "utf-8"));
      version = proto.$schema || proto.version || "1.0";

      // Load namespace initial states
      nsInit.set("_global", "UNAUTHENTICATED");
      if (proto.namespaceInitialStates) {
        for (const [ns, state] of Object.entries(proto.namespaceInitialStates)) {
          nsInit.set(ns, state as string);
        }
      }

      // Parse rules
      rules = parseProtocolsFromJSON(proto);
      loaded = true;
      break;
    } catch { /* 下一个候选 */ }
  }

  if (!loaded) {
    // Fallback: minimal defaults (no protocols.json anywhere)
    nsInit.set("_global", "UNAUTHENTICATED");
  }

  // Compute rule hash
  const ruleMap = new Map<string, StateAnnotation>();
  for (const r of rules) {
    ruleMap.set(r.function, r.protocol);
  }
  const ruleHash = hashRules(ruleMap);

  cached = { nsInit, rules, ruleHash, version };
  return cached;
}

// ── Convenience re-exports ──

/** Get namespace initial states only (most common need). */
/** Get namespace initial states from protocol configuration. */
/** @requires PROJECT_CONFIG @produces NAMESPACE_STATES */
export function getNsInit(): Map<string, string> {
  return new Map(getProtocolConfig().nsInit);
}

/** Get current rule hash without loading full config. */
/** Get the current rule set hash. */
/** @requires PROTOCOL_CONFIG @produces RULE_HASH */
export function getRuleHash(): string {
  return getProtocolConfig().ruleHash;
}
