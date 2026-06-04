/**
 * Unit tests for terminal-format.ts — pure formatting functions.
 */
import { describe, it, expect } from "vitest";
import {
  G, R, Y, C_, D, B,
  pad, barChart, aclBadge, svlLabel, describeSVLLayer,
  COLORS,
} from "./terminal-format";

describe("color helpers", () => {
  it("G wraps text in green ANSI codes", () => {
    expect(G("OK")).toContain(COLORS.green);
    expect(G("OK")).toContain(COLORS.reset);
  });

  it("R wraps text in red ANSI codes", () => {
    expect(R("ERR")).toContain(COLORS.red);
  });

  it("Y wraps text in yellow ANSI codes", () => {
    expect(Y("WARN")).toContain(COLORS.yellow);
  });

  it("B wraps text in bold ANSI codes", () => {
    expect(B("TITLE")).toContain(COLORS.bold);
  });

  it("D wraps text in gray", () => {
    expect(D("dim")).toContain(COLORS.gray);
  });

  it("C_ wraps text in cyan", () => {
    expect(C_("info")).toContain(COLORS.cyan);
  });
});

describe("pad", () => {
  it("pads short string to given width", () => {
    expect(pad("ab", 5).length).toBeGreaterThanOrEqual(5);
  });

  it("does not truncate longer strings", () => {
    const result = pad("hello world", 5);
    expect(result.length).toBeGreaterThanOrEqual(11);
  });
});

describe("barChart", () => {
  it("shows full bar at 100%", () => {
    const chart = barChart(10, 10);
    expect(chart).toContain("100%");
    expect(chart).toContain("█");
  });

  it("shows 0% for zero count", () => {
    const chart = barChart(0, 10);
    expect(chart).toContain("0%");
  });

  it("returns a non-empty string", () => {
    expect(barChart(5, 10).length).toBeGreaterThan(0);
  });
});

describe("aclBadge", () => {
  it("returns green for ACL-4", () => {
    const badge = aclBadge("ACL-4");
    expect(badge).toContain("ACL-4");
  });

  it("returns dim for unknown level", () => {
    const badge = aclBadge("UNKNOWN");
    expect(badge.length).toBeGreaterThan(0);
  });
});

describe("svlLabel", () => {
  it("returns colored SVL-1", () => {
    expect(svlLabel("SVL-1")).toContain("SVL-1");
  });

  it("returns colored SVL-4", () => {
    expect(svlLabel("SVL-4")).toContain("SVL-4");
  });

  it("returns raw string for unknown SVL", () => {
    expect(svlLabel("SVL-99")).toBe("SVL-99");
  });
});

describe("describeSVLLayer", () => {
  it("describes SVL-1 in Chinese", () => {
    expect(describeSVLLayer("SVL-1")).toContain("符号");
  });

  it("describes SVL-4 as protocol", () => {
    expect(describeSVLLayer("SVL-4")).toContain("协议");
  });

  it("returns 未知 for unknown level", () => {
    expect(describeSVLLayer("NOPE")).toBe("未知");
  });
});
