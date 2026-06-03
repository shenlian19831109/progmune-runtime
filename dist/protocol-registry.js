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
import { parseProtocolsFromJSON, hashRules } from "./ssg-validator";
// ── Singleton cache ──
let cached = null;
/** Invalidate the cache (call after protocols.json changes). */
/** Invalidate cached protocol configuration for reload. */
export function invalidateProtocolCache() {
    cached = null;
}
/** Get the authoritative protocol configuration.
 *  Cached after first call; call invalidateProtocolCache() to force reload. */
/** Get the authoritative protocol configuration from the single source of truth. */
/** @requires PROJECT_CONFIG @produces PROTOCOL_CONFIG */
export function getProtocolConfig() {
    if (cached)
        return cached;
    const nsInit = new Map();
    let rules = [];
    let version = "1.0";
    const protoPath = path.resolve(process.env.PROGMUNE_PROJECT_DIR || process.cwd(), "protocols.json");
    if (fs.existsSync(protoPath)) {
        try {
            const proto = JSON.parse(fs.readFileSync(protoPath, "utf-8"));
            version = proto.$schema || proto.version || "1.0";
            // Load namespace initial states
            nsInit.set("_global", "UNAUTHENTICATED");
            if (proto.namespaceInitialStates) {
                for (const [ns, state] of Object.entries(proto.namespaceInitialStates)) {
                    nsInit.set(ns, state);
                }
            }
            // Parse rules
            rules = parseProtocolsFromJSON(proto);
        }
        catch { /* protocol load — optional */ }
    }
    else {
        // Fallback: minimal defaults (no protocols.json found)
        nsInit.set("_global", "UNAUTHENTICATED");
    }
    // Compute rule hash
    const ruleMap = new Map();
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
export function getNsInit() {
    return new Map(getProtocolConfig().nsInit);
}
/** Get current rule hash without loading full config. */
/** Get the current rule set hash. */
/** @requires PROTOCOL_CONFIG @produces RULE_HASH */
export function getRuleHash() {
    return getProtocolConfig().ruleHash;
}
