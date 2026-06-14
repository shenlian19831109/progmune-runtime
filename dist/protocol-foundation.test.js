"use strict";
/**
 * P6.0: Protocol Foundation Model Tests
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
const protocol_foundation_1 = require("./protocol-foundation");
const protocol_extractor_1 = require("./protocol-extractor");
const FOUND_DIR = path.resolve(__dirname, "..", "test-protocol-foundation");
fs.mkdirSync(FOUND_DIR, { recursive: true });
function createTestRepo() {
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
(0, vitest_1.describe)("Protocol Foundation Model", () => {
    createTestRepo();
    (0, vitest_1.it)("infers intelligent state names", () => {
        (0, vitest_1.expect)((0, protocol_foundation_1.inferStateName)("fopen", "post")).toBe("FILE_OPEN");
        (0, vitest_1.expect)((0, protocol_foundation_1.inferStateName)("fclose", "invalidate")).toBe("FILE_CLOSED");
        (0, vitest_1.expect)((0, protocol_foundation_1.inferStateName)("db_connect", "post")).toBe("DB_CONNECTED");
        (0, vitest_1.expect)((0, protocol_foundation_1.inferStateName)("verify_password", "post")).toBe("AUTH_VERIFIED");
        (0, vitest_1.expect)((0, protocol_foundation_1.inferStateName)("generate_jwt", "post")).toBe("AUTH_ISSUED");
        (0, vitest_1.expect)((0, protocol_foundation_1.inferStateName)("create_session", "post")).toBe("AUTH_CREATED");
        (0, vitest_1.expect)((0, protocol_foundation_1.inferStateName)("logout", "invalidate")).toBe("AUTH_UNAUTHENTICATED");
    });
    (0, vitest_1.it)("infers enhanced rules with domain-specific states", () => {
        const code = `
      FILE* f = fopen("x", "r");
      fread(buf, 1, 1024, f);
      fclose(f);

      DB* db = db_connect("localhost");
      db_query(db, "SELECT 1");
      db_disconnect(db);
    `;
        const pairs = (0, protocol_extractor_1.extractCallPairs)(code);
        const rules = (0, protocol_foundation_1.inferEnhancedRules)(pairs, 1);
        (0, vitest_1.expect)(rules.length).toBeGreaterThan(0);
        // fopen should produce FILE_OPEN
        const fopen = rules.find(r => r.function === "fopen");
        (0, vitest_1.expect)(fopen).toBeDefined();
        (0, vitest_1.expect)(fopen.domain).toBe("FILE");
        (0, vitest_1.expect)(fopen.post_states).toContain("FILE_OPEN");
        // fclose should invalidate FILE_OPEN
        const fclose = rules.find(r => r.function === "fclose");
        (0, vitest_1.expect)(fclose).toBeDefined();
        (0, vitest_1.expect)(fclose.invalidate).toBeDefined();
        // db_connect should produce DB_CONNECTED
        const dbConn = rules.find(r => r.function === "db_connect");
        (0, vitest_1.expect)(dbConn).toBeDefined();
        (0, vitest_1.expect)(dbConn.domain).toBe("DB");
    });
    (0, vitest_1.it)("extracts protocol foundation from test repository", () => {
        const result = (0, protocol_foundation_1.extractProtocolFoundation)(FOUND_DIR, "TestFoundation", 20, 1);
        (0, vitest_1.expect)(result.rules.length).toBeGreaterThan(0);
        (0, vitest_1.expect)(result.states.length).toBeGreaterThan(0);
        (0, vitest_1.expect)(result.totalPairs).toBeGreaterThan(0);
        (0, vitest_1.expect)(result.avgConfidence).toBeGreaterThan(0);
        // Should have FILE states
        (0, vitest_1.expect)(result.states.some(s => s.includes("FILE"))).toBe(true);
        // Should have DB states
        (0, vitest_1.expect)(result.states.some(s => s.includes("DB"))).toBe(true);
        // Hand-written overlap: fopen/fread/fwrite/fclose match ground truth
        (0, vitest_1.expect)(result.handWrittenOverlap).toBeGreaterThanOrEqual(2);
        (0, protocol_foundation_1.printFoundationReport)(result);
    });
    (0, vitest_1.it)("converts enhanced rules to SSG-compatible map", () => {
        const code = `FILE* f = fopen("x", "r"); fclose(f);`;
        const pairs = (0, protocol_extractor_1.extractCallPairs)(code);
        const rules = (0, protocol_foundation_1.inferEnhancedRules)(pairs, 1);
        const map = (0, protocol_foundation_1.enhancedRulesToMap)(rules);
        (0, vitest_1.expect)(map.size).toBeGreaterThan(0);
        const fopenRule = map.get("fopen");
        (0, vitest_1.expect)(fopenRule).toBeDefined();
        (0, vitest_1.expect)(fopenRule.post_states.length).toBeGreaterThan(0);
    });
    (0, vitest_1.it)("measures discovery impact of extracted rules", async () => {
        const code = `FILE* f = fopen("x", "r"); fclose(f);`;
        const pairs = (0, protocol_extractor_1.extractCallPairs)(code);
        const rules = (0, protocol_foundation_1.inferEnhancedRules)(pairs, 1);
        const map = (0, protocol_foundation_1.enhancedRulesToMap)(rules);
        const impact = await (0, protocol_foundation_1.measureDiscoveryImpact)(map);
        (0, vitest_1.expect)(impact.baseline.discoveryRate).toBeGreaterThanOrEqual(0);
        (0, vitest_1.expect)(impact.rulesAdded).toBeGreaterThanOrEqual(0);
        (0, protocol_foundation_1.printFoundationReport)({ protocol: "test", rules, states: [], sourceFiles: [], totalPairs: pairs.length, avgConfidence: 1, handWrittenOverlap: 1, novelRulesCount: impact.rulesAdded }, impact);
    }, 30000);
});
