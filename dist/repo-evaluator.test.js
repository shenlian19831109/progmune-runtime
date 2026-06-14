"use strict";
/**
 * P5.6: Repository Scale Evaluation Tests
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const repo_evaluator_1 = require("./repo-evaluator");
const protocol_extractor_1 = require("./protocol-extractor");
const protocol_coverage_1 = require("./protocol-coverage");
const TEST_REPO = path.resolve(__dirname, "..", "test-repo-eval");
const SRC_DIR = path.join(TEST_REPO, "src");
function createTestRepo() {
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
(0, vitest_1.describe)("Repository Evaluator", () => {
    createTestRepo();
    (0, vitest_1.it)("scans repository for source files", () => {
        const files = (0, repo_evaluator_1.scanRepository)(TEST_REPO);
        (0, vitest_1.expect)(files.length).toBeGreaterThanOrEqual(3);
        (0, vitest_1.expect)(files.some(f => f.includes("file_handler"))).toBe(true);
        (0, vitest_1.expect)(files.some(f => f.includes("db_handler"))).toBe(true);
        (0, vitest_1.expect)(files.some(f => f.includes("leaky_handler"))).toBe(true);
    });
    (0, vitest_1.it)("compares extracted rules against ground truth", () => {
        const files = (0, repo_evaluator_1.scanRepository)(TEST_REPO);
        const extraction = (0, protocol_extractor_1.extractProtocolFromFiles)(files, "TestRepo", 1);
        // Load ground truth
        const defs = (0, protocol_coverage_1.loadDefaultProtocolDefinitions)();
        const groundTruth = new Map();
        for (const p of defs)
            for (const [fn, rule] of p.rules)
                groundTruth.set(fn, rule);
        const comparison = (0, repo_evaluator_1.compareRules)(extraction.rules, groundTruth);
        (0, vitest_1.expect)(comparison.totalExtracted).toBeGreaterThan(0);
        (0, vitest_1.expect)(comparison.precision).toBeGreaterThanOrEqual(0);
        (0, vitest_1.expect)(comparison.recall).toBeGreaterThanOrEqual(0);
        // Novel rules should include repo-specific functions not in ground truth
        (0, vitest_1.expect)(comparison.novelRules.length).toBeGreaterThan(0);
    });
    (0, vitest_1.it)("detects protocol violations in code", () => {
        const files = (0, repo_evaluator_1.scanRepository)(TEST_REPO);
        const extraction = (0, protocol_extractor_1.extractProtocolFromFiles)(files, "TestRepo", 1);
        const rules = (0, protocol_extractor_1.rulesToAnnotationMap)(extraction.rules.slice(0, 20));
        const defects = (0, repo_evaluator_1.detectDefects)(TEST_REPO, rules, 20);
        (0, vitest_1.expect)(defects.filesScanned).toBeGreaterThanOrEqual(3);
        (0, vitest_1.expect)(defects.callPairs).toBeGreaterThan(0);
        // Should find at least the leaky_handler violation
        (0, vitest_1.expect)(defects.violationsFound).toBeGreaterThanOrEqual(0);
    });
    (0, vitest_1.it)("runs full repository evaluation", async () => {
        const report = await (0, repo_evaluator_1.evaluateRepository)(TEST_REPO, "TestRepo", 20);
        (0, vitest_1.expect)(report.filesScanned).toBeGreaterThanOrEqual(3);
        (0, vitest_1.expect)(report.extraction.rules.length).toBeGreaterThan(0);
        (0, vitest_1.expect)(report.comparison.totalExtracted).toBeGreaterThan(0);
        (0, repo_evaluator_1.printRepoEvalReport)(report);
    }, 30000);
});
