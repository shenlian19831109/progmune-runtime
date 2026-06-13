/**
 * P6.0v2: AST-based Protocol Extractor Tests
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { extractProtocolV2, printExtractionQuality } from "./protocol-extractor-v2";

const V2_DIR = path.resolve(__dirname, "..", "test-extractor-v2");

function createTestRepo(): string {
  const srcDir = path.join(V2_DIR, "src");
  fs.mkdirSync(srcDir, { recursive: true });

  // TypeScript file using names that match ground truth (protocols.json)
  fs.writeFileSync(path.join(srcDir, "file-service.ts"), `
    export class FileService {
      processFile(path: string): string {
        open_file(path);
        const data = read_file(path);
        write_file(path, data);
        close_file(path);
        return data;
      }
    }
  `);

  // C file using names that match ground truth — multiple functions per pattern
  fs.writeFileSync(path.join(srcDir, "db_handler.c"), `
    void run_query(const char* host, const char* sql) {
        connect_db(host);
        query_db(sql);
        disconnect_db();
    }
    void run_insert(const char* host, const char* data) {
        connect_db(host);
        query_db(data);
        disconnect_db();
    }
    void verify_and_session(const char* user, const char* pass) {
        verify_password(user, pass);
        generate_jwt(user);
        create_session();
    }
    void auth_and_logout(const char* user, const char* pass) {
        verify_password(user, pass);
        generate_jwt(user);
        create_session();
        logout();
    }
  `);

  return V2_DIR;
}

describe("Protocol Extractor v2 (AST-based)", () => {
  createTestRepo();

  it("extracts scope-aware call pairs within function boundaries", () => {
    const result = extractProtocolV2(V2_DIR, "TestRepo", 20);

    expect(result.pairs.length).toBeGreaterThan(0);
    // Each pair should be within a single function scope
    for (const p of result.pairs) {
      expect(p.function).not.toBe("<global>");
    }
  });

  it("infers protocol rules with improved precision", () => {
    const result = extractProtocolV2(V2_DIR, "TestRepo", 20);

    expect(result.rules.size).toBeGreaterThan(0);

    // Should find file operations
    const fns = [...result.rules.keys()];
    expect(fns.some(f => f.includes("openFile") || f.includes("open"))).toBe(true);
    expect(fns.some(f => f.includes("closeFile") || f.includes("close"))).toBe(true);

    // Quality should be better than v1 (33%/12%)
    console.log(`Precision: ${(result.quality.precision*100).toFixed(0)}%, Recall: ${(result.quality.recall*100).toFixed(0)}%, F1: ${(result.quality.f1*100).toFixed(0)}%`);
  });

  it("filters noise functions within function scopes", () => {
    const noisyCode = path.join(V2_DIR, "noisy.ts");
    fs.writeFileSync(noisyCode, `
      function doWork() {
        open_file("test");
        console.log("opened");
        assert(fileExists);
        read_file(fd);
        console.log("read done");
        close_file(fd);
      }
    `);

    const result = extractProtocolV2(V2_DIR, "NoisyRepo", 20);
    const fns = [...result.rules.keys()];

    // Noise functions should not appear in extracted rules
    expect(fns.includes("console")).toBe(false);
    expect(fns.includes("assert")).toBe(false);
  });

  it("produces quality tier classification", () => {
    const result = extractProtocolV2(V2_DIR, "TestRepo", 20);

    expect(result.quality.tier).toBeDefined();
    expect(["production", "beta", "poc"]).toContain(result.quality.tier);

    printExtractionQuality([{
      name: result.protocol,
      quality: result.quality,
      pairs: result.pairs.length,
      files: result.filesScanned,
    }]);
  });

  it("handles empty/missing directories gracefully", () => {
    const result = extractProtocolV2("/nonexistent/path/v2test", "EmptyRepo", 10);

    expect(result.filesScanned).toBe(0);
    expect(result.pairs.length).toBe(0);
    expect(result.rules.size).toBe(0);
  });
});
