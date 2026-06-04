"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Unit tests for terminal-format.ts — pure formatting functions.
 */
const vitest_1 = require("vitest");
const terminal_format_1 = require("./terminal-format");
(0, vitest_1.describe)("color helpers", () => {
    (0, vitest_1.it)("G wraps text in green ANSI codes", () => {
        (0, vitest_1.expect)((0, terminal_format_1.G)("OK")).toContain(terminal_format_1.COLORS.green);
        (0, vitest_1.expect)((0, terminal_format_1.G)("OK")).toContain(terminal_format_1.COLORS.reset);
    });
    (0, vitest_1.it)("R wraps text in red ANSI codes", () => {
        (0, vitest_1.expect)((0, terminal_format_1.R)("ERR")).toContain(terminal_format_1.COLORS.red);
    });
    (0, vitest_1.it)("Y wraps text in yellow ANSI codes", () => {
        (0, vitest_1.expect)((0, terminal_format_1.Y)("WARN")).toContain(terminal_format_1.COLORS.yellow);
    });
    (0, vitest_1.it)("B wraps text in bold ANSI codes", () => {
        (0, vitest_1.expect)((0, terminal_format_1.B)("TITLE")).toContain(terminal_format_1.COLORS.bold);
    });
    (0, vitest_1.it)("D wraps text in gray", () => {
        (0, vitest_1.expect)((0, terminal_format_1.D)("dim")).toContain(terminal_format_1.COLORS.gray);
    });
    (0, vitest_1.it)("C_ wraps text in cyan", () => {
        (0, vitest_1.expect)((0, terminal_format_1.C_)("info")).toContain(terminal_format_1.COLORS.cyan);
    });
});
(0, vitest_1.describe)("pad", () => {
    (0, vitest_1.it)("pads short string to given width", () => {
        (0, vitest_1.expect)((0, terminal_format_1.pad)("ab", 5).length).toBeGreaterThanOrEqual(5);
    });
    (0, vitest_1.it)("does not truncate longer strings", () => {
        const result = (0, terminal_format_1.pad)("hello world", 5);
        (0, vitest_1.expect)(result.length).toBeGreaterThanOrEqual(11);
    });
});
(0, vitest_1.describe)("barChart", () => {
    (0, vitest_1.it)("shows full bar at 100%", () => {
        const chart = (0, terminal_format_1.barChart)(10, 10);
        (0, vitest_1.expect)(chart).toContain("100%");
        (0, vitest_1.expect)(chart).toContain("█");
    });
    (0, vitest_1.it)("shows 0% for zero count", () => {
        const chart = (0, terminal_format_1.barChart)(0, 10);
        (0, vitest_1.expect)(chart).toContain("0%");
    });
    (0, vitest_1.it)("returns a non-empty string", () => {
        (0, vitest_1.expect)((0, terminal_format_1.barChart)(5, 10).length).toBeGreaterThan(0);
    });
});
(0, vitest_1.describe)("aclBadge", () => {
    (0, vitest_1.it)("returns green for ACL-4", () => {
        const badge = (0, terminal_format_1.aclBadge)("ACL-4");
        (0, vitest_1.expect)(badge).toContain("ACL-4");
    });
    (0, vitest_1.it)("returns dim for unknown level", () => {
        const badge = (0, terminal_format_1.aclBadge)("UNKNOWN");
        (0, vitest_1.expect)(badge.length).toBeGreaterThan(0);
    });
});
(0, vitest_1.describe)("svlLabel", () => {
    (0, vitest_1.it)("returns colored SVL-1", () => {
        (0, vitest_1.expect)((0, terminal_format_1.svlLabel)("SVL-1")).toContain("SVL-1");
    });
    (0, vitest_1.it)("returns colored SVL-4", () => {
        (0, vitest_1.expect)((0, terminal_format_1.svlLabel)("SVL-4")).toContain("SVL-4");
    });
    (0, vitest_1.it)("returns raw string for unknown SVL", () => {
        (0, vitest_1.expect)((0, terminal_format_1.svlLabel)("SVL-99")).toBe("SVL-99");
    });
});
(0, vitest_1.describe)("describeSVLLayer", () => {
    (0, vitest_1.it)("describes SVL-1 in Chinese", () => {
        (0, vitest_1.expect)((0, terminal_format_1.describeSVLLayer)("SVL-1")).toContain("符号");
    });
    (0, vitest_1.it)("describes SVL-4 as protocol", () => {
        (0, vitest_1.expect)((0, terminal_format_1.describeSVLLayer)("SVL-4")).toContain("协议");
    });
    (0, vitest_1.it)("returns 未知 for unknown level", () => {
        (0, vitest_1.expect)((0, terminal_format_1.describeSVLLayer)("NOPE")).toBe("未知");
    });
});
