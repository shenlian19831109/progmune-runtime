/**
 * Unit tests for the Result<T,E> type and factory functions.
 */
import { describe, it, expect } from "vitest";
import { ok, err } from "./runtime-types";
import type { Result, ValidationError } from "./runtime-types";

describe("Result type", () => {
  it("ok() returns { ok: true, value }", () => {
    const r = ok(42);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe(42);
  });

  it("err() returns { ok: false, error }", () => {
    const r = err("something broke");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("something broke");
  });

  it("supports discriminated union narrowing", () => {
    function divide(a: number, b: number): Result<number> {
      if (b === 0) return err("division by zero");
      return ok(a / b);
    }

    const good = divide(10, 2);
    if (good.ok) expect(good.value).toBe(5);

    const bad = divide(1, 0);
    if (!bad.ok) expect(bad.error).toBe("division by zero");
  });

  it("supports typed ValidationError", () => {
    const e: ValidationError = { message: "type mismatch", code: "SVL-2", index: 3 };
    const r = err([e]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error[0].code).toBe("SVL-2");
      expect(r.error[0].index).toBe(3);
    }
  });
});
