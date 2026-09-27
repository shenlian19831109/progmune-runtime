"use strict";
/**
 * SSG Bridge — connects the SSG state machine (protocols.json) to the
 * trust engine's semantic validation pipeline.
 *
 * The bridge solves the abstraction gap: protocol rules use abstract function
 * names (verify_password, begin_tx, open_file), while real code uses concrete
 * library APIs (bcrypt.compare, db.query, fs.openSync).
 *
 * Strategy (multi-pass, best-effort):
 *   1. Direct match — normalized call name == rule name
 *   2. Substring match — call name contains rule name or vice versa
 *   3. Domain-guided — semantic domain maps to namespace, keywords infer rule
 *
 * Architecture:
 *   SemanticStep[] → inferRuleMatches() → SSG validateTransition() chain
 *     → SSGViolation[] (with BFS fix paths from findFixPathStatic)
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
exports.normalizeName = normalizeName;
exports.validateSequenceWithSSG = validateSequenceWithSSG;
exports.ssgViolationsToTrustViolations = ssgViolationsToTrustViolations;
exports.loadProjectAliases = loadProjectAliases;
exports.loadProtocolRules = loadProtocolRules;
exports.summarizeSSGCoverage = summarizeSSGCoverage;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const ssg_validator_1 = require("../ssg-validator");
// ═══════════════════════════════════════════════════════════════
// Domain → Namespace Mapping
// ═══════════════════════════════════════════════════════════════
/**
 * Maps semantic protocol domains to SSG state machine namespaces.
 * Multiple domains can map to the same namespace (e.g., tls_config,
 * tls_handshake, tls_cert all map to "tls").
 */
const DOMAIN_TO_NAMESPACE = {
    // TLS/SSL
    tls_config: "tls",
    tls_handshake: "tls",
    tls_cert: "tls",
    tls_session: "tls",
    tls_alpn: "tls",
    // Auth
    auth_cred: "auth",
    auth_mech: "auth",
    auth_hash: "auth",
    auth_spn: "auth",
    auth_gssapi: "auth",
    // Connection management → resource lifecycle
    conn_mgmt: "resource",
    conn_poll: "resource",
    // HTTP
    http_ops: "tls", // HTTP server → TLS namespace
    http2_ops: "tls",
    // Protocol operations → stateless (no state machine, always pass)
    ldap_ops: "stateless",
    ftp_ops: "stateless",
    smtp_ops: "stateless",
    imap_ops: "stateless",
    mqtt_ops: "stateless",
    smb_ops: "stateless",
    ssh_ops: "stateless",
    telnet_ops: "stateless",
    dns_ops: "stateless",
    // Memory → stateless (tracked by safeguard rules, not state machine)
    mem_alloc: "stateless",
    mem_free: "stateless",
    mem_util: "stateless",
    // Utilities → stateless
    str_util: "stateless",
    str_format: "stateless",
    buf_util: "stateless",
    net_util: "stateless",
    platform_util: "stateless",
    debug_trace: "stateless",
    error_handle: "stateless",
    util: "stateless",
};
/**
 * Domains that map to "auth" namespace with their position in the auth flow.
 * Used to infer which protocol rule a call matches based on domain + position.
 */
