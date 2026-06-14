/**
 * Stress Test: Large Protocol Graphs
 *
 * Verifies Frontier BFS scales to 500-1000 node graphs
 * and stays within memory limits.
 */
import { describe, it, expect } from "vitest";
import { searchFrontier } from "../../src/protocol-frontier";
import { buildChainProtocol, buildTreeProtocol, buildGridProtocol } from "../helpers/large-protocol-builder";

describe("Stress: Large Protocol Graphs", () => {
  it("searches 200-state chain graph within 20ms", () => {
    const rules = buildChainProtocol(200);

    const start = performance.now();
    const result = searchFrontier(rules, ["S0"], ["S199"], 210);
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(20);
    expect(result.found).toBe(true);
    expect(result.actions.length).toBe(199);
  });

  it("searches 500-state chain graph within 100ms", () => {
    const rules = buildChainProtocol(500);

    const start = performance.now();
    const result = searchFrontier(rules, ["S0"], ["S499"], 510);
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(100);
    expect(result.found).toBe(true);
  });

  it("does not exceed 50MB memory for 500-state graph", () => {
    const rules = buildChainProtocol(500);

    const initialMem = process.memoryUsage().heapUsed;
    searchFrontier(rules, ["S0"], ["S499"], 510);
    const afterMem = process.memoryUsage().heapUsed;
    const deltaMB = (afterMem - initialMem) / (1024 * 1024);

    expect(deltaMB).toBeLessThan(50);
  });

  it("searches tree protocol (depth 4, branch 3 = 121 nodes)", () => {
    const rules = buildTreeProtocol(4, 3);

    const start = performance.now();
    const result = searchFrontier(rules, ["N0"], ["N120"], 100);
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(15);
    expect(result.found).toBe(true);
  });

  it("searches grid protocol (15x15 = 225 nodes)", () => {
    const rules = buildGridProtocol(15, 15);

    const start = performance.now();
    const result = searchFrontier(rules, ["C0"], ["C224"], 100);
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(100);
    expect(result.found).toBe(true);
  });
});
