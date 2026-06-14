"use strict";
/**
 * Rule Miner — generates actionable protocol rules from failure patterns.
 *
 * Upgrades the passive diagnostic to an active rule generator:
 *   1. Analyses the failure corpus for recurring SVL-4 violations
 *   2. Generates FunctionProtocol entries from fix paths
 *   3. Can merge rules into protocols.json (dry-run by default)
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
exports.mineRules = mineRules;
exports.toProtocolEntries = toProtocolEntries;
exports.applyMinedRules = applyMinedRules;
exports.mineAntibodiesV2 = mineAntibodiesV2;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const failure_corpus_1 = require("./failure-corpus");
/**
 * Mine protocol rules from failure patterns.
 *
 * Analyses SVL-4 protocol violations to infer state transitions
 * that should be encoded as permanent protocol rules.
 */
function mineRules() {
    const genome = (0, failure_corpus_1.getFailureGenome)();
    const patterns = (0, failure_corpus_1.getTopFailurePatterns)(10);
    const mined = [];
    // Strategy 1: Convert common fix paths into protocol rules
    const ssgFixes = genome.commonFixPaths.filter(f => f.violation === "SVL-4");
    for (const fix of ssgFixes) {
        if (fix.fixPath.length < 2)
            continue;
        for (let i = 0; i < fix.fixPath.length - 1; i++) {
            const currentFn = fix.fixPath[i];
            const nextFn = fix.fixPath[i + 1];
            mined.push({
                function: currentFn,
                pre_states: [],
                post_states: [`READY_FOR_${nextFn.toUpperCase()}`],
                namespace: "_global",
                reason: `Fix path ${fix.fixPath.join(" → ")} observed ${fix.count} times`,
                confidence: fix.count,
            });
            mined.push({
                function: nextFn,
                pre_states: [`READY_FOR_${nextFn.toUpperCase()}`],
                post_states: ["COMPLETED"],
                namespace: "_global",
                reason: `Fix path continuation: ${currentFn} → ${nextFn}`,
                confidence: fix.count,
            });
        }
    }
    // Strategy 2: Pattern-based rules from top violations
    const PATTERN_RULES = {
        symbol_existence: { pre: [], post: ["IR_VALIDATED"], desc: "只使用 IR 中已导出的函数，禁止编造函数名" },
        type_mismatch: { pre: [], post: ["TYPE_CHECKED"], desc: "检查参数类型与 IR 签名一致后再调用" },
        dataflow: { pre: [], post: ["DATAFLOW_VALID"], desc: "变量必须先声明再使用，避免循环引用" },
        protocol: { pre: ["INIT"], post: ["PROTOCOL_COMPLIANT"], desc: "严格遵循 SSG 协议状态顺序调用函数" },
        missing_import: { pre: [], post: ["IMPORT_RESOLVED"], desc: "只从已导出的模块导入符号" },
        params_undefined: { pre: [], post: ["PARAMS_SAFE"], desc: "调用 .map/.filter 前检查对象是否为数组，使用 (obj || [])" },
    };
    for (const p of patterns) {
        // Extract constraint type from pattern (e.g. "SVL-1:symbol_existence" → "symbol_existence")
        const constraintMatch = p.pattern.match(/SVL-\d:(.+)/);
        if (!constraintMatch)
            continue;
        const constraintType = constraintMatch[1];
        const rule = PATTERN_RULES[constraintType];
        if (rule) {
            mined.push({
                function: constraintType,
                pre_states: rule.pre,
                post_states: rule.post,
                namespace: "mined",
                reason: `Pattern "${constraintType}" occurred ${p.count} times → ${rule.desc}`,
                confidence: p.count,
            });
        }
        else {
            // Generic fallback for unknown patterns
            mined.push({
                function: constraintType,
                pre_states: ["INIT"],
                post_states: ["VALIDATED"],
                namespace: "mined",
                reason: `Unknown pattern "${constraintType}" occurred ${p.count} times`,
                confidence: p.count,
            });
        }
    }
    // Deduplicate by function name (keep highest confidence)
    const seen = new Map();
    for (const rule of mined) {
        const key = `${rule.function}:${rule.namespace}`;
        if (!seen.has(key) || seen.get(key).confidence < rule.confidence) {
            seen.set(key, rule);
        }
    }
    return [...seen.values()].sort((a, b) => b.confidence - a.confidence);
}
/**
 * Convert mined rules to FunctionProtocol format compatible with protocols.json.
 */
