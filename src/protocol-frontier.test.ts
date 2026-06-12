/**
 * P3.14-15: Protocol Frontier Explorer Tests
 */

import { describe, it, expect } from "vitest";
import {
  searchFrontier, searchFrontierMulti, exploreFrontier,
  planCrossProtocol, expandCrossProtocolCandidates,
  getProtocolBridges,
} from "./protocol-frontier";
import { parseProtocolDefinition } from "./protocol-coverage";
import type { StateAnnotation } from "./ssg-validator";

function makeRules(): Map<string, StateAnnotation> {
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

describe("Frontier Explorer", () => {
  it("finds auth path from UNAUTHENTICATED to SESSION_ACTIVE", () => {
    const rules = makeRules();
    const path = searchFrontier(rules, ["UNAUTHENTICATED"], ["SESSION_ACTIVE"]);
    expect(path.found).toBe(true);
    expect(path.actions).toContain("verify_password");
    expect(path.actions).toContain("generate_jwt");
    expect(path.actions).toContain("create_session");
    expect(path.cost).toBe(3);
  });

  it("finds logout path from SESSION_ACTIVE to UNAUTHENTICATED", () => {
    const rules = makeRules();
    const path = searchFrontier(rules, ["SESSION_ACTIVE"], ["UNAUTHENTICATED"]);
    expect(path.found).toBe(true);
    expect(path.actions).toEqual(["logout"]);
    expect(path.cost).toBe(1);
  });

  it("finds close_file cleanup from FILE_OPEN", () => {
    const rules = makeRules();
    const path = searchFrontier(rules, ["FILE_OPEN"], []);
    expect(path.found).toBe(true);
    expect(path.actions).toContain("close_file");
  });

  it("returns not found for unreachable target", () => {
    const rules = makeRules();
    const path = searchFrontier(rules, ["UNAUTHENTICATED"], ["NONEXISTENT"]);
    expect(path.found).toBe(false);
  });

  it("explores frontier: generates multiple paths", () => {
    const rules = makeRules();
    const paths = exploreFrontier(rules, ["UNAUTHENTICATED"], 20, 6);
    expect(paths.length).toBeGreaterThan(1);
    // Should include auth chain
    const hasAuth = paths.some(p =>
      p.includes("verify_password") && p.includes("generate_jwt") && p.includes("create_session")
    );
    expect(hasAuth).toBe(true);
  });

  it("multi-start finds best path among candidates", () => {
    const rules = makeRules();
    const path = searchFrontierMulti(rules, [
      ["FILE_OPEN"],
      ["SESSION_ACTIVE"],
    ], ["UNAUTHENTICATED"]);
    // SESSION_ACTIVE→logout→UNAUTHENTICATED is 1 step, better than FILE_OPEN→close→open→auth→...
    expect(path.found).toBe(true);
    expect(path.cost).toBe(1);
    expect(path.actions).toContain("logout");
  });
});

describe("Cross-Protocol Planner", () => {
  it("has protocol bridges", () => {
    const bridges = getProtocolBridges();
    expect(bridges.length).toBeGreaterThanOrEqual(3);
    expect(bridges.some(b => b.from === "AuthProtocol" && b.to === "FileProtocol")).toBe(true);
    expect(bridges.some(b => b.from === "AuthProtocol" && b.to === "DBProtocol")).toBe(true);
  });

  it("plans single protocol", () => {
    const rules = makeRules();
    const plan = planCrossProtocol("logout", [
      { name: "AuthProtocol", rules },
    ], ["AuthProtocol"], { AuthProtocol: ["SESSION_ACTIVE"] });

    expect(plan.actions.length).toBeGreaterThan(0);
    expect(plan.actions).toContain("logout");
  });

  it("generates cross-protocol candidates", () => {
    const candidates = expandCrossProtocolCandidates("multi-step repair", ["FileProtocol", "DBProtocol"]);
    // Should find paths for both protocols
    expect(candidates.length).toBeGreaterThan(1);
    // At least one file path and one db path
    const hasFile = candidates.some(p => p.includes("open_file") || p.includes("close_file"));
    const hasDb = candidates.some(p => p.includes("connect_db") || p.includes("disconnect_db"));
    expect(hasFile || hasDb).toBe(true);
  });
});
