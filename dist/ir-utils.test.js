"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Unit tests for ir-utils.ts — IR helper functions.
 */
const vitest_1 = require("vitest");
const ir_utils_1 = require("./ir-utils");
(0, vitest_1.describe)("countExported", () => {
    (0, vitest_1.it)("returns 0 for empty array", () => {
        (0, vitest_1.expect)((0, ir_utils_1.countExported)([])).toBe(0);
    });
    (0, vitest_1.it)("counts only exported functions", () => {
        const ir = [
            { name: "a", exported: true },
            { name: "b", exported: false },
            { name: "c", exported: true },
            { name: "d" }, // no exported field → falsy
        ];
        (0, vitest_1.expect)((0, ir_utils_1.countExported)(ir)).toBe(2);
    });
    (0, vitest_1.it)("returns 0 if all are internal", () => {
        (0, vitest_1.expect)((0, ir_utils_1.countExported)([
            { name: "x", exported: false },
            { name: "y", exported: false },
        ])).toBe(0);
    });
});
(0, vitest_1.describe)("mergeResults", () => {
    (0, vitest_1.it)("returns object with first and second", () => {
        const r = (0, ir_utils_1.mergeResults)({ a: 1 }, { b: 2 });
        (0, vitest_1.expect)(r.first).toEqual({ a: 1 });
        (0, vitest_1.expect)(r.second).toEqual({ b: 2 });
    });
    (0, vitest_1.it)("works with primitives", () => {
        const r = (0, ir_utils_1.mergeResults)(42, "hello");
        (0, vitest_1.expect)(r.first).toBe(42);
        (0, vitest_1.expect)(r.second).toBe("hello");
    });
});
(0, vitest_1.describe)("loadIR", () => {
    (0, vitest_1.it)("returns empty array for non-existent file", () => {
        const result = (0, ir_utils_1.loadIR)("/nonexistent/path/ir.json");
        (0, vitest_1.expect)(result).toEqual([]);
    });
    (0, vitest_1.it)("returns empty array when no path matches", () => {
        // loadIR without a valid ir.json returns [] (file doesn't exist in test)
        const result = (0, ir_utils_1.loadIR)("/tmp/no-ir-here.json");
        (0, vitest_1.expect)(Array.isArray(result)).toBe(true);
    });
});
