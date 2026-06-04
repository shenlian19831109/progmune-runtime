"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Unit tests for utility functions and pure-logic modules.
 * Demonstrates the Vitest pattern for Progmune.
 */
const vitest_1 = require("vitest");
const utils_1 = require("./utils");
// ── jaccardSimilarity ──
(0, vitest_1.describe)("jaccardSimilarity", () => {
    (0, vitest_1.it)("returns 1 for identical strings", () => {
        (0, vitest_1.expect)((0, utils_1.jaccardSimilarity)("hello", "hello")).toBeCloseTo(1, 1);
    });
    (0, vitest_1.it)("returns 0 for strings with no common characters", () => {
        (0, vitest_1.expect)((0, utils_1.jaccardSimilarity)("abc", "xyz")).toBe(0);
    });
    (0, vitest_1.it)("returns a value between 0 and 1 for partially overlapping strings", () => {
        const score = (0, utils_1.jaccardSimilarity)("loginUser", "userLogin");
        (0, vitest_1.expect)(score).toBeGreaterThan(0);
        (0, vitest_1.expect)(score).toBeLessThanOrEqual(1);
    });
});
// ── extractKeywords ──
(0, vitest_1.describe)("extractKeywords", () => {
    (0, vitest_1.it)("extracts Chinese words", () => {
        const kw = (0, utils_1.extractKeywords)("验证用户密码并生成JWT令牌");
        (0, vitest_1.expect)(kw.some(k => k.includes("验证") || k.includes("用户"))).toBe(true);
    });
    (0, vitest_1.it)("extracts English words and camelCase tokens", () => {
        const kw = (0, utils_1.extractKeywords)("authenticate user and generateToken");
        (0, vitest_1.expect)(kw.some(k => k.toLowerCase().includes("authenticate"))).toBe(true);
    });
    (0, vitest_1.it)("returns non-empty array for any input", () => {
        const kw = (0, utils_1.extractKeywords)("hello world");
        (0, vitest_1.expect)(kw.length).toBeGreaterThan(0);
    });
});
