"use strict";
/**
 * P3.10: Goal-conditioned Protocol Planner
 *
 * Expands high-level goals into prerequisite subgoal chains,
 * enabling ProtocolStrategy BFS to discover multi-step repair paths.
 *
 * Problem: ProtocolStrategy BFS can find single-hop cleanup (close_file)
 * but can't plan "logout user" → [verify_password, generate_jwt,
 * create_session, logout]. This causes 39% missing_candidate failures.
 *
 * Solution: Goal Templates map goal patterns to prerequisite chains.
 * Lightweight (~20 templates), manually maintained, no GNN required.
 *
 * Target: reduce missing_candidate from 39% to <20%, Top-3 from 29% to >60%.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GoalPlanner = void 0;
exports.expandGoalActions = expandGoalActions;
exports.getGoalPlanner = getGoalPlanner;
// ═══════════════════════════════════════════════════════════════
// Goal Templates (~20 patterns covering 4 protocol groups)
// ═══════════════════════════════════════════════════════════════
const GOAL_TEMPLATES = [
    // ── Auth Protocol ──
    {
        pattern: /\b(missing.*(auth|authent)|no.*(auth|authent)|without.*(auth|authent)|unauthenticated|not.*authenticated)\b/i,
        protocol: "AuthProtocol",
        prerequisiteChains: [
            ["verify_password", "generate_jwt", "create_session"],
        ],
        requiredStates: ["SESSION_ACTIVE"],
        targetStates: ["SESSION_ACTIVE"],
    },
    {
        pattern: /\b(logout|log\s*out|sign\s*out|terminate\s*session|end\s*session)\b/i,
        protocol: "AuthProtocol",
        prerequisiteChains: [
            ["verify_password", "generate_jwt", "create_session"],
        ],
        requiredStates: ["SESSION_ACTIVE"],
        targetStates: ["UNAUTHENTICATED"],
    },
    {
        pattern: /\b(authenticate|auth|login|sign\s*in|verify\s*user|validate\s*user)\b/i,
        protocol: "AuthProtocol",
        prerequisiteChains: [
            ["verify_password", "generate_jwt", "create_session"],
        ],
        requiredStates: ["SESSION_ACTIVE"],
        targetStates: ["SESSION_ACTIVE"],
    },
    {
        pattern: /\b(create\s*session|establish\s*session|start\s*session)\b/i,
        protocol: "AuthProtocol",
        prerequisiteChains: [
            ["verify_password", "generate_jwt"],
        ],
        requiredStates: ["TOKEN_ISSUED"],
        targetStates: ["SESSION_ACTIVE"],
    },
    {
        pattern: /\b(generate\s*token|issue\s*token|create\s*token|jwt)\b/i,
        protocol: "AuthProtocol",
        prerequisiteChains: [
            ["verify_password"],
        ],
        requiredStates: ["PASSWORD_VERIFIED"],
        targetStates: ["TOKEN_ISSUED"],
    },
    {
        pattern: /\b(full\s*auth|complete\s*auth|auth\s*lifecycle|auth\s*cycle)\b/i,
        protocol: "AuthProtocol",
        prerequisiteChains: [
            ["verify_password", "generate_jwt", "create_session", "logout"],
        ],
        requiredStates: ["UNAUTHENTICATED"],
        targetStates: ["UNAUTHENTICATED"],
    },
    {
        pattern: /\brevok.*(?:token|auth)|re-?authenticate/i,
        protocol: "AuthProtocol",
        prerequisiteChains: [
            ["verify_password", "generate_jwt"],
        ],
        requiredStates: ["TOKEN_ISSUED"],
        targetStates: ["UNAUTHENTICATED"],
    },
    // ── File Protocol ──
    {
        pattern: /\b(safely\s*write|write.*file|write.*config|save.*file|persist.*file)\b/i,
        protocol: "FileProtocol",
        prerequisiteChains: [
            ["open_file", "write_file"],
        ],
        requiredStates: ["FILE_OPEN"],
        targetStates: [],
    },
    {
        pattern: /\b(read.*file|open.*read|load.*file|parse.*file)\b/i,
        protocol: "FileProtocol",
        prerequisiteChains: [
            ["open_file", "read_file"],
        ],
        requiredStates: ["FILE_OPEN"],
        targetStates: [],
    },
    {
        pattern: /\b(append.*file|add.*to.*file|update.*file)\b/i,
        protocol: "FileProtocol",
        prerequisiteChains: [
            ["open_file", "write_file"],
        ],
        requiredStates: ["FILE_OPEN"],
        targetStates: [],
    },
    {
        pattern: /\b(double\s*open|re-?open.*file)\b/i,
        protocol: "FileProtocol",
        prerequisiteChains: [
            ["open_file"],
        ],
        requiredStates: ["FILE_OPEN"],
        targetStates: [],
    },
    // ── Database Protocol ──
    {
        pattern: /\b(query|select|fetch|read.*db|db.*read|database.*read)\b/i,
        protocol: "DBProtocol",
        prerequisiteChains: [
            ["connect_db", "query_db"],
        ],
        requiredStates: ["DB_CONNECTED"],
        targetStates: [],
    },
    {
        pattern: /\b(insert|create.*record|add.*record|db.*write|write.*db)\b/i,
        protocol: "DBProtocol",
        prerequisiteChains: [
            ["connect_db", "query_db"],
        ],
        requiredStates: ["DB_CONNECTED"],
        targetStates: [],
    },
    {
        pattern: /\b(connect.*db|db.*connect|open.*database|database.*open)\b/i,
        protocol: "DBProtocol",
        prerequisiteChains: [
            ["connect_db"],
        ],
        requiredStates: ["DB_CONNECTED"],
        targetStates: [],
    },
    {
        pattern: /\b(reconnect|re-?connect)\b/i,
        protocol: "DBProtocol",
        prerequisiteChains: [
            ["connect_db", "disconnect_db", "connect_db", "query_db"],
        ],
        requiredStates: ["DB_CONNECTED"],
        targetStates: [],
    },
    {
        pattern: /\b(bulk|batch|multi.*query|multi.*insert)\b/i,
        protocol: "DBProtocol",
        prerequisiteChains: [
            ["connect_db", "query_db"],
        ],
        requiredStates: ["DB_CONNECTED"],
        targetStates: [],
    },
    // ── IR Pipeline Protocol ──
    {
        pattern: /\b(extract.*ir|ir.*extract|scan.*code|code.*scan)\b/i,
        protocol: "IRProtocol",
        prerequisiteChains: [
            ["extractIR", "validateAction", "validateActionSequence", "emitCode"],
        ],
        requiredStates: ["CODE_EMITTED"],
        targetStates: ["CODE_EMITTED"],
    },
    {
        pattern: /\b(validate.*action|action.*valid|check.*action)\b/i,
        protocol: "IRProtocol",
        prerequisiteChains: [
            ["extractIR", "validateAction"],
        ],
        requiredStates: ["ACTION_VALIDATED"],
        targetStates: ["ACTION_VALIDATED"],
    },
    {
        pattern: /\b(emit.*code|generate.*code|code.*gen|output.*code)\b/i,
        protocol: "IRProtocol",
        prerequisiteChains: [
            ["extractIR", "validateAction", "validateActionSequence", "emitCode"],
        ],
        requiredStates: ["CODE_EMITTED"],
        targetStates: ["CODE_EMITTED"],
    },
    {
        pattern: /\b(record.*session|save.*session|session.*record|store.*session)\b/i,
        protocol: "IRProtocol",
        prerequisiteChains: [
            ["extractIR", "validateAction", "validateActionSequence", "emitCode", "recordSession"],
        ],
        requiredStates: ["SESSION_RECORDED"],
        targetStates: ["SESSION_RECORDED"],
    },
    {
        pattern: /\b(full.*pipeline|complete.*pipeline|end.*to.*end|ir.*pipeline|pipeline.*ir)\b/i,
        protocol: "IRProtocol",
        prerequisiteChains: [
            ["extractIR", "validateAction", "validateActionSequence", "emitCode", "recordSession"],
        ],
        requiredStates: ["SESSION_RECORDED"],
        targetStates: ["SESSION_RECORDED"],
    },
    {
        pattern: /\b(re-?extract.*ir|stale.*ir|refresh.*ir)\b/i,
        protocol: "IRProtocol",
        prerequisiteChains: [
            ["extractIR", "validateAction"],
        ],
        requiredStates: ["ACTION_VALIDATED"],
        targetStates: ["ACTION_VALIDATED"],
    },
    // ── Cross-protocol ──
    {
        pattern: /\b(auth.*file|file.*auth|authenticate.*write|login.*save)\b/i,
        protocol: "AuthProtocol",
        prerequisiteChains: [
            ["verify_password", "generate_jwt", "create_session"],
        ],
        requiredStates: ["SESSION_ACTIVE"],
        targetStates: ["SESSION_ACTIVE"],
    },
    {
        pattern: /\b(db.*file|file.*db|database.*file|file.*database)\b/i,
        protocol: "DBProtocol",
        prerequisiteChains: [
            ["connect_db", "query_db", "disconnect_db"],
        ],
        requiredStates: [],
        targetStates: [],
    },
    // ═══════════════════════════════════════════════════════════
    // P7.3: New protocol type templates (12 templates)
    // ═══════════════════════════════════════════════════════════
    // ── Transaction Protocol ──
    {
        pattern: /\b(commit|finish\s*transaction|save\s*transaction|end\s*tx)\b/i,
        protocol: "TransactionProtocol",
        prerequisiteChains: [
            ["begin_tx", "insert_record", "commit_tx"],
            ["begin_tx", "update_record", "commit_tx"],
        ],
        requiredStates: ["TX_IDLE"],
        targetStates: ["TX_IDLE"],
    },
    {
        pattern: /\b(rollback|abort|undo|cancel\s*transaction|revert)\b/i,
        protocol: "TransactionProtocol",
        prerequisiteChains: [
            ["begin_tx", "rollback_tx"],
            ["begin_tx", "update_record", "rollback_tx"],
        ],
        requiredStates: ["TX_IDLE"],
        targetStates: ["TX_IDLE"],
    },
    {
        pattern: /\b(savepoint|checkpoint|partial\s*commit|nested\s*transaction)\b/i,
        protocol: "TransactionProtocol",
        prerequisiteChains: [
            ["begin_tx", "savepoint_create", "update_record", "savepoint_release", "commit_tx"],
            ["begin_tx", "savepoint_create", "delete_record", "rollback_to_savepoint", "rollback_tx"],
        ],
        requiredStates: ["TX_IDLE"],
        targetStates: ["TX_IDLE"],
    },
    // ── Conditional Protocol ──
    {
        pattern: /\b(access\s*(check|eval\w*)|permission|authorize|policy\s*check|evaluat(e|ion)\s*access)\b/i,
        protocol: "ConditionalProtocol",
        prerequisiteChains: [
            ["evaluate_access", "grant_access", "log_granted"],
            ["evaluate_access", "deny_access", "log_denied"],
        ],
        requiredStates: ["COND_RESOLVED"],
        targetStates: ["COND_RESOLVED"],
    },
    {
        pattern: /\b(escalate|override|bypass.*policy|elevate)\b/i,
        protocol: "ConditionalProtocol",
        prerequisiteChains: [
            ["evaluate_access", "deny_access", "escalate_access", "log_granted"],
        ],
        requiredStates: ["COND_RESOLVED"],
        targetStates: ["COND_RESOLVED"],
    },
    {
        pattern: /\b(audit.*access|log.*access|access.*log|compliance\s*check)\b/i,
        protocol: "ConditionalProtocol",
        prerequisiteChains: [
            ["evaluate_access", "grant_access", "audit_condition"],
            ["evaluate_access", "deny_access", "audit_condition"],
        ],
        requiredStates: ["COND_RESOLVED"],
        targetStates: ["COND_RESOLVED"],
    },
    // ── Loop Protocol ──
    {
        pattern: /\b(fetch|paginate|iterate|process.*batch|batch.*process|loop.*data)\b/i,
        protocol: "LoopProtocol",
        prerequisiteChains: [
            ["init_fetch_loop", "fetch_batch", "has_more_data", "process_item", "exit_loop"],
        ],
        requiredStates: ["LOOP_DONE"],
        targetStates: ["LOOP_DONE"],
    },
    {
        pattern: /\b(retry|re-?try|recover|re-?attempt|fallback)\b/i,
        protocol: "LoopProtocol",
        prerequisiteChains: [
            ["init_fetch_loop", "fetch_batch", "retry_batch", "fetch_batch", "has_more_data", "process_item", "exit_loop"],
        ],
        requiredStates: ["LOOP_DONE"],
        targetStates: ["LOOP_DONE"],
    },
    {
        pattern: /\b(poll|wait.*for|monitor|watch|observe)\b/i,
        protocol: "LoopProtocol",
        prerequisiteChains: [
            ["init_fetch_loop", "fetch_batch", "has_more_data", "process_item", "poll_status", "exit_loop"],
        ],
        requiredStates: ["LOOP_DONE"],
        targetStates: ["LOOP_DONE"],
    },
    // ── Cross-Protocol (auth-gated resources) ──
    {
        pattern: /\b(auth.*db|secure.*db|gated.*db|database.*auth|login.*query)\b/i,
        protocol: "CrossProtocol",
        prerequisiteChains: [
            ["verify_password", "create_session", "connect_db", "query_db", "disconnect_db", "logout"],
        ],
        requiredStates: [],
        targetStates: ["UNAUTHENTICATED"],
    },
    {
        pattern: /\b(auth.*file.*db|full.*secure|gated.*resource|end.*to.*end.*secure)\b/i,
        protocol: "CrossProtocol",
        prerequisiteChains: [
            ["verify_password", "create_session", "open_file", "read_file", "connect_db", "query_db", "close_file", "disconnect_db", "logout"],
        ],
        requiredStates: [],
        targetStates: ["UNAUTHENTICATED"],
    },
    // ── Stateless / Validation ──
    {
        pattern: /(sanitiz|clean.*input|validate.*input|input.*valid|schema.*valid)/i,
        protocol: "StatelessProtocol",
        prerequisiteChains: [
            ["sanitize_input", "validate_schema"],
        ],
        requiredStates: [],
        targetStates: [],
    },
    {
        pattern: /\b(checksum|integrity|verify.*data|data.*integrity|hash.*verif|verif.*hash)\b/i,
        protocol: "StatelessProtocol",
        prerequisiteChains: [
            ["compute_hash", "verify_checksum"],
            ["decode_payload", "decompress_buffer", "verify_checksum"],
        ],
        requiredStates: [],
        targetStates: [],
    },
    // ═══════════════════════════════════════════════════════════
    // P7.3: Cross-protocol auth + resource chains (fix RW-005, RW-017)
    // ═══════════════════════════════════════════════════════════
    // ── Auth-gated database access ──
    {
        pattern: /\b(auth.*(db|database|query)|login.*(db|database|query)|authenticate.*(db|database|query)|missing.*auth.*(db|database))\b/i,
        protocol: "CrossProtocol",
        prerequisiteChains: [
            ["verify_password", "generate_jwt", "create_session", "disconnect_db"],
            ["verify_password", "generate_jwt", "create_session", "connect_db", "query_db", "disconnect_db"],
        ],
        requiredStates: ["UNAUTHENTICATED"],
        targetStates: ["UNAUTHENTICATED"],
    },
    // ── Auth-gated file access ──
    {
        pattern: /\b(auth.*(file|write|read)|login.*(file|write|read)|gated.*(file|resource)|auth.*gate)\b/i,
        protocol: "CrossProtocol",
        prerequisiteChains: [
            ["verify_password", "create_session", "open_file", "read_file", "close_file", "logout"],
            ["verify_password", "create_session", "open_file", "write_file", "close_file", "logout"],
        ],
        requiredStates: ["UNAUTHENTICATED"],
        targetStates: ["UNAUTHENTICATED"],
    },
    // ── Transaction error handling (RW-012) ──
    {
        pattern: /\b(transaction.*(error|fail)|tx.*(error|fail)|error.*(transaction|tx|rollback|savepoint)|savepoint.*(error|fail|rollback)|rollback.*(error|fail|savepoint))\b/i,
        protocol: "TransactionProtocol",
        prerequisiteChains: [
            ["begin_tx", "savepoint_create", "update_record", "rollback_to_savepoint", "rollback_tx"],
        ],
        requiredStates: ["TX_IDLE"],
        targetStates: ["TX_IDLE"],
    },
];
// ═══════════════════════════════════════════════════════════════
// Goal Planner
// ═══════════════════════════════════════════════════════════════
class GoalPlanner {
    constructor(templates) {
        this.templates = templates || GOAL_TEMPLATES;
    }
    /**
     * Expand a natural language goal into an action sequence.
     *
     * Returns null if no template matches — caller falls back to
     * existing ProtocolStrategy BFS.
     */
    expandGoal(goal) {
        // Find matching templates (sorted by specificity: longer pattern match = better)
        const matches = this.templates
            .filter(t => t.pattern.test(goal))
            .sort((a, b) => {
            const aLen = (goal.match(a.pattern)?.[0]?.length ?? 0);
            const bLen = (goal.match(b.pattern)?.[0]?.length ?? 0);
            return bLen - aLen;
        });
        if (matches.length === 0)
            return null;
        const template = matches[0];
        // Use the best chain (first = most specific for this template)
        const chain = template.prerequisiteChains[0];
        // Build subgoal descriptions from the chain
        const subgoals = chain.map((fn, i) => {
            const stepNames = {
                verify_password: "verify user credentials",
                generate_jwt: "issue authentication token",
                create_session: "establish active session",
                logout: "terminate session",
                revoke_token: "revoke token",
                open_file: "open file handle",
                read_file: "read file contents",
                write_file: "write file contents",
                close_file: "close file handle",
                connect_db: "connect to database",
                query_db: "query database",
                disconnect_db: "disconnect from database",
                extractIR: "extract intermediate representation",
                validateAction: "validate action semantics",
                validateActionSequence: "validate action sequence",
                emitCode: "emit target code",
                recordSession: "record execution session",
                // Transaction
                begin_tx: "begin transaction",
                commit_tx: "commit transaction",
                rollback_tx: "rollback transaction",
                insert_record: "insert record in transaction",
                update_record: "update record in transaction",
                delete_record: "delete record in transaction",
                savepoint_create: "create savepoint",
                savepoint_release: "release savepoint",
                rollback_to_savepoint: "rollback to savepoint",
                prep_two_phase: "prepare two-phase commit",
                // Conditional
                evaluate_access: "evaluate access policy",
                grant_access: "grant access (true branch)",
                deny_access: "deny access (false branch)",
                log_granted: "log access granted",
                log_denied: "log access denied",
                escalate_access: "escalate denied access to grant",
                bypass_condition: "bypass condition check",
                retry_evaluation: "retry condition evaluation",
                audit_condition: "audit condition outcome",
                // Loop
                init_fetch_loop: "initialize fetch loop",
                fetch_batch: "fetch next data batch",
                has_more_data: "check for more data",
                process_item: "process data item",
                next_iteration: "advance to next iteration",
                exit_loop: "exit loop normally",
                retry_batch: "retry failed batch fetch",
                timeout_exit: "exit loop on timeout",
                poll_status: "poll status in iteration",
                // Stateless
                compute_hash: "compute hash digest",
                validate_schema: "validate data against schema",
                sanitize_input: "sanitize user input",
                verify_checksum: "verify data integrity checksum",
                encode_payload: "encode data payload",
                decode_payload: "decode data payload",
                compress_buffer: "compress data buffer",
                decompress_buffer: "decompress data buffer",
                // Cross-protocol
                auth_file_open: "open auth-gated file",
                auth_file_read: "read through auth gate",
                auth_file_close: "close auth-gated file session",
                auth_db_connect: "connect through auth gate",
                auth_db_query: "query through auth gate",
                auth_db_disconnect: "disconnect auth-gated db",
            };
            return stepNames[fn] || `step ${i + 1}: ${fn}`;
        });
        return {
            goal,
            protocol: template.protocol,
            template: goal.match(template.pattern)?.[0],
            subgoals,
            actions: chain,
            confidence: 0.85,
        };
    }
    /**
     * Get all action sequences that could satisfy a goal.
     * Used by ProtocolStrategy to generate candidates beyond single-hop BFS.
     */
    getCandidateActions(goal) {
        const matches = this.templates
            .filter(t => t.pattern.test(goal))
            .sort((a, b) => {
            const aLen = (goal.match(a.pattern)?.[0]?.length ?? 0);
            const bLen = (goal.match(b.pattern)?.[0]?.length ?? 0);
            return bLen - aLen;
        });
        return matches.flatMap(t => t.prerequisiteChains);
    }
    /** Check if a template exists for this goal. */
    hasTemplate(goal) {
        return this.templates.some(t => t.pattern.test(goal));
    }
}
exports.GoalPlanner = GoalPlanner;
// ═══════════════════════════════════════════════════════════════
// Goal-aware Candidate Expansion
// ═══════════════════════════════════════════════════════════════
/**
 * Expand a goal into additional repair actions.
 *
 * Given a goal like "safely write config file", this returns
 * ["open_file", "write_file"] — the prerequisite chain that
 * ProtocolStrategy BFS can then validate and extend.
 *
 * Used by ProtocolStrategy to discover multi-step candidates
 * that single-hop BFS from currentState alone would miss.
 */
function expandGoalActions(goal, planner) {
    const gp = planner || new GoalPlanner();
    const plan = gp.expandGoal(goal);
    return plan?.actions ?? [];
}
/** Singleton for use across the codebase. */
let _defaultPlanner = null;
function getGoalPlanner() {
    if (!_defaultPlanner)
        _defaultPlanner = new GoalPlanner();
    return _defaultPlanner;
}
