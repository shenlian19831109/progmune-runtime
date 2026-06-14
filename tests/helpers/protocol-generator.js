"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dbProtocolRules = exports.fileProtocolRules = exports.authProtocolRules = void 0;
exports.generateRandomProtocol = generateRandomProtocol;
exports.mergeProtocolRules = mergeProtocolRules;
/**
 * Generate a random protocol graph with N states.
 * Guarantees at least one path from S0 to S_{n-1}.
 */
function generateRandomProtocol(numStates) {
    const rules = new Map();
    let edgeCount = 0;
    // Main chain: guaranteed 1-step path S0→S1→S2→...→S{n-1}
    for (let i = 0; i < numStates - 1; i++) {
        rules.set(`chain_${i}_to_${i + 1}`, {
            pre_states: [`S${i}`],
            post_states: [`S${i + 1}`],
        });
        edgeCount++;
    }
    // Extra random edges (~1.5x states)
    const extraEdges = Math.floor(numStates * 1.5);
    for (let i = 0; i < extraEdges; i++) {
        const fromIdx = Math.floor(Math.random() * numStates);
        const toIdx = Math.floor(Math.random() * numStates);
        if (fromIdx !== toIdx) {
            const fnName = `random_${fromIdx}_${toIdx}_${i}`;
            if (!rules.has(fnName)) {
                rules.set(fnName, {
                    pre_states: [`S${fromIdx}`],
                    post_states: [`S${toIdx}`],
                });
                edgeCount++;
            }
        }
    }
    return { rules, stateCount: numStates, edgeCount, hasPath: true };
}
/** Pre-built protocol rules for integration/performance tests. */
exports.authProtocolRules = new Map([
    ["verify_password", { pre_states: ["UNAUTHENTICATED"], post_states: ["PASSWORD_VERIFIED"] }],
    ["generate_jwt", { pre_states: ["PASSWORD_VERIFIED"], post_states: ["TOKEN_ISSUED"], invalidate: ["PASSWORD_VERIFIED"] }],
    ["create_session", { pre_states: ["TOKEN_ISSUED"], post_states: ["SESSION_ACTIVE"], invalidate: ["TOKEN_ISSUED"] }],
    ["logout", { pre_states: ["SESSION_ACTIVE"], post_states: ["UNAUTHENTICATED"], invalidate: ["SESSION_ACTIVE"] }],
    ["revoke_token", { pre_states: ["TOKEN_ISSUED"], post_states: ["UNAUTHENTICATED"], invalidate: ["TOKEN_ISSUED"] }],
]);
exports.fileProtocolRules = new Map([
    ["open_file", { pre_states: [], post_states: ["FILE_OPEN"] }],
    ["read_file", { pre_states: ["FILE_OPEN"], post_states: [] }],
    ["write_file", { pre_states: ["FILE_OPEN"], post_states: [] }],
    ["close_file", { pre_states: ["FILE_OPEN"], post_states: [], invalidate: ["FILE_OPEN"] }],
]);
exports.dbProtocolRules = new Map([
    ["connect_db", { pre_states: [], post_states: ["DB_CONNECTED"] }],
    ["query_db", { pre_states: ["DB_CONNECTED"], post_states: [] }],
    ["disconnect_db", { pre_states: ["DB_CONNECTED"], post_states: [], invalidate: ["DB_CONNECTED"] }],
]);
/** Merge multiple protocol rule maps into one. */
function mergeProtocolRules(...maps) {
    const merged = new Map();
    for (const m of maps) {
        for (const [k, v] of m)
            merged.set(k, v);
    }
    return merged;
}
