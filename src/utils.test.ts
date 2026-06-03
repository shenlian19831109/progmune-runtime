/**
 * Unit tests for utility functions and pure-logic modules.
 * Demonstrates the Vitest pattern for Progmune.
 */
import { describe, it, expect } from "vitest";
import { jaccardSimilarity, extractKeywords } from "./utils";

// ── jaccardSimilarity ──

describe("jaccardSimilarity", () => {
  it("returns 1 for identical strings", () => {
    expect(jaccardSimilarity("hello", "hello")).toBeCloseTo(1, 1);
  });

  it("returns 0 for strings with no common characters", () => {
    expect(jaccardSimilarity("abc", "xyz")).toBe(0);
  });

  it("returns a value between 0 and 1 for partially overlapping strings", () => {
    const score = jaccardSimilarity("loginUser", "userLogin");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

// ── extractKeywords ──

describe("extractKeywords", () => {
  it("extracts Chinese words", () => {
    const kw = extractKeywords("验证用户密码并生成JWT令牌");
    expect(kw.some(k => k.includes("验证") || k.includes("用户"))).toBe(true);
  });

  it("extracts English words and camelCase tokens", () => {
    const kw = extractKeywords("authenticate user and generateToken");
    expect(kw.some(k => k.toLowerCase().includes("authenticate"))).toBe(true);
  });

  it("returns non-empty array for any input", () => {
    const kw = extractKeywords("hello world");
    expect(kw.length).toBeGreaterThan(0);
  });
});
