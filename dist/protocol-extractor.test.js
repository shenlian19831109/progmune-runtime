"use strict";
/**
 * P5.5: Protocol Extraction Engine Tests
 */
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const protocol_extractor_1 = require("./protocol-extractor");
const SAMPLE_C_CODE = `
int main() {
    FILE* f = fopen("config.txt", "r");
    char buf[1024];
    fread(buf, 1, 1024, f);
    printf("%s", buf);
    fclose(f);
    return 0;
}

void write_config() {
    FILE* f = fopen("output.txt", "w");
    fwrite(data, 1, len, f);
    fflush(f);
    fclose(f);
}

void db_work() {
    DB* db = db_connect("localhost");
    db_query(db, "SELECT * FROM users");
    db_close(db);
}
`;
const SAMPLE_JS_CODE = `
function processFile(path) {
    const fd = openFile(path);
    const data = readFile(fd);
    const result = transform(data);
    writeFile(fd, result);
    closeFile(fd);
}

async function authFlow() {
    const user = await verifyPassword(credentials);
    const token = generateJWT(user);
    const session = createSession(token);
    return session;
}

function dbQuery() {
    const conn = connectDb(host);
    const rows = queryDb(conn, sql);
    disconnectDb(conn);
}
`;
(0, vitest_1.describe)("Protocol Extraction", () => {
    (0, vitest_1.it)("extracts call pairs from C code", () => {
        const pairs = (0, protocol_extractor_1.extractCallPairs)(SAMPLE_C_CODE, "test.c");
        (0, vitest_1.expect)(pairs.length).toBeGreaterThan(0);
        // Should find fopen → fread, fread → fclose pairs
        const hasFopenClose = pairs.some(p => p.from === "fopen" && p.to === "fclose");
        (0, vitest_1.expect)(hasFopenClose).toBe(true);
        // Should find db_connect → db_query → db_close chain
        const hasDbChain = pairs.some(p => p.from === "db_connect" && p.to === "db_query");
        (0, vitest_1.expect)(hasDbChain).toBe(true);
    });
    (0, vitest_1.it)("extracts call pairs from JS code", () => {
        const pairs = (0, protocol_extractor_1.extractCallPairs)(SAMPLE_JS_CODE, "test.js");
        (0, vitest_1.expect)(pairs.length).toBeGreaterThan(0);
        // openFile → readFile → writeFile → closeFile
        const hasFileChain = pairs.some(p => p.from === "openFile" && p.to === "readFile");
        (0, vitest_1.expect)(hasFileChain).toBe(true);
        // verifyPassword → generateJWT → createSession
        const hasAuthChain = pairs.some(p => p.from === "verifyPassword" && p.to === "generateJWT");
        (0, vitest_1.expect)(hasAuthChain).toBe(true);
    });
    (0, vitest_1.it)("infers protocol rules from call pairs", () => {
        const pairs = (0, protocol_extractor_1.extractCallPairs)(SAMPLE_C_CODE + SAMPLE_JS_CODE, "combined");
        const rules = (0, protocol_extractor_1.inferProtocolRules)(pairs, 1); // min freq 1 for test
        (0, vitest_1.expect)(rules.length).toBeGreaterThan(0);
        // fopen should have post_states (produces something)
        const fopen = rules.find(r => r.function === "fopen");
        (0, vitest_1.expect)(fopen).toBeDefined();
        (0, vitest_1.expect)(fopen.post_states.length).toBeGreaterThan(0);
        // fclose should invalidate something
        const fclose = rules.find(r => r.function === "fclose");
        (0, vitest_1.expect)(fclose).toBeDefined();
        // fclose should have pre_states (needs FILE_OPEN or similar)
        (0, vitest_1.expect)(fclose.pre_states.length).toBeGreaterThan(0);
        // verifyPassword → generateJWT should produce AUTH state
        const verifyPw = rules.find(r => r.function === "verifyPassword");
        (0, vitest_1.expect)(verifyPw).toBeDefined();
    });
    (0, vitest_1.it)("full extraction pipeline from multiple files", () => {
        const result = (0, protocol_extractor_1.extractProtocol)([
            { code: SAMPLE_C_CODE, file: "test.c" },
            { code: SAMPLE_JS_CODE, file: "test.js" },
        ], "FileProtocol", 1);
        (0, vitest_1.expect)(result.rules.length).toBeGreaterThan(0);
        (0, vitest_1.expect)(result.inferredStates.length).toBeGreaterThan(0);
        (0, vitest_1.expect)(result.totalPairs).toBeGreaterThan(0);
        (0, vitest_1.expect)(result.confidence).toBeGreaterThan(0);
        (0, protocol_extractor_1.printExtractionReport)(result);
    });
    (0, vitest_1.it)("converts rules to SSG-compatible annotation map", () => {
        const pairs = (0, protocol_extractor_1.extractCallPairs)(SAMPLE_C_CODE, "test.c");
        const rules = (0, protocol_extractor_1.inferProtocolRules)(pairs, 1);
        const map = (0, protocol_extractor_1.rulesToAnnotationMap)(rules);
        (0, vitest_1.expect)(map.size).toBeGreaterThan(0);
        // Every rule should have pre_states and post_states arrays
        for (const [fn, annotation] of map) {
            (0, vitest_1.expect)(Array.isArray(annotation.pre_states)).toBe(true);
            (0, vitest_1.expect)(Array.isArray(annotation.post_states)).toBe(true);
        }
    });
});
