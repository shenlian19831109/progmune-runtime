"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.invalidateProtocolCache = invalidateProtocolCache;
exports.getProtocolConfig = getProtocolConfig;
exports.getNsInit = getNsInit;
exports.getRuleHash = getRuleHash;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const ssg_validator_1 = require("./ssg-validator");
// ── Singleton cache ──
let cached = null;
/** Invalidate the cache (call after protocols.json changes). */
/** Invalidate cached protocol configuration for reload. */
function invalidateProtocolCache() {
    cached = null;
}
/** Get the authoritative protocol configuration.
 *  Cached after first call; call invalidateProtocolCache() to force reload. */
/** Get the authoritative protocol configuration from the single source of truth. */
/** @requires PROJECT_CONFIG @produces PROTOCOL_CONFIG */
function getProtocolConfig() {
    if (cached)
        return cached;
    const nsInit = new Map();
    let rules = [];
    let version = "1.0";
    const protoPath = path.resolve(process.env.PROGMUNE_PROJECT_DIR || process.cwd(), "protocols.json");
    // 解析顺序与 loadIR 一致：显式目录 → CWD → 包目录回退。
    // 修复：在无 protocols.json 的项目目录里运行时（如 agent CLI chdir 到
    // demo-project），此前 nsInit 退化为仅 _global —— session 只记录 1 个
    // 命名空间，而 check 在仓库根跑用全量 27 个 ns 重建 → before-consistency
    // 全量误报（1308/1308）。包目录回退保证任何 cwd 下世界一致。
    const candidates = [protoPath];
    try {
        candidates.push(path.resolve(__dirname, "../protocols.json"));
    }
    catch { /* __dirname 不可用时跳过 */ }
    let loaded = false;
    for (const p of candidates) {
        if (!fs.existsSync(p))
            continue;
        try {
            const proto = JSON.parse(fs.readFileSync(p, "utf-8"));
            version = proto.$schema || proto.version || "1.0";
            // Load namespace initial states
            nsInit.set("_global", "UNAUTHENTICATED");
            if (proto.namespaceInitialStates) {
                for (const [ns, state] of Object.entries(proto.namespaceInitialStates)) {
                    nsInit.set(ns, state);
                }
            }
            // Parse rules
            rules = (0, ssg_validator_1.parseProtocolsFromJSON)(proto);
            loaded = true;
            break;
        }
        catch { /* 下一个候选 */ }
    }
    if (!loaded) {
        // Fallback: minimal defaults (no protocols.json anywhere)
        nsInit.set("_global", "UNAUTHENTICATED");
    }
    // Compute rule hash
    const ruleMap = new Map();
    for (const r of rules) {
        ruleMap.set(r.function, r.protocol);
    }
    const ruleHash = (0, ssg_validator_1.hashRules)(ruleMap);
    cached = { nsInit, rules, ruleHash, version };
    return cached;
}
// ── Convenience re-exports ──
/** Get namespace initial states only (most common need). */
/** Get namespace initial states from protocol configuration. */
/** @requires PROJECT_CONFIG @produces NAMESPACE_STATES */
function getNsInit() {
    return new Map(getProtocolConfig().nsInit);
}
/** Get current rule hash without loading full config. */
/** Get the current rule set hash. */
/** @requires PROTOCOL_CONFIG @produces RULE_HASH */
function getRuleHash() {
    return getProtocolConfig().ruleHash;
}
