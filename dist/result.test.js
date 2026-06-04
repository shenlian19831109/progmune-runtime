"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Unit tests for the Result<T,E> type and factory functions.
 */
const vitest_1 = require("vitest");
const runtime_types_1 = require("./runtime-types");
(0, vitest_1.describe)("Result type", () => {
    (0, vitest_1.it)("ok() returns { ok: true, value }", () => {
        const r = (0, runtime_types_1.ok)(42);
        (0, vitest_1.expect)(r.ok).toBe(true);
        if (r.ok)
            (0, vitest_1.expect)(r.value).toBe(42);
    });
    (0, vitest_1.it)("err() returns { ok: false, error }", () => {
        const r = (0, runtime_types_1.err)("something broke");
        (0, vitest_1.expect)(r.ok).toBe(false);
        if (!r.ok)
            (0, vitest_1.expect)(r.error).toBe("something broke");
    });
    (0, vitest_1.it)("supports discriminated union narrowing", () => {
        function divide(a, b) {
            if (b === 0)
                return (0, runtime_types_1.err)("division by zero");
            return (0, runtime_types_1.ok)(a / b);
        }
        const good = divide(10, 2);
        if (good.ok)
            (0, vitest_1.expect)(good.value).toBe(5);
        const bad = divide(1, 0);
        if (!bad.ok)
            (0, vitest_1.expect)(bad.error).toBe("division by zero");
    });
    (0, vitest_1.it)("supports typed ValidationError", () => {
        const e = { message: "type mismatch", code: "SVL-2", index: 3 };
        const r = (0, runtime_types_1.err)([e]);
        (0, vitest_1.expect)(r.ok).toBe(false);
        if (!r.ok) {
            (0, vitest_1.expect)(r.error[0].code).toBe("SVL-2");
            (0, vitest_1.expect)(r.error[0].index).toBe(3);
        }
    });
});
