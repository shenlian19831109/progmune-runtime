/**
 * Unit tests for strategy-planner pure functions.
 * Tests the graph-building and chain-selection logic in isolation.
 */
import { describe, it, expect } from "vitest";
import { selectCapabilityChains, formatChainHint } from "./strategy-planner";

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

describe("selectCapabilityChains", () => {
  it("returns chains for an auth intent", () => {
    const chains = selectCapabilityChains("authenticate user", mockIR, 3);
    expect(chains.length).toBeGreaterThan(0);
    // Should find at least validatePassword or generateJWT
    const names = chains.flatMap(c => c.nodes.map(n => n.name));
    expect(names.some(n => n.includes("validate") || n.includes("JWT"))).toBe(true);
  });

  it("returns chains for a data intent", () => {
    const chains = selectCapabilityChains("fetch user data", mockIR, 3);
    expect(chains.length).toBeGreaterThan(0);
    const names = chains.flatMap(c => c.nodes.map(n => n.name));
    expect(names.some(n => n.includes("fetchUser"))).toBe(true);
  });

  it("respects maxChains limit", () => {
    const chains = selectCapabilityChains("data", mockIR, 1);
    expect(chains.length).toBeLessThanOrEqual(1);
  });

  it("skips planner internals (self-referential guard)", () => {
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
    const chains = selectCapabilityChains("planning", selfIR, 3);
    // strategy-planner.ts and planner.ts should be filtered out
    const names = chains.flatMap(c => c.nodes.map(n => n.name));
    expect(names).not.toContain("selectCapabilityChains");
  });
});

describe("selectCapabilityChains — edge cases", () => {
  it("returns empty array for null intent", () => {
    expect(selectCapabilityChains(null as any, mockIR)).toEqual([]);
  });

  it("returns empty array for undefined intent", () => {
    expect(selectCapabilityChains(undefined as any, mockIR)).toEqual([]);
  });

  it("returns empty array for empty string intent", () => {
    expect(selectCapabilityChains("", mockIR)).toEqual([]);
  });

  it("returns empty array for whitespace-only intent", () => {
    expect(selectCapabilityChains("   ", mockIR)).toEqual([]);
  });
});

describe("formatChainHint", () => {
  it("returns empty string for empty chains", () => {
    expect(formatChainHint([])).toBe("");
  });

  it("formats a single chain", () => {
    const chains = selectCapabilityChains("authenticate user", mockIR, 1);
    const hint = formatChainHint(chains);
    expect(hint).toContain("推荐能力链");
    expect(hint).toContain("★");
  });
});