function toProtocolEntries(rules) {
    const entries = {};
    for (const r of rules) {
        entries[r.function] = {
            pre_states: r.pre_states,
            post_states: r.post_states,
            ...(r.invalidate && r.invalidate.length > 0 ? { invalidate: r.invalidate } : {}),
            ...(r.namespace !== "_global" ? { namespace: r.namespace } : {}),
            _mined: { reason: r.reason, confidence: r.confidence },
        };
    }
    return entries;
}
/**
 * Merge mined rules into protocols.json.
 * Dry-run by default — set apply=true to write.
 */
function applyMinedRules(apply = false) {
    const mined = mineRules();
    const protocolsPath = path.resolve(__dirname, "..", "protocols.json");
    let existing = {};
    if (fs.existsSync(protocolsPath)) {
        existing = JSON.parse(fs.readFileSync(protocolsPath, "utf-8"));
    }
    const newEntries = toProtocolEntries(mined);
    let merged = 0;
    let skipped = 0;
    for (const [fn, rule] of Object.entries(newEntries)) {
        if (existing[fn]) {
            skipped++;
            continue; // Don't overwrite existing rules
        }
        existing[fn] = rule;
        merged++;
    }
    if (apply && merged > 0) {
        // Backup original
        const backup = protocolsPath + ".bak";
        if (fs.existsSync(protocolsPath)) {
            fs.copyFileSync(protocolsPath, backup);
        }
        fs.writeFileSync(protocolsPath, JSON.stringify(existing, null, 2));
        console.error(`[规则挖掘] 已将 ${merged} 条规则写入 ${protocolsPath}（备份: ${backup}）`);
    }
    return { rules: mined, merged, skipped, dryRun: !apply };
}
/**
 * Mine antibody candidates from Schema v2 failure records.
 * Returns patterns that recurred >= minCount times.
 */
function mineAntibodiesV2(minCount = 3) {
    const all = (0, failure_corpus_1.loadTrajectories)().filter(t => t.result === "violation");
    if (all.length === 0)
        return [];
    const groups = {};
    for (const t of all) {
        const key = `${t.violation?.type || "other"}|${t.protocol}`;
        if (!groups[key])
            groups[key] = [];
        groups[key].push(t);
    }
    const candidates = [];
    for (const [key, records] of Object.entries(groups)) {
        if (records.length < minCount)
            continue;
        const [violationType, protocol] = key.split("|");
        const avgDepth = Math.round(records.reduce((s, t) => s + t.context.nestingDepth, 0) / records.length);
        const fixPaths = [...new Set(records.flatMap(t => t.violation?.fixPath || []))];
        const avgSuccess = records.length > 0
            ? records.reduce((s, t) => s + t.successRate, 0) / records.length
            : 0;
        const timestamps = records.map(f => f.timestamp).sort();
        candidates.push({
            id: `ab2_${violationType}_${protocol}_${Date.now()}`,
            violationType: violationType,
            protocol,
            contextPattern: { nestingDepth: avgDepth },
            fixPath: fixPaths.slice(0, 5),
            promoteToStatic: ["resource_leak", "protocol_violation", "illegal_state_transition"].includes(violationType),
            occurrenceCount: records.length,
            avgSuccessRate: avgSuccess,
            firstSeen: timestamps[0] || "N/A",
            lastSeen: timestamps[timestamps.length - 1] || "N/A",
            minedAt: new Date().toISOString(),
        });
    }
    return candidates.sort((a, b) => b.occurrenceCount - a.occurrenceCount);
}
/** CLI entry point: print mined rules without applying. */
if (require.main === module) {
    const result = applyMinedRules(false);
    console.log(`\n挖掘到 ${result.rules.length} 条候选规则（dry-run）:`);
    for (const r of result.rules) {
        console.log(`  ${r.function}: [${r.pre_states.join(",")}] → [${r.post_states.join(",")}] (置信度: ${r.confidence})`);
        console.log(`    原因: ${r.reason}`);
    }
    if (result.rules.length > 0) {
        console.log(`\n应用规则: node -e "require('./dist/rule-miner').applyMinedRules(true)"`);
    }
}
