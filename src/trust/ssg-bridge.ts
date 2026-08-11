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

import * as fs from "fs";
import * as path from "path";
import type { SemanticStep, ProtocolDomain } from "./api-semantic-mapper";
import type { TrustViolation } from "./types";
import type { StateAnnotation, SSGRejection } from "../ssg-validator";
import {
  validateTransition,
  findFixPathStatic,
  hashRules,
  parseProtocolsFromJSON,
} from "../ssg-validator";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface SSGViolation {
  /** The call that triggered the violation */
  callName: string;
  /** The SSG namespace */
  namespace: string;
  /** Current state when violation occurred */
  currentState: string[];
  /** Required pre-states that weren't satisfied */
  requiredState: string[];
  /** BFS-computed fix path (functions to call to reach required state) */
  fixPath: string[];
  /** The matched protocol rule name (if any) */
  matchedRule?: string;
  /** Human-readable explanation */
  explanation: string;
}

export interface SSGValidationResult {
  /** Whether the entire sequence passed SSG validation */
  passed: boolean;
  /** Per-namespace state trace */
  trace: Array<{
    call: string;
    namespace: string;
    matchedRule: string | null;
    valid: boolean;
    rejection?: SSGRejection;
  }>;
  /** Violations found */
  violations: SSGViolation[];
  /** Coverage stats */
  stats: {
    totalCalls: number;
    matchedCalls: number;
    unmatchedCalls: number;
    validatedCalls: number;
    violatedCalls: number;
  };
}

// ═══════════════════════════════════════════════════════════════
// Domain → Namespace Mapping
// ═══════════════════════════════════════════════════════════════

/**
 * Maps semantic protocol domains to SSG state machine namespaces.
 * Multiple domains can map to the same namespace (e.g., tls_config,
 * tls_handshake, tls_cert all map to "tls").
 */
