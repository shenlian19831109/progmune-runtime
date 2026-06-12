/**
 * Protocol Extraction Quality Gates
 *
 * Adversarial cases + regression thresholds.
 * Prevents extraction pipeline degradation.
 */
import { describe, it, expect } from "vitest";
import { extractCallPairs, inferProtocolRules, extractProtocol } from "../../src/protocol-extractor";
import { compareRules } from "../../src/repo-evaluator";
import { loadDefaultProtocolDefinitions } from "../../src/protocol-coverage";
import type { StateAnnotation } from "../../src/ssg-validator";

describe("Extraction: Adversarial Filtering", () => {
  it("filters application entrypoints (main)", () => {
    const code = `
      int main() {
        openFile();
        writeFile();
        closeFile();
      }
    `;
    const pairs = extractCallPairs(code);
    const rules = inferProtocolRules(pairs, 1); // minFreq=1 for small test
    const fns = new Set(rules.map(r => r.function));
    expect(fns.has("main")).toBe(false);
    expect(fns.has("openFile")).toBe(true);
  });

  it("filters logging/debug functions", () => {
    const code = `
      openFile();
      printf("debug: opened");
      readFile();
      console.log("data read");
      closeFile();
    `;
    const pairs = extractCallPairs(code);
    const rules = inferProtocolRules(pairs, 1);
    const fns = new Set(rules.map(r => r.function));
    expect(fns.has("printf")).toBe(false);
    expect(fns.has("console")).toBe(false);
  });

  it("filters one-liner helper wrappers", () => {
    const code = `
      function write_config(path, data) {
        const f = open(path);
        write(f, data);
        close(f);
      }
    `;
    const pairs = extractCallPairs(code);
    const rules = inferProtocolRules(pairs, 1);
    const fns = new Set(rules.map(r => r.function));
    // write_config is a wrapper, not a protocol function
    expect(fns.has("write_config")).toBe(false);
  });

  it("filters test/assert helpers", () => {
    const code = `
      openFile();
      assert(fileExists);
      expect(data).toBeDefined();
      it("should work", () => {});
      closeFile();
    `;
    const pairs = extractCallPairs(code);
    const rules = inferProtocolRules(pairs, 1);
    const fns = new Set(rules.map(r => r.function));
    expect(fns.has("assert")).toBe(false);
    expect(fns.has("expect")).toBe(false);
    expect(fns.has("it")).toBe(false);
  });
});

describe("Extraction: Quality Gate Regression", () => {
  it("precision gate: extraction finds protocol functions", () => {
    const code = `
      void process() {
        FILE* f = fopen("x", "r");
        fread(buf, 1, 1024, f);
        fclose(f);
      }
      void query() {
        DB* db = db_connect("localhost");
        db_query(db, "SELECT 1");
        db_close(db);
      }
    `;
    const pairs = extractCallPairs(code);
    const rules = inferProtocolRules(pairs, 1);
    const fns = new Set(rules.map(r => r.function));

    // At minimum, must find fopen, fread, fclose (actual protocol functions)
    expect(fns.has("fopen")).toBe(true);
    expect(fns.has("fclose")).toBe(true);
    // Must NOT include builtins
    expect(fns.has("main")).toBe(false);
    expect(fns.has("printf")).toBe(false);

    // Precision: extracted that are real protocol fns / total extracted
    const protocolFns = ["fopen", "fread", "fwrite", "fclose", "fopen", "db_connect", "db_query", "db_close"];
    const extractedProtocol = rules.filter(r => protocolFns.includes(r.function)).length;
    const precision = rules.length > 0 ? extractedProtocol / rules.length : 0;
    expect(precision).toBeGreaterThan(0.3);
  });

  it("recall gate: extraction recovers known protocol functions", () => {
    const code = `
      void process() {
        FILE* f = fopen("x", "r");
        fread(buf, 1, 1024, f);
        fclose(f);
      }
    `;
    const pairs = extractCallPairs(code);
    const rules = inferProtocolRules(pairs, 1);
    const fns = new Set(rules.map(r => r.function));

    // fopen, fread, fclose are real protocol functions that should be extracted
    expect(fns.has("fopen")).toBe(true);
    expect(fns.has("fread")).toBe(true);
    expect(fns.has("fclose")).toBe(true);

    // Recall: of the known file protocol functions in the code, how many were found?
    const expected = ["fopen", "fread", "fclose"];
    const found = expected.filter(fn => fns.has(fn)).length;
    const recall = found / expected.length;
    expect(recall).toBeGreaterThan(0.66); // at least 2/3
  });

  it("F1 gate: balanced precision+recall meets threshold", () => {
    const code = `
      void process() {
        FILE* f = fopen("x", "r");
        fread(buf, 1, 1024, f);
        fclose(f);
      }
      void db_work() {
        DB* db = db_connect("localhost");
        db_query(db, "SELECT 1");
        db_close(db);
      }
    `;
    const pairs = extractCallPairs(code);
    const rules = inferProtocolRules(pairs, 1);
    const fns = new Set(rules.map(r => r.function));

    // Should find at least fopen/fread/fclose or db equivalents
    const protocolFns = ["fopen", "fread", "fclose", "db_connect", "db_query", "db_close"];
    const extracted = rules.filter(r => protocolFns.includes(r.function)).length;
    const precision = rules.length > 0 ? extracted / rules.length : 0;

    // F1 with reasonable recall
    const expected = 6;
    const found = protocolFns.filter(fn => fns.has(fn)).length;
    const recall = found / expected;
    const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;

    expect(f1).toBeGreaterThan(0.15);
  });
});