const AUTH_DOMAIN_FLOW = [
    "auth_hash", // password hashing/verification
    "auth_mech", // token generation, SASL negotiation
    "auth_cred", // credential retrieval
    "auth_spn", // Kerberos SPN
    "auth_gssapi", // GSSAPI wrap/unwrap
];
const NAMESPACE_RULE_HINTS = {
    auth: [
        { keyword: "hash_password", ruleName: "hash_password" },
        { keyword: "argon2.hash", ruleName: "hash_password" },
        { keyword: "scrypt.hash", ruleName: "hash_password" },
        { keyword: "verify_hash", ruleName: "verify_hash" },
        { keyword: "verify_password", ruleName: "verify_password" },
        { keyword: "generate_jwt", ruleName: "generate_jwt" },
        { keyword: "create_session", ruleName: "create_session" },
        { keyword: "revoke_token", ruleName: "revoke_token" },
        { keyword: "verify_token", ruleName: "verify_token" },
        { keyword: "validate_token", ruleName: "verify_token" },
        { keyword: "check_owner", ruleName: "check_owner" },
    ],
    tls: [
        { keyword: "load_tls_config", ruleName: "load_tls_config" },
        { keyword: "tls_config", ruleName: "load_tls_config" },
        { keyword: "ssl_config", ruleName: "load_tls_config" },
    ],
    resource: [
        { keyword: "open_file", ruleName: "open_file" },
        { keyword: "read_file", ruleName: "read_file" },
        { keyword: "write_file", ruleName: "write_file" },
        { keyword: "close_file", ruleName: "close_file" },
        { keyword: "connect_db", ruleName: "connect_db" },
        { keyword: "query_db", ruleName: "query_db" },
        { keyword: "disconnect_db", ruleName: "disconnect_db" },
        { keyword: "sanitize", ruleName: "sanitize" },
        { keyword: "validate_type", ruleName: "validate_type" },
        { keyword: "validate_range", ruleName: "validate_range" },
    ],
    payment: [
        { keyword: "initiate_payment", ruleName: "initiate_payment" },
        { keyword: "create_payment", ruleName: "initiate_payment" },
        { keyword: "stripe", ruleName: "initiate_payment" },
        { keyword: "webhook", ruleName: "receive_payment_callback" },
        { keyword: "confirm_payment", ruleName: "confirm_payment" },
        { keyword: "verify_signature", ruleName: "verify_payment_signature" },
        { keyword: "refund_payment", ruleName: "refund_payment" },
        { keyword: "cancel_payment", ruleName: "cancel_payment" },
    ],
    transaction: [
        { keyword: "begin_tx", ruleName: "begin_tx" },
        { keyword: "commit_tx", ruleName: "commit_tx" },
        { keyword: "rollback_tx", ruleName: "rollback_tx" },
        { keyword: "insert_record", ruleName: "insert_record" },
        { keyword: "update_record", ruleName: "update_record" },
        { keyword: "delete_record", ruleName: "delete_record" },
    ],
    file_upload: [
        { keyword: "multer", ruleName: "receive_upload" },
        { keyword: "validate_file", ruleName: "validate_file" },
        { keyword: "store_file", ruleName: "store_file" },
    ],
    session_mgmt: [
        { keyword: "create_user_session", ruleName: "create_user_session" },
        { keyword: "refresh_session", ruleName: "refresh_session" },
        { keyword: "rotate_session_token", ruleName: "rotate_session_token" },
        { keyword: "revoke_session", ruleName: "revoke_session" },
        { keyword: "timeout_session", ruleName: "timeout_session" },
        { keyword: "validate_session", ruleName: "validate_session" },
    ],
    registration: [
        { keyword: "register_user", ruleName: "register_user" },
        { keyword: "send_verification_code", ruleName: "send_verification_code" },
        { keyword: "send_verification", ruleName: "send_verification_code" },
        { keyword: "verify_code", ruleName: "verify_code" },
        { keyword: "activate_account", ruleName: "activate_account" },
    ],
    missing_validation: [
        { keyword: "validate", ruleName: "validate_request" },
        { keyword: "sanitize", ruleName: "validate_request" },
        { keyword: "safeParse", ruleName: "validate_request" },
        { keyword: "parseAsync", ruleName: "validate_request" },
        { keyword: "checkSchema", ruleName: "validate_request" },
        { keyword: "zod", ruleName: "validate_request" },
    ],
};
// ═══════════════════════════════════════════════════════════════
// Call → Rule Inference
// ═══════════════════════════════════════════════════════════════
/**
 * Normalize a function name for matching:
 *   "bcrypt.hashPassword" → "hash_password"
 *   "SSL_CTX_new" → "ssl_ctx_new"
 */
