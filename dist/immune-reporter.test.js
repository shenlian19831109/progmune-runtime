"use strict";
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
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const immune_reporter_1 = require("./immune-reporter");
/**
 * Immune Reporter 测试——2026-09 修复轮：
 * 默认脱敏、PROGMUNE_HUB=off 开关、语料路径对齐 .progmune_corpus。
 * 涉及文件系统的用例使用临时目录注入（corpusDir 参数），不触碰真实语料。
 */
let tmpDir;
(0, vitest_1.beforeEach)(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "progmune-reporter-"));
});
(0, vitest_1.afterEach)(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
});
(0, vitest_1.describe)("resolveEndpoint", () => {
    (0, vitest_1.it)("未设置 PROGMUNE_HUB 时默认指向中央 hub", () => {
        (0, vitest_1.expect)((0, immune_reporter_1.resolveEndpoint)(undefined)).toBe("https://progmune-runtime.fly.dev/report");
    });
    (0, vitest_1.it)("PROGMUNE_HUB=off 及其变体（0/false/no/disabled）关闭上报", () => {
        for (const v of ["off", "0", "false", "no", "disabled", "OFF"]) {
            (0, vitest_1.expect)((0, immune_reporter_1.resolveEndpoint)(v)).toBeNull();
        }
    });
    (0, vitest_1.it)("自定义 URL 原样生效", () => {
        (0, vitest_1.expect)((0, immune_reporter_1.resolveEndpoint)("http://localhost:9999/report")).toBe("http://localhost:9999/report");
    });
});
(0, vitest_1.describe)("maskFunctionName", () => {
    (0, vitest_1.it)("默认脱敏：同名函数产生相同哈希（模式聚合保持有效）", () => {
        const a = (0, immune_reporter_1.maskFunctionName)("generate_jwt", false);
        const b = (0, immune_reporter_1.maskFunctionName)("generate_jwt", false);
        (0, vitest_1.expect)(a).toBe(b);
        (0, vitest_1.expect)(a).toMatch(/^fn:[0-9a-f]{12}$/);
        (0, vitest_1.expect)(a).not.toContain("generate_jwt");
    });
    (0, vitest_1.it)("不同函数名产生不同哈希", () => {
        (0, vitest_1.expect)((0, immune_reporter_1.maskFunctionName)("generate_jwt", false)).not.toBe((0, immune_reporter_1.maskFunctionName)("create_session", false));
    });
    (0, vitest_1.it)("PROGMUNE_FINGERPRINT_DETAIL=1 时保留原文", () => {
        (0, vitest_1.expect)((0, immune_reporter_1.maskFunctionName)("generate_jwt", true)).toBe("generate_jwt");
    });
});
(0, vitest_1.describe)("buildHeaders", () => {
    (0, vitest_1.it)("无 token 时只带 Content-Type", () => {
        (0, vitest_1.expect)((0, immune_reporter_1.buildHeaders)(undefined)).toEqual({ "Content-Type": "application/json" });
    });
    (0, vitest_1.it)("设置 PROGMUNE_HUB_TOKEN 时带 Bearer 认证头", () => {
        const h = (0, immune_reporter_1.buildHeaders)("secret-token");
        (0, vitest_1.expect)(h["Authorization"]).toBe("Bearer secret-token");
        (0, vitest_1.expect)(h["Content-Type"]).toBe("application/json");
    });
});
(0, vitest_1.describe)("extractFingerprints", () => {
    function writeRecord(date, id, record) {
        const dir = path.join(tmpDir, date);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `fail_${id}.json`), JSON.stringify(record));
    }
    (0, vitest_1.it)("从 .progmune_corpus 路径读取并默认脱敏函数名", () => {
        writeRecord("2026-09-09", "1", {
            timestamp: "2026-09-09T10:00:00.000Z",
            violatedSVL: "SVL-4",
            constraintType: "protocol",
            actionSequence: [{ kind: "call", function: "generate_jwt" }],
            ssgState: ["UNAUTHENTICATED"],
        });
        const fps = (0, immune_reporter_1.extractFingerprints)({ lastTimestamp: null }, tmpDir);
        (0, vitest_1.expect)(fps.length).toBe(1);
        (0, vitest_1.expect)(fps[0].functionSequence[0]).toMatch(/^fn:[0-9a-f]{12}$/);
        (0, vitest_1.expect)(fps[0].preState).toEqual([["UNAUTHENTICATED"]]);
    });
    (0, vitest_1.it)("游标之后的新记录才会上报，旧记录跳过", () => {
        writeRecord("2026-09-01", "old", {
            timestamp: "2026-09-01T10:00:00.000Z",
            violatedSVL: "SVL-4",
            constraintType: "protocol",
            actionSequence: [],
        });
        writeRecord("2026-09-09", "new", {
            timestamp: "2026-09-09T10:00:00.000Z",
            violatedSVL: "SVL-4",
            constraintType: "protocol",
            actionSequence: [],
        });
        const fps = (0, immune_reporter_1.extractFingerprints)({ lastTimestamp: "2026-09-05T00:00:00.000Z" }, tmpDir);
        (0, vitest_1.expect)(fps.length).toBe(1);
        (0, vitest_1.expect)(fps[0].timestamp).toBe("2026-09-09T10:00:00.000Z");
    });
    (0, vitest_1.it)("非 fail_ 前缀文件与损坏 JSON 跳过，不中断", () => {
        writeRecord("2026-09-09", "ok", {
            timestamp: "2026-09-09T10:00:00.000Z",
            violatedSVL: "SVL-4",
            constraintType: "protocol",
            actionSequence: [],
        });
        fs.writeFileSync(path.join(tmpDir, "2026-09-09", "trajectory_x.json"), "{}");
        fs.writeFileSync(path.join(tmpDir, "2026-09-09", "fail_broken.json"), "{corrupted");
        const fps = (0, immune_reporter_1.extractFingerprints)({ lastTimestamp: null }, tmpDir);
        (0, vitest_1.expect)(fps.length).toBe(1);
    });
    (0, vitest_1.it)("无调用序列时 functionSequence 为空数组而非报错", () => {
        writeRecord("2026-09-09", "empty", {
            timestamp: "2026-09-09T10:00:00.000Z",
            violatedSVL: "SVL-2",
            constraintType: "types",
        });
        const fps = (0, immune_reporter_1.extractFingerprints)({ lastTimestamp: null }, tmpDir);
        (0, vitest_1.expect)(fps.length).toBe(1);
        (0, vitest_1.expect)(fps[0].functionSequence).toEqual([]);
    });
});
