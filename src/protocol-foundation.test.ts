/**
 * P6.0: Protocol Foundation Model Tests
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { inferStateName, inferEnhancedRules, extractProtocolFoundation, enhancedRulesToMap, measureDiscoveryImpact, printFoundationReport } from "./protocol-foundation";
import { extractCallPairs } from "./protocol-extractor";

const FOUND_DIR = path.resolve(__dirname, "..", "test-protocol-foundation");
fs.mkdirSync(FOUND_DIR, { recursive: true });

function createTestRepo(): string {
  const srcDir = path.join(FOUND_DIR, "src");
  fs.mkdirSync(srcDir, { recursive: true });

  // File protocol pattern
  fs.writeFileSync(path.join(srcDir, "file_ops.c"), `
    void read_config(const char* path) {
        FILE* f = fopen(path, "r");
        char buf[1024];
        fread(buf, 1, 1024, f);
        fclose(f);
    }
    void write_config(const char* path, const char* data) {
        FILE* f = fopen(path, "w");
        fwrite(data, 1, strlen(data), f);
        fflush(f);
        fclose(f);
    }
  `);

  // DB protocol pattern
  fs.writeFileSync(path.join(srcDir, "db_ops.js"), `
    function queryUsers() {
        const db = db_connect("localhost");
        const rows = db_query(db, "SELECT * FROM users");
        db_disconnect(db);
    }
    function insertLog(msg) {
        const db = db_connect("localhost");
        db_insert(db, "logs", msg);
        db_disconnect(db);
    }
  `);

  // Auth protocol pattern
  fs.writeFileSync(path.join(srcDir, "auth_flow.c"), `
    int authenticate(const char* user, const char* pass) {
        if (!verify_password(user, pass)) return 0;
        char* token = generate_jwt(user);
        session_t* sess = create_session(token);
        return sess ? 1 : 0;
    }
    void do_logout(session_t* sess) {
        logout(sess);
    }
  `);

  return FOUND_DIR;
}

describe("Protocol Foundation Model", () => {
  createTestRepo();

  it("infers intelligent state names", () => {
    expect(inferStateName("fopen", "post")).toBe("FILE_OPEN");
    expect(inferStateName("fclose", "invalidate")).toBe("FILE_CLOSED");
    expect(inferStateName("db_connect", "post")).toBe("DB_CONNECTED");
    expect(inferStateName("verify_password", "post")).toBe("AUTH_VERIFIED");
    expect(inferStateName("generate_jwt", "post")).toBe("AUTH_ISSUED");
    expect(inferStateName("create_session", "post")).toBe("AUTH_CREATED");
    expect(inferStateName("logout", "invalidate")).toBe("AUTH_UNAUTHENTICATED");
  });

  it("infers enhanced rules with domain-specific states", () => {
    const code = `
      FILE* f = fopen("x", "r");
      fread(buf, 1, 1024, f);
      fclose(f);

      DB* db = db_connect("localhost");
      db_query(db, "SELECT 1");
      db_disconnect(db);
    `;
    const pairs = extractCallPairs(code);
    const rules = inferEnhancedRules(pairs, 1);

    expect(rules.length).toBeGreaterThan(0);

    // fopen should produce FILE_OPEN
    const fopen = rules.find(r => r.function === "fopen");
    expect(fopen).toBeDefined();
    expect(fopen!.domain).toBe("FILE");
    expect(fopen!.post_states).toContain("FILE_OPEN");

    // fclose should invalidate FILE_OPEN
    const fclose = rules.find(r => r.function === "fclose");
    expect(fclose).toBeDefined();
    expect(fclose!.invalidate).toBeDefined();

    // db_connect should produce DB_CONNECTED
    const dbConn = rules.find(r => r.function === "db_connect");
    expect(dbConn).toBeDefined();
    expect(dbConn!.domain).toBe("DB");
  });

  it("extracts protocol foundation from test repository", () => {
    const result = extractProtocolFoundation(FOUND_DIR, "TestFoundation", 20, 1);

    expect(result.rules.length).toBeGreaterThan(0);
    expect(result.states.length).toBeGreaterThan(0);
    expect(result.totalPairs).toBeGreaterThan(0);
    expect(result.avgConfidence).toBeGreaterThan(0);

    // Should have FILE states
    expect(result.states.some(s => s.includes("FILE"))).toBe(true);
    // Should have DB states
    expect(result.states.some(s => s.includes("DB"))).toBe(true);

    // Hand-written overlap: fopen/fread/fwrite/fclose match ground truth
    expect(result.handWrittenOverlap).toBeGreaterThanOrEqual(2);

    printFoundationReport(result);
  });

  it("converts enhanced rules to SSG-compatible map", () => {
    const code = `FILE* f = fopen("x", "r"); fclose(f);`;
    const pairs = extractCallPairs(code);
    const rules = inferEnhancedRules(pairs, 1);
    const map = enhancedRulesToMap(rules);

    expect(map.size).toBeGreaterThan(0);
    const fopenRule = map.get("fopen");
    expect(fopenRule).toBeDefined();
    expect(fopenRule!.post_states.length).toBeGreaterThan(0);
  });

  it("measures discovery impact of extracted rules", async () => {
    const code = `FILE* f = fopen("x", "r"); fclose(f);`;
    const pairs = extractCallPairs(code);
    const rules = inferEnhancedRules(pairs, 1);
    const map = enhancedRulesToMap(rules);

    const impact = await measureDiscoveryImpact(map);

    expect(impact.baseline.discoveryRate).toBeGreaterThanOrEqual(0);
    expect(impact.rulesAdded).toBeGreaterThanOrEqual(0);

    printFoundationReport(
      { protocol: "test", rules, states: [], sourceFiles: [], totalPairs: pairs.length, avgConfidence: 1, handWrittenOverlap: 1, novelRulesCount: impact.rulesAdded },
      impact
    );
  }, 30000);
});
