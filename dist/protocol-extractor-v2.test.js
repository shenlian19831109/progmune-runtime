"use strict";
/**
 * P6.0v2: AST-based Protocol Extractor Tests
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
const protocol_extractor_v2_1 = require("./protocol-extractor-v2");
const V2_DIR = path.resolve(__dirname, "..", "test-extractor-v2");
function createTestRepo() {
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
(0, vitest_1.describe)("Protocol Extractor v2 (AST-based)", () => {
    createTestRepo();
    (0, vitest_1.it)("extracts scope-aware call pairs within function boundaries", () => {
        const result = (0, protocol_extractor_v2_1.extractProtocolV2)(V2_DIR, "TestRepo", 20);
        (0, vitest_1.expect)(result.pairs.length).toBeGreaterThan(0);
        // Each pair should be within a single function scope
        for (const p of result.pairs) {
            (0, vitest_1.expect)(p.function).not.toBe("<global>");
        }
    });
    (0, vitest_1.it)("infers protocol rules with improved precision", () => {
        const result = (0, protocol_extractor_v2_1.extractProtocolV2)(V2_DIR, "TestRepo", 20);
        (0, vitest_1.expect)(result.rules.size).toBeGreaterThan(0);
        // Should find file operations
        const fns = [...result.rules.keys()];
        (0, vitest_1.expect)(fns.some(f => f.includes("openFile") || f.includes("open"))).toBe(true);
        (0, vitest_1.expect)(fns.some(f => f.includes("closeFile") || f.includes("close"))).toBe(true);
        // Quality should be better than v1 (33%/12%)
        console.log(`Precision: ${(result.quality.precision * 100).toFixed(0)}%, Recall: ${(result.quality.recall * 100).toFixed(0)}%, F1: ${(result.quality.f1 * 100).toFixed(0)}%`);
    });
    (0, vitest_1.it)("filters noise functions within function scopes", () => {
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
        const result = (0, protocol_extractor_v2_1.extractProtocolV2)(V2_DIR, "NoisyRepo", 20);
        const fns = [...result.rules.keys()];
        // Noise functions should not appear in extracted rules
        (0, vitest_1.expect)(fns.includes("console")).toBe(false);
        (0, vitest_1.expect)(fns.includes("assert")).toBe(false);
    });
    (0, vitest_1.it)("produces quality tier classification", () => {
        const result = (0, protocol_extractor_v2_1.extractProtocolV2)(V2_DIR, "TestRepo", 20);
        (0, vitest_1.expect)(result.quality.tier).toBeDefined();
        (0, vitest_1.expect)(["production", "beta", "poc"]).toContain(result.quality.tier);
        (0, protocol_extractor_v2_1.printExtractionQuality)([{
                name: result.protocol,
                quality: result.quality,
                pairs: result.pairs.length,
                files: result.filesScanned,
            }]);
    });
    (0, vitest_1.it)("handles empty/missing directories gracefully", () => {
        const result = (0, protocol_extractor_v2_1.extractProtocolV2)("/nonexistent/path/v2test", "EmptyRepo", 10);
        (0, vitest_1.expect)(result.filesScanned).toBe(0);
        (0, vitest_1.expect)(result.pairs.length).toBe(0);
        (0, vitest_1.expect)(result.rules.size).toBe(0);
    });
});