function normalizeName(name) {
    // Split on dots, take the last segment
    const segments = name.split(".");
    const last = segments[segments.length - 1];
    // CamelCase → snake_case
    const snake = last
        .replace(/([A-Z])/g, "_$1")
        .toLowerCase()
        .replace(/^_/, "")
        .replace(/__+/g, "_");
    return snake;
}
/**
 * Try to match a call (real API name + semantic domain) to a protocol rule name.
 * Returns the rule name if matched, or null if no match.
 *
 * Multi-strategy, in priority order:
 *   1. Exact normalized match against all rule names
 *   2. Substring match (call contains rule name or vice versa)
 *   3. Domain-guided keyword match
 */
function inferRuleName(apiName, domain, description, ruleNames, namespace, aliases, wildcardAliases, projectFunctions) {
    const normalized = normalizeName(apiName);
    const lowerApi = apiName.toLowerCase();
    const lowerDesc = description.toLowerCase();
    // Strategy 0a: Wildcard alias match — e.g., "db.*" matches "db.getUserByOpenId"
    // Wildcard aliases are stored with their prefix (without "*") as key, ruleName as value.
    // They're kept in a separate map: wildcardAliases: Map<prefix, ruleName>
    for (const [prefix, ruleName] of wildcardAliases) {
        if (lowerApi.startsWith(prefix))
            return ruleName;
    }
    // Strategy 0b: Alias exact match (highest priority after wildcard)
    // Try full API name, normalized form, and function-only form
    const aliasKeys = [lowerApi, normalized];
    const dotIdx = lowerApi.lastIndexOf(".");
    if (dotIdx >= 0) {
        aliasKeys.push(lowerApi.slice(dotIdx + 1));
    }
    for (const key of aliasKeys) {
        const ruleName = aliases.get(key);
        if (ruleName)
            return ruleName;
    }
    // 门控判定（P4.6.1 词段门控同款）：项目函数才能按规范化/词段形态命中——
    // 外部 API（如 Windows 的 ReadFile → snake_case 撞上 read_file）是纯噪声，
    // 其语义桥接走 alias 配置（Strategy 0b）或 domain 关键词（Strategy 3）。
    // 未提供 projectFunctions 时保持旧行为（向后兼容测试与无 IR 的调用方）。
    const isProjectFn = !projectFunctions
        || projectFunctions.has(apiName)
        || projectFunctions.has(lowerApi)
        || projectFunctions.has(normalized)
        || (dotIdx >= 0 && projectFunctions.has(lowerApi.slice(dotIdx + 1)));
    // Strategy 1: Exact match against rule names.
    // 原始名（含小写）精确匹配不限门控；规范化形态（CamelCase → snake_case）
    // 仅项目函数适用——真实 C 语料验证中 ReadFile/WriteFile/DeleteFile 经
    // normalized 撞上 read_file/write_file/delete_file 是 11/24 FP 的主导源，
    // 而注解桥接（ACLCheckAllPerm → acl_check_all_perm）全是项目函数，不受影响。
    // Java 限定键（Class.method）与限定调用（user.update）大小写不敏感精确
    // 匹配（变量名 user vs 类名 User）；带点调用不参与规范化/词段形态匹配——
    // 末段回退会重造名碰撞（article.update 撞 User.update 的裸键/词段）。
    const isDotted = dotIdx >= 0;
    for (const ruleName of ruleNames) {
        if (lowerApi === ruleName.toLowerCase()) {
            return ruleName;
        }
    }
    if (isProjectFn && !(projectFunctions && isDotted)) {
        for (const ruleName of ruleNames) {
            if (normalized === ruleName) {
                return ruleName;
            }
        }
    }
    for (const ruleName of ruleNames) {
        if (projectFunctions && !isProjectFn)
            continue;
        if (projectFunctions && isDotted)
            continue; // 带点调用只走限定精确匹配（+别名/域提示）
        const ruleWords = ruleName.split("_");
        // Rule must have at least 2 words for this strategy (single-word rules
        // are too prone to false positives via substring)
        if (ruleWords.length < 2)
            continue;
        // 2026-09-11（REALWORLD_AI_GENERATED_V2 / skyvern）：词段匹配加
        // 「首词@首位 + 末词@末位」边界收紧。此前仅要求规则词全部出现——
        // validate_local_file_path / _validate_file_stat / _session_create_data /
        // _revoke_refresh_token_at_google / ngx_read_file 等真实语料 FP 均破坏
        // 该边界；Python 盲测 S5 改名形态（verify_user_password /
        // create_active_session / open_user_file）全部满足边界，TP 不受影响。
        let callWords = normalized.split("_").filter((w) => w !== "");
        if (callWords.length === 0)
            callWords = normalized.split("_");
        // Rule words must appear in order — first rule word at word index 0,
        // last rule word at the final word index — not just anywhere in the set
        let pos = 0;
        const positions = [];
        let ordered = true;
        for (const rw of ruleWords) {
            let found = -1;
            for (let i = pos; i < callWords.length; i++) {
                if (callWords[i] === rw) {
                    found = i;
                    break;
                }
            }
            if (found === -1) {
                ordered = false;
                break;
            }
            positions.push(found);
            pos = found + 1;
        }
        if (ordered &&
            positions[0] === 0 &&
            positions[positions.length - 1] === callWords.length - 1) {
            return ruleName;
        }
    }
    // Strategy 3: Domain-guided keyword match
    const hints = NAMESPACE_RULE_HINTS[namespace];
    if (hints) {
        for (const hint of hints) {
            const kw = hint.keyword.toLowerCase();
            // Check call name, normalized name, and semantic description
            if (lowerApi.includes(kw) || normalized.includes(kw) || lowerDesc.includes(kw)) {
                return hint.ruleName;
            }
        }
    }
    return null;
}
// ═══════════════════════════════════════════════════════════════
// SSG Validation
// ═══════════════════════════════════════════════════════════════
/**
 * Validate a sequence of semantic steps against the SSG state machine.
 *
 * For each call, attempts to match it to a protocol rule. If matched,
 * validates the state transition. Tracks state per-namespace.
 *
 * @param steps — semantic steps from the mapper
 * @param rules — Map<functionName, StateAnnotation> from protocols.json
 * @param namespaceInitialStates — initial states per namespace
 * @param file — source file path (for violation reporting)
 * @returns SSG validation result with violations and trace
 */
