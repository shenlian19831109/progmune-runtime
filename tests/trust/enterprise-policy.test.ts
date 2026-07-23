/**
 * Phase 1: Enterprise Policy Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { loadEnterprisePolicyConfig } from "../../src/policy/engine";

describe("loadEnterprisePolicyConfig", () => {
  let tmpDir: string;

  function writePolicy(fileName: string, content: object): string {
    const filePath = path.join(tmpDir, fileName);
    fs.writeFileSync(filePath, JSON.stringify(content, null, 2));
    return filePath;
  }

  // Setup before each test
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "progmune-policy-test-"));
  });

  // Cleanup after each test
  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns defaults when no config file exists", () => {
    const result = loadEnterprisePolicyConfig(tmpDir);
    expect(result.isEnterprise).toBe(false);
    expect(result.rules).toEqual([]);
    expect(result.source).toContain("defaults");
  });

  it("detects enterprise format with enterprise rules", () => {
    writePolicy(".progmune-policy.json", {
      version: "1.0",
      name: "Enterprise Policy",
      rules: [],
      enterprise: [
        {
          id: "PAY_001",
          name: "No direct payment modification",
          severity: "critical",
          category: "payment",
          description: "AI must not directly modify payment records",
          policy_ref: "enterprise.payment.no-direct-modify",
          conditions: [
            { type: "api_call", pattern: "payment.execute" },
          ],
        },
      ],
    });

    const result = loadEnterprisePolicyConfig(tmpDir);
    expect(result.isEnterprise).toBe(true);
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0].id).toBe("PAY_001");
    expect(result.rules[0].severity).toBe("critical");
  });

  it("treats legacy format as non-enterprise", () => {
    writePolicy(".progmune-policy.json", {
      rules: [
        { type: "confidence", severity: "block", description: "Test" },
      ],
    });

    const result = loadEnterprisePolicyConfig(tmpDir);
    expect(result.isEnterprise).toBe(false);
    expect(result.rules).toEqual([]);
  });

  it("handles custom config path", () => {
    writePolicy("custom-policy.json", {
      version: "1.0",
      rules: [],
      enterprise: [
        {
          id: "AUTH_001",
          name: "Rate limit required",
          severity: "high",
          category: "authentication",
          description: "All auth endpoints must have rate limiting",
          policy_ref: "enterprise.auth.rate-limit",
        },
      ],
    });

    const result = loadEnterprisePolicyConfig(tmpDir, path.join(tmpDir, "custom-policy.json"));
    expect(result.isEnterprise).toBe(true);
    expect(result.rules).toHaveLength(1);
  });

  it("gracefully handles invalid JSON", () => {
    const filePath = path.join(tmpDir, ".progmune-policy.json");
    fs.writeFileSync(filePath, "not valid json {{{");

    const result = loadEnterprisePolicyConfig(tmpDir);
    expect(result.isEnterprise).toBe(false);
  });
});
