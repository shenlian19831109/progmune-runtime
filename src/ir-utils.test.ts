/**
 * Unit tests for ir-utils.ts — IR helper functions.
 */
import { describe, it, expect } from "vitest";
import { countExported, mergeResults, loadIR } from "./ir-utils";

describe("countExported", () => {
  it("returns 0 for empty array", () => {
    expect(countExported([])).toBe(0);
  });

  it("counts only exported functions", () => {
    const ir = [
      { name: "a", exported: true },
      { name: "b", exported: false },
      { name: "c", exported: true },
      { name: "d" }, // no exported field → falsy
    ];
    expect(countExported(ir)).toBe(2);
  });

  it("returns 0 if all are internal", () => {
    expect(countExported([
      { name: "x", exported: false },
      { name: "y", exported: false },
    ])).toBe(0);
  });
});

describe("mergeResults", () => {
  it("returns object with first and second", () => {
    const r = mergeResults({ a: 1 }, { b: 2 });
    expect(r.first).toEqual({ a: 1 });
    expect(r.second).toEqual({ b: 2 });
  });

  it("works with primitives", () => {
    const r = mergeResults(42, "hello");
    expect(r.first).toBe(42);
    expect(r.second).toBe("hello");
  });
});

describe("loadIR", () => {
  it("returns empty array for non-existent file", () => {
    const result = loadIR("/nonexistent/path/ir.json");
    expect(result).toEqual([]);
  });

  it("returns empty array when no path matches", () => {
    // loadIR without a valid ir.json returns [] (file doesn't exist in test)
    const result = loadIR("/tmp/no-ir-here.json");
    expect(Array.isArray(result)).toBe(true);
  });
});