function validateSequenceWithSSG(steps, rules, namespaceInitialStates, file, aliasIndex, wildcardAliases, 
/** 项目函数名集合（含裸名/全名/小写变体由调用方构造）——提供后词段匹配只对项目函数适用 */
projectFunctions, 
/** 入口函数的直接调用集合——endState 检查的资源获取溯源：经内联 helper
 *  获取的资源不归因给入口（nginx 回调式生命周期：open 在 helper 链内、
 *  close 在回调里，直接调用序列看不到），提供后仅在获取调用 ∈ 直接调用
 *  时报告 endState。未提供时保持旧行为。 */
entryDirectCalls) {
    const allRuleNames = Array.from(rules.keys());
    const aliases = aliasIndex || new Map();
    const wildcards = wildcardAliases || new Map();
    // Build namespace→initialState map
    const nsInitMap = new Map();
    for (const [ns, state] of Object.entries(namespaceInitialStates)) {
        nsInitMap.set(ns, state);
    }
    if (!nsInitMap.has("_global"))
        nsInitMap.set("_global", "INIT");
    if (!nsInitMap.has("stateless"))
        nsInitMap.set("stateless", "IDLE");
    // Per-namespace validation contexts
    const contexts = new Map(); // namespace → ValidationContext
    const ensureContext = (ns) => {
        if (!contexts.has(ns)) {
            const initState = nsInitMap.get(ns) || "IDLE";
            contexts.set(ns, {
                ledger: [],
                currentState: { [ns]: [initState] },
            });
        }
        return contexts.get(ns);
    };
    const trace = [];
    const violations = [];
    let matchedCalls = 0;
    let validatedCalls = 0;
    let violatedCalls = 0;
    // Pre-compute rule hashes for integrity
    const ruleHash = (() => {
        try {
            return (0, ssg_validator_1.hashRules)(rules);
        }
        catch {
            return undefined;
        }
    })();
    // 本序列中"新获取"的资源状态（endState 检查只针对本序列获取、未释放的状态——
    // 继承自命名空间初始状态的不算泄漏，与 planner 语义一致）。
    // 记录获取调用名：endState 归因溯源（入口直接调用 vs 内联 helper 获取）。
    const acquiredStates = new Map(); // `${ns}::${state}` → 获取调用名
    const trackAcquiredStates = (before, after, acquiringCall) => {
        for (const ns of Object.keys(after)) {
            const prev = before?.[ns] || [];
            for (const s of after[ns]) {
                if (!prev.includes(s))
                    acquiredStates.set(`${ns}::${s}`, acquiringCall);
            }
        }
    };
    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const namespace = DOMAIN_TO_NAMESPACE[step.domain] || "stateless";
        // Try to match call to a protocol rule FIRST (before namespace check).
        // Even if the semantic domain maps to "stateless", an alias may still
        // map this call to a specific protocol rule with its own namespace.
        // Priority: wildcard alias → exact alias → name match → word match → keyword
        const ruleName = inferRuleName(step.api, step.domain, step.description, allRuleNames, namespace, aliases, wildcards, projectFunctions);
        // Use matched rule's namespace, falling back to domain-inferred namespace
        const effectiveNamespace = ruleName
            ? (rules.get(ruleName)?.namespace || namespace)
            : namespace;
        // Skip stateless — no state machine validation needed (unless alias matched)
        if (effectiveNamespace === "stateless" && !ruleName) {
            trace.push({
                call: step.api,
                namespace: effectiveNamespace,
                matchedRule: null,
                valid: true,
            });
            continue;
        }
        if (!ruleName) {
            trace.push({
                call: step.api,
                namespace,
                matchedRule: null,
                valid: true, // unmatched calls pass through
            });
            continue;
        }
        matchedCalls++;
        // Use the matched rule's actual namespace, not the domain-inferred one.
        const ruleNamespace = effectiveNamespace;
        // Validate transition
        try {
            const ctx = ensureContext(ruleNamespace);
            const result = (0, ssg_validator_1.validateTransition)(ctx, ruleName, i, rules, nsInitMap, ruleHash);
            validatedCalls++;
            if (result.valid) {
                // Advance state
                ctx.ledger.push(result.transition);
                ctx.currentState = result.transition.statesAfter;
                trackAcquiredStates(result.transition.statesBefore, result.transition.statesAfter, step.api);
            }
            else {
                violatedCalls++;
                const rejection = result.rejection;
                // Compute BFS fix path
                let fixPath = [];
                try {
                    fixPath = (0, ssg_validator_1.findFixPathStatic)(rules, ruleNamespace, rejection.currentState, rejection.requiredState);
                    // 修复路径渲染真实函数名：项目注解原语的 displayName 优先于通用规则名
                    fixPath = fixPath.map((n) => rules.get(n)?.displayName ?? n);
                }
                catch {
                    fixPath = rejection.missingFunctions || [];
                }
                violations.push({
                    callName: step.api,
                    namespace: ruleNamespace,
                    currentState: rejection.currentState,
                    requiredState: rejection.requiredState,
                    fixPath,
                    matchedRule: ruleName,
                    explanation: `SSG state violation: "${step.api}" (mapped to "${ruleName}") ` +
                        `requires states [${rejection.requiredState.join(", ")}] ` +
                        `but current ${ruleNamespace} state is [${rejection.currentState.join(", ")}]. ` +
                        (fixPath.length > 0
                            ? `Fix path: ${fixPath.join(" → ")}`
                            : `No fix path found — protocol gap.`),
                });
                // Still advance state on rejection (best-effort: apply transition anyway
                // so subsequent calls can be validated)
                ctx.ledger.push(result.transition);
                trackAcquiredStates(result.transition.statesBefore, result.transition.statesAfter, step.api);
            }
        }
        catch {
            // Validation threw — record as unmatched (graceful degradation)
            trace.push({
                call: step.api,
                namespace,
                matchedRule: ruleName,
                valid: false,
                rejection: {
                    blocked: ruleName,
                    currentState: [],
                    requiredState: [],
                    missingFunctions: [],
                    fixPath: [],
                    namespace,
                },
            });
        }
        trace.push({
            call: step.api,
            namespace,
            matchedRule: ruleName,
            valid: true,
        });
    }
    // ── End-of-sequence check: held resources must be released (resource leak).
    // 共享判定见 ssg-validator.findHeldResourceStates：仅资源生命周期命名空间 +
    // pre/invalidate 交集；只报本序列获取且最终仍持有的状态（对齐 planner）。
    for (const hs of (0, ssg_validator_1.findHeldResourceStates)(rules)) {
        const ctx = contexts.get(hs.namespace);
        if (!ctx)
            continue;
        const acquiringCall = acquiredStates.get(`${hs.namespace}::${hs.state}`);
        if (!acquiringCall)
            continue;
        // 资源获取溯源：经内联 helper 获取的状态不归因给入口（释放可能存在于
        // 兄弟 helper 或回调注册中——nginx 回调式生命周期是 12/24 FP 的主源）
        if (entryDirectCalls && !entryDirectCalls.has(acquiringCall))
            continue;
        const cur = ctx.currentState[hs.namespace] || [];
        if (!cur.includes(hs.state))
            continue;
        violatedCalls++;
        // 释放函数渲染真实名（项目注解原语的 displayName 优先）
        const releaseDisplay = rules.get(hs.releaseFn)?.displayName ?? hs.releaseFn;
        violations.push({
            callName: "(end-of-sequence)",
            namespace: hs.namespace,
            currentState: cur,
            requiredState: [],
            fixPath: [releaseDisplay],
            matchedRule: hs.releaseFn,
            endState: true,
            explanation: `SSG end-state violation: resource state [${hs.state}] ` +
                `acquired in this function is still held at end of sequence ` +
                `(namespace ${hs.namespace}, current [${cur.join(", ")}]) — ` +
                `missing release call: ${releaseDisplay}.`,
        });
        trace.push({
            call: "(end-of-sequence)",
            namespace: hs.namespace,
            matchedRule: hs.releaseFn,
            valid: false,
        });
    }
    return {
        passed: violations.length === 0,
        trace,
        violations,
        stats: {
            totalCalls: steps.length,
            matchedCalls,
            unmatchedCalls: steps.length - matchedCalls,
            validatedCalls,
            violatedCalls,
        },
    };
}
/**
 * Convert SSG violations to TrustViolation format for the trust engine.
 */
