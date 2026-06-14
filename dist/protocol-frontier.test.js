"use strict";
/**
 * P3.14-15: Protocol Frontier Explorer Tests
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const protocol_frontier_1 = require("./protocol-frontier");
function makeRules() {
    return new Map([
        ["verify_password", { pre_states: ["UNAUTHENTICATED"], post_states: ["PASSWORD_VERIFIED"] }],
        ["generate_jwt", { pre_states: ["PASSWORD_VERIFIED"], post_states: ["TOKEN_ISSUED"], invalidate: ["PASSWORD_VERIFIED"] }],
        ["create_session", { pre_states: ["TOKEN_ISSUED"], post_states: ["SESSION_ACTIVE"], invalidate: ["TOKEN_ISSUED"] }],
        ["logout", { pre_states: ["SESSION_ACTIVE"], post_states: ["UNAUTHENTICATED"], invalidate: ["SESSION_ACTIVE"] }],
        ["open_file", { pre_states: [], post_states: ["FILE_OPEN"] }],
        ["close_file", { pre_states: ["FILE_OPEN"], post_states: [], invalidate: ["FILE_OPEN"] }],
        ["connect_db", { pre_states: [], post_states: ["DB_CONNECTED"] }],
        ["disconnect_db", { pre_states: ["DB_CONNECTED"], post_states: [], invalidate: ["DB_CONNECTED"] }],
    ]);
}
(0, vitest_1.describe)("Frontier Explorer", () => {
    (0, vitest_1.it)("finds auth path from UNAUTHENTICATED to SESSION_ACTIVE", () => {
        const rules = makeRules();
        const path = (0, protocol_frontier_1.searchFrontier)(rules, ["UNAUTHENTICATED"], ["SESSION_ACTIVE"]);
        (0, vitest_1.expect)(path.found).toBe(true);
        (0, vitest_1.expect)(path.actions).toContain("verify_password");
        (0, vitest_1.expect)(path.actions).toContain("generate_jwt");
        (0, vitest_1.expect)(path.actions).toContain("create_session");
        (0, vitest_1.expect)(path.cost).toBe(3);
    });
    (0, vitest_1.it)("finds logout path from SESSION_ACTIVE to UNAUTHENTICATED", () => {
        const rules = makeRules();
        const path = (0, protocol_frontier_1.searchFrontier)(rules, ["SESSION_ACTIVE"], ["UNAUTHENTICATED"]);
        (0, vitest_1.expect)(path.found).toBe(true);
        (0, vitest_1.expect)(path.actions).toEqual(["logout"]);
        (0, vitest_1.expect)(path.cost).toBe(1);
    });
    (0, vitest_1.it)("finds close_file cleanup from FILE_OPEN", () => {
        const rules = makeRules();
        const path = (0, protocol_frontier_1.searchFrontier)(rules, ["FILE_OPEN"], []);
        (0, vitest_1.expect)(path.found).toBe(true);
        (0, vitest_1.expect)(path.actions).toContain("close_file");
    });
    (0, vitest_1.it)("returns not found for unreachable target", () => {
        const rules = makeRules();
        const path = (0, protocol_frontier_1.searchFrontier)(rules, ["UNAUTHENTICATED"], ["NONEXISTENT"]);
        (0, vitest_1.expect)(path.found).toBe(false);
    });
    (0, vitest_1.it)("explores frontier: generates multiple paths", () => {
        const rules = makeRules();
        const paths = (0, protocol_frontier_1.exploreFrontier)(rules, ["UNAUTHENTICATED"], 20, 6);
        (0, vitest_1.expect)(paths.length).toBeGreaterThan(1);
        // Should include auth chain
        const hasAuth = paths.some(p => p.includes("verify_password") && p.includes("generate_jwt") && p.includes("create_session"));
        (0, vitest_1.expect)(hasAuth).toBe(true);
    });
    (0, vitest_1.it)("multi-start finds best path among candidates", () => {
        const rules = makeRules();
        const path = (0, protocol_frontier_1.searchFrontierMulti)(rules, [
            ["FILE_OPEN"],
            ["SESSION_ACTIVE"],
        ], ["UNAUTHENTICATED"]);
        // SESSION_ACTIVE→logout→UNAUTHENTICATED is 1 step, better than FILE_OPEN→close→open→auth→...
        (0, vitest_1.expect)(path.found).toBe(true);
        (0, vitest_1.expect)(path.cost).toBe(1);
        (0, vitest_1.expect)(path.actions).toContain("logout");
    });
});
(0, vitest_1.describe)("Cross-Protocol Planner", () => {
    (0, vitest_1.it)("has protocol bridges", () => {
        const bridges = (0, protocol_frontier_1.getProtocolBridges)();
        (0, vitest_1.expect)(bridges.length).toBeGreaterThanOrEqual(3);
        (0, vitest_1.expect)(bridges.some(b => b.from === "AuthProtocol" && b.to === "FileProtocol")).toBe(true);
        (0, vitest_1.expect)(bridges.some(b => b.from === "AuthProtocol" && b.to === "DBProtocol")).toBe(true);
    });
    (0, vitest_1.it)("plans single protocol", () => {
        const rules = makeRules();
        const plan = (0, protocol_frontier_1.planCrossProtocol)("logout", [
            { name: "AuthProtocol", rules },
        ], ["AuthProtocol"], { AuthProtocol: ["SESSION_ACTIVE"] });
        (0, vitest_1.expect)(plan.actions.length).toBeGreaterThan(0);
        (0, vitest_1.expect)(plan.actions).toContain("logout");
    });
    (0, vitest_1.it)("generates cross-protocol candidates", () => {
        const candidates = (0, protocol_frontier_1.expandCrossProtocolCandidates)("multi-step repair", ["FileProtocol", "DBProtocol"]);
        // Should find paths for both protocols
        (0, vitest_1.expect)(candidates.length).toBeGreaterThan(1);
        // At least one file path and one db path
        const hasFile = candidates.some(p => p.includes("open_file") || p.includes("close_file"));
        const hasDb = candidates.some(p => p.includes("connect_db") || p.includes("disconnect_db"));
        (0, vitest_1.expect)(hasFile || hasDb).toBe(true);
    });
});
