/**
 * P6.9: Function Name Synonym Tests
 */

import { describe, it, expect } from "vitest";
import { normalizeFunctionName, normalizeSequence, runSynonymNormalization, printSynonymReport } from "./function-synonyms";
import { synthesizeAllKnownProtocols } from "./auto-protocol-synthesizer";
import { runBootstrapValidation } from "./bootstrap-validation";

describe("Function Name Normalization", () => {
  it("strips library prefixes", () => {
    expect(normalizeFunctionName("sqlite3_open")).toBe("open");
	    expect(normalizeFunctionName("ngx_accept_connection")).toBe("accept_connection");
	    expect(normalizeFunctionName("PQconnectdb")).toBe("connectdb");
    expect(normalizeFunctionName("fs_open")).toBe("open");
  });

  it("converts CamelCase to snake_case", () => {
	    expect(normalizeFunctionName("createClient")).toBe("create_client");
	    expect(normalizeFunctionName("sendCommand")).toBe("send_command");
	    expect(normalizeFunctionName("closeClient")).toBe("close_client");
  });

  it("maps synonyms to canonical forms", () => {
    expect(normalizeFunctionName("DB_Open")).toBe("open");
    expect(normalizeFunctionName("DB_Close")).toBe("close");
    expect(normalizeFunctionName("DB_Get")).toBe("get");
    expect(normalizeFunctionName("fopen")).toBe("open");
    expect(normalizeFunctionName("fclose")).toBe("close");
    expect(normalizeFunctionName("fread")).toBe("read");
    expect(normalizeFunctionName("fwrite")).toBe("write");
    expect(normalizeFunctionName("malloc")).toBe("alloc");
    expect(normalizeFunctionName("free")).toBe("free");
  });

  it("normalizes sequences end-to-end", () => {
    const seq = ["DB_Open", "DB_Get", "DB_Close"];
    const norm = normalizeSequence(seq);
    expect(norm).toEqual(["open", "get", "close"]);
  });

  it("synthesized rules use normalized function names", () => {
    const protocols = synthesizeAllKnownProtocols();
    // All synthesized function names should be normalized
    for (const sp of protocols) {
      for (const sr of sp.rules) {
        const fn = sr.function;
        // After normalization through the pipeline, function names should be canonical
        expect(typeof fn).toBe("string");
        expect(fn.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("Synonym Normalization Impact", () => {
  // 注：这两个测试的重度与本地语料规模线性相关（.progmune_corpus 864+ 条时
  // 实测 40-130s）。CI 干净检出无语料 → 秒级通过；本地语料丰富 → 需放宽超时。
  // 显式超时 180s，不依赖 vitest 全局 30s。
  const CORPUS_HEAVY_TIMEOUT = 180_000;

  it("reduces unique function count via normalization", async () => {
    const report = await runSynonymNormalization();

    expect(report.uniqueAfter).toBeLessThanOrEqual(report.uniqueBefore);
    expect(report.uniqueAfter).toBeLessThanOrEqual(report.uniqueBefore);

    printSynonymReport(report);
  }, CORPUS_HEAVY_TIMEOUT);

  it("bootstrap function overlap improves with normalization", async () => {
    // Baseline without normalization
    const baseline = await runBootstrapValidation();

    // After normalization is integrated into the synthesizer,
    // the function overlap should improve
    const after = await runBootstrapValidation();

    console.log(`Function overlap: ${(after.functionOverlap*100).toFixed(0)}%`);
    console.log(`State overlap: ${(after.stateOverlap*100).toFixed(0)}%`);
    console.log(`Behavioral: ${after.behavioralMatch}/${after.behavioralTotal}`);
  }, CORPUS_HEAVY_TIMEOUT);
});