function ssgViolationsToTrustViolations(ssgResult, file, funcName) {
    return ssgResult.violations.map((v) => ({
        severity: "medium",
        rule_id: v.endState
            ? `SSG_${v.namespace.toUpperCase()}_END_STATE_VIOLATION`
            : `SSG_${v.namespace.toUpperCase()}_STATE_VIOLATION`,
        file,
        function: funcName,
        message: v.explanation,
        evidence: v.endState
            ? `End-of-sequence: held resource state [${v.currentState.join(", ")}] | ` +
                `Release call: ${v.fixPath.join(" → ") || "unknown"}`
            : `Call: ${v.callName} | Rule: ${v.matchedRule || "unknown"} | ` +
                `Required: [${v.requiredState.join(", ")}] | ` +
                `Current: [${v.currentState.join(", ")}]`,
        why: v.endState
            ? `Protocol state machine violation in namespace "${v.namespace}": ` +
                `a resource acquired in this function ([${v.currentState.join(", ")}]) ` +
                `is still held when the function ends — resource leak.`
            : `Protocol state machine violation in namespace "${v.namespace}": ` +
                `function "${v.callName}" cannot be called in current state ` +
                `[${v.currentState.join(", ")}]. Required pre-states: [${v.requiredState.join(", ")}].`,
        fix: v.endState
            ? `Append the release call at the end of the function: ${v.fixPath.join(" → ")}`
            : v.fixPath.length > 0
                ? `Insert before the violating call: ${v.fixPath.join(" → ")}`
                : `Review protocol documentation for namespace "${v.namespace}" to understand required state transitions.`,
        policy_ref: `protocol-safety.ssg.${v.namespace}`,
    }));
}
/**
 * Load protocol rules from protocols.json.
 * Returns { rules, namespaceInitialStates } or null if unavailable.
 */
