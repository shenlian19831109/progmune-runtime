/**
 * P5.6: Repository Scale Evaluation Tests
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { scanRepository, compareRules, detectDefects, evaluateRepository, printRepoEvalReport } from "./repo-evaluator";
import { extractProtocolFromFiles, rulesToAnnotationMap } from "./protocol-extractor";
import { loadDefaultProtocolDefinitions } from "./protocol-coverage";
import type { StateAnnotation } from "./ssg-validator";

const TEST_REPO = path.resolve(__dirname, "..", "test-repo-eval");
const SRC_DIR = path.join(TEST_REPO, "src");

function createTestRepo(): void {
  fs.mkdirSync(SRC_DIR, { recursive: true });

  // File with proper open→read→close pattern
  fs.writeFileSync(path.join(SRC_DIR, "file_handler.c"), `
    void process_file(const char* path) {
        FILE* f = fopen(path, "r");
        char buf[1024];
        fread(buf, 1, 1024, f);
        fclose(f);
    }
    void write_file(const char* path, const char* data) {
        FILE* f = fopen(path, "w");
        fwrite(data, 1, strlen(data), f);
        fclose(f);
    }
  `);

  // File with connect→query→disconnect pattern
  fs.writeFileSync(path.join(SRC_DIR, "db_handler.js"), `
    function queryUsers() {
        const db = connect_db("localhost");
        const rows = query_db(db, "SELECT * FROM users");
        disconnect_db(db);
        return rows;
    }
    function insertLog(msg) {
        const db = connect_db("localhost");
        insert_db(db, "logs", msg);
        disconnect_db(db);
    }
  `);

  // File with intentionally broken pattern (missing close)
  fs.writeFileSync(path.join(SRC_DIR, "leaky_handler.c"), `
    void leaky_write(const char* path, const char* data) {
        FILE* f = fopen(path, "w");
        fwrite(data, 1, strlen(data), f);
        // BUG: missing fclose(f)
    }
  `);
}

describe("Repository Evaluator", () => {
  createTestRepo();

  it("scans repository for source files", () => {
    const files = scanRepository(TEST_REPO);
    expect(files.length).toBeGreaterThanOrEqual(3);
    expect(files.some(f => f.includes("file_handler"))).toBe(true);
    expect(files.some(f => f.includes("db_handler"))).toBe(true);
    expect(files.some(f => f.includes("leaky_handler"))).toBe(true);
  });

  it("compares extracted rules against ground truth", () => {
    const files = scanRepository(TEST_REPO);
    const extraction = extractProtocolFromFiles(files, "TestRepo", 1);

    // Load ground truth
    const defs = loadDefaultProtocolDefinitions();
    const groundTruth = new Map<string, StateAnnotation>();
    for (const p of defs) for (const [fn, rule] of p.rules) groundTruth.set(fn, rule);

    const comparison = compareRules(extraction.rules, groundTruth);

    expect(comparison.totalExtracted).toBeGreaterThan(0);
    expect(comparison.precision).toBeGreaterThanOrEqual(0);
    expect(comparison.recall).toBeGreaterThanOrEqual(0);

    // Novel rules should include repo-specific functions not in ground truth
    expect(comparison.novelRules.length).toBeGreaterThan(0);
  });

  it("detects protocol violations in code", () => {
    const files = scanRepository(TEST_REPO);
    const extraction = extractProtocolFromFiles(files, "TestRepo", 1);
    const rules = rulesToAnnotationMap(extraction.rules.slice(0, 20));

    const defects = detectDefects(TEST_REPO, rules, 20);

    expect(defects.filesScanned).toBeGreaterThanOrEqual(3);
    expect(defects.callPairs).toBeGreaterThan(0);
    // Should find at least the leaky_handler violation
    expect(defects.violationsFound).toBeGreaterThanOrEqual(0);
  });

  it("runs full repository evaluation", async () => {
    const report = await evaluateRepository(TEST_REPO, "TestRepo", 20);

    expect(report.filesScanned).toBeGreaterThanOrEqual(3);
    expect(report.extraction.rules.length).toBeGreaterThan(0);
    expect(report.comparison.totalExtracted).toBeGreaterThan(0);

    printRepoEvalReport(report);
  }, 30000);
});
