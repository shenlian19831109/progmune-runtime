"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Unit tests for strategy-planner pure functions.
 * Tests the graph-building and chain-selection logic in isolation.
 */
const vitest_1 = require("vitest");
const strategy_planner_1 = require("./strategy-planner");
// Minimal mock IR with functions covering auth and data domains
const mockIR = [
    {
        name: "validatePassword",
        purpose: "Validate a user's password against stored hash",
        tags: ["auth", "security"],
        requires: ["password", "hash"],
        produces: ["validation_result"],
        useWhen: ["user login", "password reset"],
        file: "src/auth.ts",
        exported: true,
        params: [
            { name: "password", type: "string" },
            { name: "hash", type: "string" },
        ],
        returnType: "boolean",
    },
    {
        name: "generateJWT",
        purpose: "Generate a JWT token for authenticated user",
        tags: ["auth", "token"],
        requires: ["validation_result"],
        produces: ["jwt_token"],
        useWhen: ["after successful login"],
        file: "src/auth.ts",
        exported: true,
        params: [{ name: "userId", type: "string" }],
        returnType: "string",
    },
    {
        name: "fetchUser",
        purpose: "Fetch user data from the database",
        tags: ["data", "user"],
        requires: ["userId"],
        produces: ["user_data"],
        useWhen: ["user profile", "dashboard"],
        file: "src/data.ts",
        exported: true,
        params: [{ name: "userId", type: "string" }],
        returnType: "object",
    },
    {
        name: "saveToDatabase",
        purpose: "Save record to persistent storage",
        tags: ["data", "storage"],
        requires: ["record"],
        produces: ["saved_id"],
        useWhen: ["data persistence"],
        file: "src/data.ts",
        exported: true,
        params: [{ name: "record", type: "object" }],
        returnType: "string",
    },
    // Non-exported function — should be skipped
    {
        name: "internalHelper",
        purpose: "Internal helper — not exported",
        tags: [],
        requires: [],
        produces: [],
        file: "src/internal.ts",
        exported: false,
        params: [],
        returnType: "void",
    },
];
(0, vitest_1.describe)("selectCapabilityChains", () => {
    (0, vitest_1.it)("returns chains for an auth intent", () => {
        const { chains } = (0, strategy_planner_1.selectCapabilityChains)("authenticate user", mockIR, 3);
        (0, vitest_1.expect)(chains.length).toBeGreaterThan(0);
        // Should find at least validatePassword or generateJWT
        const names = chains.flatMap(c => c.nodes.map(n => n.name));
        (0, vitest_1.expect)(names.some(n => n.includes("validate") || n.includes("JWT"))).toBe(true);
    });
    (0, vitest_1.it)("returns chains for a data intent", () => {
        const { chains } = (0, strategy_planner_1.selectCapabilityChains)("fetch user data", mockIR, 3);
        (0, vitest_1.expect)(chains.length).toBeGreaterThan(0);
        const names = chains.flatMap(c => c.nodes.map(n => n.name));
        (0, vitest_1.expect)(names.some(n => n.includes("fetchUser"))).toBe(true);
    });
    (0, vitest_1.it)("respects maxChains limit", () => {
        const { chains } = (0, strategy_planner_1.selectCapabilityChains)("data", mockIR, 1);
        (0, vitest_1.expect)(chains.length).toBeLessThanOrEqual(1);
    });
    (0, vitest_1.it)("skips planner internals (self-referential guard)", () => {
        const selfIR = [{
                name: "selectCapabilityChains",
                purpose: "planner logic",
                tags: [],
                requires: [],
                produces: [],
                file: "src/strategy-planner.ts",
                exported: true,
                params: [],
                returnType: "any",
            }];
        const { chains } = (0, strategy_planner_1.selectCapabilityChains)("planning", selfIR, 3);
        // strategy-planner.ts and planner.ts should be filtered out
        const names = chains.flatMap(c => c.nodes.map(n => n.name));
        (0, vitest_1.expect)(names).not.toContain("selectCapabilityChains");
    });
});
(0, vitest_1.describe)("selectCapabilityChains — edge cases", () => {
    (0, vitest_1.it)("returns empty array for null intent", () => {
        (0, vitest_1.expect)((0, strategy_planner_1.selectCapabilityChains)(null, mockIR)).toEqual({ chains: [], needsLLM: false });
    });
    (0, vitest_1.it)("returns empty array for undefined intent", () => {
        (0, vitest_1.expect)((0, strategy_planner_1.selectCapabilityChains)(undefined, mockIR)).toEqual({ chains: [], needsLLM: false });
    });
    (0, vitest_1.it)("returns empty array for empty string intent", () => {
        (0, vitest_1.expect)((0, strategy_planner_1.selectCapabilityChains)("", mockIR)).toEqual({ chains: [], needsLLM: false });
    });
    (0, vitest_1.it)("returns empty array for whitespace-only intent", () => {
        (0, vitest_1.expect)((0, strategy_planner_1.selectCapabilityChains)("   ", mockIR)).toEqual({ chains: [], needsLLM: false });
    });
});
(0, vitest_1.describe)("formatChainHint", () => {
    (0, vitest_1.it)("returns empty string for empty chains", () => {
        (0, vitest_1.expect)((0, strategy_planner_1.formatChainHint)([])).toBe("");
    });
    (0, vitest_1.it)("formats a single chain", () => {
        const { chains } = (0, strategy_planner_1.selectCapabilityChains)("authenticate user", mockIR, 1);
        const hint = (0, strategy_planner_1.formatChainHint)(chains);
        (0, vitest_1.expect)(hint).toContain("建议的下一步调用");
        (0, vitest_1.expect)(hint).toContain("★");
    });
});