/**
 * Load project-level aliases from .progmune_aliases.json.
 *
 * Format: { "aliases": { "createSessionToken": "create_user_session", ... } }
 *
 * Project aliases are supplemental — they never override built-in global aliases.
 * Each alias is validated: the target rule must exist in the rule set.
 *
 * @returns { aliases, warnings } or null if no config file exists
 */
function loadProjectAliases(projectPath, ruleNames) {
    try {
        const aliasPath = path.join(projectPath, ".progmune_aliases.json");
        if (!fs.existsSync(aliasPath))
            return null;
        const raw = JSON.parse(fs.readFileSync(aliasPath, "utf-8"));
        if (!raw.aliases || typeof raw.aliases !== "object") {
            return { aliases: {}, warnings: [".progmune_aliases.json: missing or invalid 'aliases' key"] };
        }
        const aliases = {};
        const warnings = [];
        for (const [callName, ruleName] of Object.entries(raw.aliases)) {
            if (typeof ruleName !== "string") {
                warnings.push(`.progmune_aliases.json: alias "${callName}" value must be a string, skipping`);
                continue;
            }
            const normalizedCall = callName.toLowerCase().trim();
            const normalizedRule = ruleName.trim();
            if (!normalizedCall || !normalizedRule)
                continue;
            // Validate: target rule must exist
            if (!ruleNames.has(normalizedRule)) {
                warnings.push(`.progmune_aliases.json: "${callName}" → "${ruleName}" — ` +
                    `rule "${ruleName}" not found in protocol rules, skipping`);
                continue;
            }
            aliases[normalizedCall] = normalizedRule;
        }
        return { aliases, warnings };
    }
    catch (e) {
        return { aliases: {}, warnings: [`Failed to load .progmune_aliases.json: ${e.message}`] };
    }
}
function loadProtocolRules(projectPath) {
    try {
        // Resolve protocols.json using multiple strategies:
        //   1. Project-local (if projectPath provided)
        //   2. Relative to cwd (works in vitest/dev)
        //   3. Relative to this source file (works with __dirname in CJS)
        const searchPaths = [];
        if (projectPath) {
            searchPaths.push(path.join(projectPath, "protocols.json"), path.join(projectPath, ".progmune_protocols.json"));
        }
        // cwd-based resolution (most reliable cross-environment)
        searchPaths.push(path.resolve(process.cwd(), "protocols.json"), path.resolve(process.cwd(), "..", "protocols.json"), path.resolve(process.cwd(), "progmune-runtime", "protocols.json"));
        // __dirname-based (works in CJS context)
        try {
            searchPaths.push(path.resolve(__dirname, "../../protocols.json"));
            searchPaths.push(path.resolve(__dirname, "../protocols.json"));
        }
        catch {
            // __dirname not available (ESM context)
        }
        let protoDef = null;
        for (const p of searchPaths) {
            try {
                if (fs.existsSync(p)) {
                    const parsed = JSON.parse(fs.readFileSync(p, "utf-8"));
                    // Only accept if it has the "rules" structure (some project-local
                    // .progmune_protocols.json files have a different format)
                    if (parsed.rules && typeof parsed.rules === "object") {
                        protoDef = parsed;
                        break;
                    }
                    // Otherwise continue searching — this file exists but isn't a rules definition
                }
            }
            catch {
                continue;
            }
        }
        if (!protoDef || !protoDef.rules)
            return null;
        const protocols = (0, ssg_validator_1.parseProtocolsFromJSON)(protoDef);
        const rules = new Map();
        const aliasIndex = new Map();
        const wildcardAliases = new Map();
        for (const p of protocols) {
            rules.set(p.function, p.protocol);
            // Build alias → ruleName reverse index
            if (p.protocol.aliases) {
                for (const alias of p.protocol.aliases) {
                    const normalized = alias.toLowerCase().trim();
                    if (!normalized)
                        continue;
                    // Wildcard aliases end with ".*" — match any function with that prefix
                    if (normalized.endsWith(".*")) {
                        const prefix = normalized.slice(0, -2); // remove ".*"
                        if (prefix && !wildcardAliases.has(prefix)) {
                            wildcardAliases.set(prefix, p.function);
                        }
                    }
                    else {
                        // First alias wins (no overwrite — prevents ambiguous mappings)
                        if (!aliasIndex.has(normalized)) {
                            aliasIndex.set(normalized, p.function);
                        }
                    }
                }
            }
        }
        const nsInit = {};
        if (protoDef.namespaceInitialStates) {
            Object.assign(nsInit, protoDef.namespaceInitialStates);
        }
        // Ensure essential namespaces have defaults
        if (!nsInit._global)
            nsInit._global = "INIT";
        if (!nsInit.stateless)
            nsInit.stateless = "IDLE";
        // ── Load shared C alias registry (c-aliases.json, confirmed entries only) ──
        // 注解驱动定位的孵化器燃料：库边界别名跨项目迁移——用户项目别名回写提案、
        // 人工确认（status=confirmed）后对全部项目生效。加载顺序在项目别名之前：
        // 项目本地映射优先于共享表（与「项目别名不覆盖全局」同哲学，first-wins）。
        try {
            const cRegistryPath = [
                projectPath ? path.join(projectPath, "c-aliases.json") : "",
                path.join(process.cwd(), "c-aliases.json"),
                path.join(__dirname, "..", "c-aliases.json"),
            ].find((p) => p && fs.existsSync(p));
            if (cRegistryPath) {
                const reg = JSON.parse(fs.readFileSync(cRegistryPath, "utf-8"));
                for (const entry of reg.entries || []) {
                    if (entry.status !== "confirmed")
                        continue;
                    const callName = String(entry.call).toLowerCase().trim();
                    const ruleName = String(entry.rule);
                    if (!callName || !rules.has(ruleName))
                        continue;
                    if (!aliasIndex.has(callName)) {
                        aliasIndex.set(callName, ruleName);
                    }
                }
            }
        }
        catch { /* best-effort — 共享表缺失或损坏不影响验证 */ }
        // ── Load project-level aliases (supplemental, never override global) ──
        let projectAliases;
        let aliasWarnings;
        if (projectPath) {
            const ruleNameSet = new Set(rules.keys());
            const pa = loadProjectAliases(projectPath, ruleNameSet);
            if (pa) {
                projectAliases = pa.aliases;
                aliasWarnings = pa.warnings;
                // Merge into exact-match alias index (project aliases DON'T override global)
                for (const [callName, ruleName] of Object.entries(pa.aliases)) {
                    if (!aliasIndex.has(callName)) {
                        aliasIndex.set(callName, ruleName);
                    }
                }
            }
        }
        return { rules, namespaceInitialStates: nsInit, aliasIndex, wildcardAliases, projectAliases, aliasWarnings };
    }
    catch {
        return null;
    }
}
/**
 * Generate a human-readable summary of SSG validation coverage.
 */
function summarizeSSGCoverage(results) {
    const totalCalls = results.reduce((s, r) => s + r.stats.totalCalls, 0);
    const totalMatched = results.reduce((s, r) => s + r.stats.matchedCalls, 0);
    const totalViolations = results.reduce((s, r) => s + r.violations.length, 0);
    if (totalCalls === 0)
        return "No calls validated by SSG state machine.";
    const matchRate = ((totalMatched / totalCalls) * 100).toFixed(1);
    return [
        `SSG State Machine: ${totalCalls} calls scanned, `,
        `${totalMatched} matched (${matchRate}%), `,
        `${totalViolations} state violation(s) found.`,
    ].join("");
}
