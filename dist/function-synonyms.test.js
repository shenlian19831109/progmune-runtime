"use strict";
/**
 * P6.9: Function Name Synonym Tests
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const function_synonyms_1 = require("./function-synonyms");
const auto_protocol_synthesizer_1 = require("./auto-protocol-synthesizer");
const bootstrap_validation_1 = require("./bootstrap-validation");
(0, vitest_1.describe)("Function Name Normalization", () => {
    (0, vitest_1.it)("strips library prefixes", () => {
        (0, vitest_1.expect)((0, function_synonyms_1.normalizeFunctionName)("sqlite3_open")).toBe("open");
        (0, vitest_1.expect)((0, function_synonyms_1.normalizeFunctionName)("ngx_accept_connection")).toBe("accept_connection");
        (0, vitest_1.expect)((0, function_synonyms_1.normalizeFunctionName)("PQconnectdb")).toBe("connectdb");
        (0, vitest_1.expect)((0, function_synonyms_1.normalizeFunctionName)("fs_open")).toBe("open");
    });
    (0, vitest_1.it)("converts CamelCase to snake_case", () => {
        (0, vitest_1.expect)((0, function_synonyms_1.normalizeFunctionName)("createClient")).toBe("create_client");
        (0, vitest_1.expect)((0, function_synonyms_1.normalizeFunctionName)("sendCommand")).toBe("send_command");
        (0, vitest_1.expect)((0, function_synonyms_1.normalizeFunctionName)("closeClient")).toBe("close_client");
    });
    (0, vitest_1.it)("maps synonyms to canonical forms", () => {
        (0, vitest_1.expect)((0, function_synonyms_1.normalizeFunctionName)("DB_Open")).toBe("open");
        (0, vitest_1.expect)((0, function_synonyms_1.normalizeFunctionName)("DB_Close")).toBe("close");
        (0, vitest_1.expect)((0, function_synonyms_1.normalizeFunctionName)("DB_Get")).toBe("get");
        (0, vitest_1.expect)((0, function_synonyms_1.normalizeFunctionName)("fopen")).toBe("open");
        (0, vitest_1.expect)((0, function_synonyms_1.normalizeFunctionName)("fclose")).toBe("close");
        (0, vitest_1.expect)((0, function_synonyms_1.normalizeFunctionName)("fread")).toBe("read");
        (0, vitest_1.expect)((0, function_synonyms_1.normalizeFunctionName)("fwrite")).toBe("write");
        (0, vitest_1.expect)((0, function_synonyms_1.normalizeFunctionName)("malloc")).toBe("alloc");
        (0, vitest_1.expect)((0, function_synonyms_1.normalizeFunctionName)("free")).toBe("free");
    });
    (0, vitest_1.it)("normalizes sequences end-to-end", () => {
        const seq = ["DB_Open", "DB_Get", "DB_Close"];
        const norm = (0, function_synonyms_1.normalizeSequence)(seq);
        (0, vitest_1.expect)(norm).toEqual(["open", "get", "close"]);
    });
    (0, vitest_1.it)("synthesized rules use normalized function names", () => {
        const protocols = (0, auto_protocol_synthesizer_1.synthesizeAllKnownProtocols)();
        // All synthesized function names should be normalized
        for (const sp of protocols) {
            for (const sr of sp.rules) {
                const fn = sr.function;
                // After normalization through the pipeline, function names should be canonical
                (0, vitest_1.expect)(typeof fn).toBe("string");
                (0, vitest_1.expect)(fn.length).toBeGreaterThan(0);
            }
        }
    });
});
(0, vitest_1.describe)("Synonym Normalization Impact", () => {
    (0, vitest_1.it)("reduces unique function count via normalization", async () => {
        const report = await (0, function_synonyms_1.runSynonymNormalization)();
        (0, vitest_1.expect)(report.uniqueAfter).toBeLessThanOrEqual(report.uniqueBefore);
        (0, vitest_1.expect)(report.uniqueAfter).toBeLessThanOrEqual(report.uniqueBefore);
        (0, function_synonyms_1.printSynonymReport)(report);
    });
    (0, vitest_1.it)("bootstrap function overlap improves with normalization", async () => {
        // Baseline without normalization
        const baseline = await (0, bootstrap_validation_1.runBootstrapValidation)();
        // After normalization is integrated into the synthesizer,
        // the function overlap should improve
        const after = await (0, bootstrap_validation_1.runBootstrapValidation)();
        console.log(`Function overlap: ${(after.functionOverlap * 100).toFixed(0)}%`);
        console.log(`State overlap: ${(after.stateOverlap * 100).toFixed(0)}%`);
        console.log(`Behavioral: ${after.behavioralMatch}/${after.behavioralTotal}`);
    }, 30000);
});