const DOMAIN_TO_NAMESPACE: Record<string, string> = {
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
  http_ops: "tls",       // HTTP server → TLS namespace
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
const AUTH_DOMAIN_FLOW: ProtocolDomain[] = [
  "auth_hash",    // password hashing/verification
  "auth_mech",    // token generation, SASL negotiation
  "auth_cred",    // credential retrieval
  "auth_spn",     // Kerberos SPN
  "auth_gssapi",  // GSSAPI wrap/unwrap
];

/**
 * Keywords that help map a call to a specific protocol rule within a namespace.
 * Ordered by specificity — first match wins.
 */
interface RuleKeywordHint {
  /** Substring to match in the call name or semantic description */
  keyword: string;
  /** The protocol rule name this keyword suggests */
  ruleName: string;
}

const NAMESPACE_RULE_HINTS: Record<string, RuleKeywordHint[]> = {
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
    { keyword: "createServer", ruleName: "http_create_server" },
    { keyword: "create_server", ruleName: "http_create_server" },
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
};

// ═══════════════════════════════════════════════════════════════
// Call → Rule Inference
// ═══════════════════════════════════════════════════════════════

/**
 * Normalize a function name for matching:
 *   "bcrypt.hashPassword" → "hash_password"
 *   "SSL_CTX_new" → "ssl_ctx_new"
 */
function normalizeName(name: string): string {
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
function inferRuleName(
  apiName: string,
  domain: ProtocolDomain,
  description: string,
  ruleNames: string[],
  namespace: string,
  aliases: Map<string, string>,
  wildcardAliases: Map<string, string>,
): string | null {
  const normalized = normalizeName(apiName);
  const lowerApi = apiName.toLowerCase();
  const lowerDesc = description.toLowerCase();

  // Strategy 0a: Wildcard alias match — e.g., "db.*" matches "db.getUserByOpenId"
  // Wildcard aliases are stored with their prefix (without "*") as key, ruleName as value.
  // They're kept in a separate map: wildcardAliases: Map<prefix, ruleName>
  for (const [prefix, ruleName] of wildcardAliases) {
    if (lowerApi.startsWith(prefix)) return ruleName;
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
    if (ruleName) return ruleName;
  }

  // Strategy 1: Exact normalized match against rule names
  for (const ruleName of ruleNames) {
    if (normalized === ruleName || lowerApi === ruleName) {
      return ruleName;
    }
  }

  // Strategy 2: Word-segment match — only match on complete word boundaries.
  // Split both the rule name and normalized call name into word segments
  // (separated by _). Match if every word in the rule name appears as a
  // word segment in the normalized call name. This prevents "status" from
  // matching "poll_status" via raw substring, since "status" must appear
  // as a complete _-delimited segment.
  for (const ruleName of ruleNames) {
    const ruleWords = ruleName.split("_");
    const callWords = normalized.split("_");

    // Rule must have at least 2 words for this strategy (single-word rules
    // are too prone to false positives via substring)
    if (ruleWords.length < 2) continue;

    // Every rule word must appear as a complete call word segment
    const allWordsMatch = ruleWords.every((rw) => callWords.includes(rw));
    if (allWordsMatch) {
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
export function validateSequenceWithSSG(
  steps: SemanticStep[],
  rules: Map<string, StateAnnotation>,
  namespaceInitialStates: Record<string, string>,
  file: string,
  aliasIndex?: Map<string, string>,
  wildcardAliases?: Map<string, string>,
): SSGValidationResult {
  const allRuleNames = Array.from(rules.keys());
  const aliases = aliasIndex || new Map<string, string>();
  const wildcards = wildcardAliases || new Map<string, string>();

  // Build namespace→initialState map
  const nsInitMap = new Map<string, string>();
  for (const [ns, state] of Object.entries(namespaceInitialStates)) {
    nsInitMap.set(ns, state);
  }
  if (!nsInitMap.has("_global")) nsInitMap.set("_global", "INIT");
  if (!nsInitMap.has("stateless")) nsInitMap.set("stateless", "IDLE");

  // Per-namespace validation contexts
  const contexts = new Map<string, any>(); // namespace → ValidationContext
  const ensureContext = (ns: string) => {
    if (!contexts.has(ns)) {
      const initState = nsInitMap.get(ns) || "IDLE";
      contexts.set(ns, {
        ledger: [],
        currentState: { [ns]: [initState] },
      });
    }
    return contexts.get(ns)!;
  };

  const trace: SSGValidationResult["trace"] = [];
  const violations: SSGViolation[] = [];
  let matchedCalls = 0;
  let validatedCalls = 0;
  let violatedCalls = 0;

  // Pre-compute rule hashes for integrity
  const ruleHash = (() => {
    try {
      return hashRules(rules);
    } catch {
      return undefined;
    }
  })();

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const namespace = DOMAIN_TO_NAMESPACE[step.domain] || "stateless";

    // Skip stateless — no state machine validation needed
    if (namespace === "stateless") {
      trace.push({
        call: step.api,
        namespace,
        matchedRule: null,
        valid: true,
      });
      continue;
    }

    // Try to match call to a protocol rule
    // Priority: wildcard alias → exact alias → name match → word match → keyword
    const ruleName = inferRuleName(
      step.api,
      step.domain,
      step.description,
      allRuleNames,
      namespace,
      aliases,
      wildcards,
    );

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
    // The rule defines which state machine it belongs to (protocols.json).
    const ruleNamespace = rules.get(ruleName)?.namespace || namespace;

    // Validate transition
    try {
      const ctx = ensureContext(ruleNamespace);
      const result = validateTransition(
        ctx,
        ruleName,
        i,
        rules,
        nsInitMap,
        ruleHash,
      );

      validatedCalls++;

      if (result.valid) {
        // Advance state
        ctx.ledger.push(result.transition);
        ctx.currentState = result.transition.statesAfter;
      } else {
        violatedCalls++;
        const rejection = result.rejection!;

        // Compute BFS fix path
        let fixPath: string[] = [];
        try {
          fixPath = findFixPathStatic(
            rules,
            ruleNamespace,
            rejection.currentState,
            rejection.requiredState,
          );
        } catch {
          fixPath = rejection.missingFunctions || [];
        }

        violations.push({
          callName: step.api,
          namespace: ruleNamespace,
          currentState: rejection.currentState,
          requiredState: rejection.requiredState,
          fixPath,
          matchedRule: ruleName,
          explanation:
            `SSG state violation: "${step.api}" (mapped to "${ruleName}") ` +
            `requires states [${rejection.requiredState.join(", ")}] ` +
            `but current ${ruleNamespace} state is [${rejection.currentState.join(", ")}]. ` +
            (fixPath.length > 0
              ? `Fix path: ${fixPath.join(" → ")}`
              : `No fix path found — protocol gap.`),
        });

        // Still advance state on rejection (best-effort: apply transition anyway
        // so subsequent calls can be validated)
        ctx.ledger.push(result.transition);
      }
    } catch {
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
export function ssgViolationsToTrustViolations(
  ssgResult: SSGValidationResult,
  file: string,
  funcName: string,
): TrustViolation[] {
  return ssgResult.violations.map((v) => ({
    severity: "medium" as const,
    rule_id: `SSG_${v.namespace.toUpperCase()}_STATE_VIOLATION`,
    file,
    function: funcName,
    message: v.explanation,
    evidence: `Call: ${v.callName} | Rule: ${v.matchedRule || "unknown"} | ` +
      `Required: [${v.requiredState.join(", ")}] | ` +
      `Current: [${v.currentState.join(", ")}]`,
    why: `Protocol state machine violation in namespace "${v.namespace}": ` +
      `function "${v.callName}" cannot be called in current state ` +
      `[${v.currentState.join(", ")}]. Required pre-states: [${v.requiredState.join(", ")}].`,
    fix: v.fixPath.length > 0
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
export function loadProjectAliases(
  projectPath: string,
  ruleNames: Set<string>,
): { aliases: Record<string, string>; warnings: string[] } | null {
  try {
    const aliasPath = path.join(projectPath, ".progmune_aliases.json");
    if (!fs.existsSync(aliasPath)) return null;

    const raw = JSON.parse(fs.readFileSync(aliasPath, "utf-8"));
    if (!raw.aliases || typeof raw.aliases !== "object") {
      return { aliases: {}, warnings: [".progmune_aliases.json: missing or invalid 'aliases' key"] };
    }

    const aliases: Record<string, string> = {};
    const warnings: string[] = [];

    for (const [callName, ruleName] of Object.entries(raw.aliases)) {
      if (typeof ruleName !== "string") {
        warnings.push(`.progmune_aliases.json: alias "${callName}" value must be a string, skipping`);
        continue;
      }
      const normalizedCall = callName.toLowerCase().trim();
      const normalizedRule = ruleName.trim();
      if (!normalizedCall || !normalizedRule) continue;

      // Validate: target rule must exist
      if (!ruleNames.has(normalizedRule)) {
        warnings.push(
          `.progmune_aliases.json: "${callName}" → "${ruleName}" — ` +
          `rule "${ruleName}" not found in protocol rules, skipping`,
        );
        continue;
      }

      aliases[normalizedCall] = normalizedRule;
    }

    return { aliases, warnings };
  } catch (e: any) {
    return { aliases: {}, warnings: [`Failed to load .progmune_aliases.json: ${e.message}`] };
  }
}

export function loadProtocolRules(projectPath?: string): {
  rules: Map<string, StateAnnotation>;
  namespaceInitialStates: Record<string, string>;
  /** Reverse index: alias → ruleName for exact O(1) lookup */
  aliasIndex: Map<string, string>;
  /** Wildcard prefix → ruleName for prefix matching (e.g., "db." → "query_db") */
  wildcardAliases: Map<string, string>;
  /** Project-level aliases loaded from .progmune_aliases.json (supplemental) */
  projectAliases?: Record<string, string>;
  /** Warnings from project alias validation (unknown rules, etc.) */
  aliasWarnings?: string[];
} | null {
  try {
    // Resolve protocols.json using multiple strategies:
    //   1. Project-local (if projectPath provided)
    //   2. Relative to cwd (works in vitest/dev)
    //   3. Relative to this source file (works with __dirname in CJS)
    const searchPaths: string[] = [];

    if (projectPath) {
      searchPaths.push(
        path.join(projectPath, "protocols.json"),
        path.join(projectPath, ".progmune_protocols.json"),
      );
    }

    // cwd-based resolution (most reliable cross-environment)
    searchPaths.push(
      path.resolve(process.cwd(), "protocols.json"),
      path.resolve(process.cwd(), "..", "protocols.json"),
      path.resolve(process.cwd(), "progmune-runtime", "protocols.json"),
    );

    // __dirname-based (works in CJS context)
    try {
      searchPaths.push(path.resolve(__dirname, "../../protocols.json"));
      searchPaths.push(path.resolve(__dirname, "../protocols.json"));
    } catch {
      // __dirname not available (ESM context)
    }

    let protoDef: any = null;
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
      } catch {
        continue;
      }
    }

    if (!protoDef || !protoDef.rules) return null;

    const protocols = parseProtocolsFromJSON(protoDef);
    const rules = new Map<string, StateAnnotation>();
    const aliasIndex = new Map<string, string>();
    const wildcardAliases = new Map<string, string>();
    for (const p of protocols) {
      rules.set(p.function, p.protocol);
      // Build alias → ruleName reverse index
      if (p.protocol.aliases) {
        for (const alias of p.protocol.aliases) {
          const normalized = alias.toLowerCase().trim();
          if (!normalized) continue;
          // Wildcard aliases end with ".*" — match any function with that prefix
          if (normalized.endsWith(".*")) {
            const prefix = normalized.slice(0, -2); // remove ".*"
            if (prefix && !wildcardAliases.has(prefix)) {
              wildcardAliases.set(prefix, p.function);
            }
          } else {
            // First alias wins (no overwrite — prevents ambiguous mappings)
            if (!aliasIndex.has(normalized)) {
              aliasIndex.set(normalized, p.function);
            }
          }
        }
      }
    }

    const nsInit: Record<string, string> = {};
    if (protoDef.namespaceInitialStates) {
      Object.assign(nsInit, protoDef.namespaceInitialStates);
    }
    // Ensure essential namespaces have defaults
    if (!nsInit._global) nsInit._global = "INIT";
    if (!nsInit.stateless) nsInit.stateless = "IDLE";

    // ── Load project-level aliases (supplemental, never override global) ──
    let projectAliases: Record<string, string> | undefined;
    let aliasWarnings: string[] | undefined;
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
  } catch {
    return null;
  }
}

/**
 * Generate a human-readable summary of SSG validation coverage.
 */
export function summarizeSSGCoverage(
  results: SSGValidationResult[]
): string {
  const totalCalls = results.reduce((s, r) => s + r.stats.totalCalls, 0);
  const totalMatched = results.reduce((s, r) => s + r.stats.matchedCalls, 0);
  const totalViolations = results.reduce((s, r) => s + r.violations.length, 0);

  if (totalCalls === 0) return "No calls validated by SSG state machine.";

  const matchRate = ((totalMatched / totalCalls) * 100).toFixed(1);
  return [
    `SSG State Machine: ${totalCalls} calls scanned, `,
    `${totalMatched} matched (${matchRate}%), `,
    `${totalViolations} state violation(s) found.`,
  ].join("");
}
