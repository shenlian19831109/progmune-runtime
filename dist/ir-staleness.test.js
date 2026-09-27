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
const ir_staleness_1 = require("./ir-staleness");
/**
 * ir.json 陈旧性判定的回归测试（2026-09-19）。
 *
 * 锁三件事：
 * 1. ir.json 缺失 → missing（需提取）——保住原有的自动提取语义；
 * 2. 源码比 ir.json 新 → source-newer（需重提）——本次新增的判别力；
 * 3. ir.json 不早于源码 → fresh（沿用磁盘文件）——不做无谓的全量重提，
 *    否则 skyvern 级项目每次扫描要多付分钟级成本。
 */
function tmpdir(tag) {
    return fs.mkdtempSync(path.join(os.tmpdir(), `pm-ir-stale-${tag}-`));
}
/** 把文件的 mtime 显式钉到某个 epoch ms（避免同一毫秒内写完两文件的歧义）。 */
function touch(file, content, mtimeMs) {
    fs.writeFileSync(file, content);
    fs.utimesSync(file, mtimeMs / 1000, mtimeMs / 1000);
}
(0, vitest_1.describe)("inspectIrFreshness", () => {
    (0, vitest_1.it)("ir.json 缺失 → missing，stale=true（触发自动提取）", () => {
        const dir = tmpdir("missing");
        try {
            touch(path.join(dir, "app.ts"), "export const x = 1;", 1700000000000);
            const r = (0, ir_staleness_1.inspectIrFreshness)(dir);
            (0, vitest_1.expect)(r.exists).toBe(false);
            (0, vitest_1.expect)(r.stale).toBe(true);
            (0, vitest_1.expect)(r.reason).toBe("missing");
            (0, vitest_1.expect)(r.irMtimeMs).toBeNull();
        }
        finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
    (0, vitest_1.it)("源码比 ir.json 新 → source-newer（本次修复的核心：原先会被静默沿用）", () => {
        const dir = tmpdir("newer");
        try {
            const irFile = path.join(dir, "ir.json");
            const srcFile = path.join(dir, "app.ts");
            touch(irFile, "[]", 1700000000000);
            touch(srcFile, "export const x = 1;", 1700000100000); // 晚 100s
            const r = (0, ir_staleness_1.inspectIrFreshness)(dir);
            (0, vitest_1.expect)(r.exists).toBe(true);
            (0, vitest_1.expect)(r.stale).toBe(true);
            (0, vitest_1.expect)(r.reason).toBe("source-newer");
            (0, vitest_1.expect)(r.newestSourcePath).toBe(srcFile);
        }
        finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
    (0, vitest_1.it)("ir.json 比源码新 → fresh（不重提，避免分钟级全量重提）", () => {
        const dir = tmpdir("fresh");
        try {
            touch(path.join(dir, "app.ts"), "export const x = 1;", 1700000000000);
            touch(path.join(dir, "ir.json"), "[]", 1700000100000);
            const r = (0, ir_staleness_1.inspectIrFreshness)(dir);
            (0, vitest_1.expect)(r.stale).toBe(false);
            (0, vitest_1.expect)(r.reason).toBe("fresh");
            (0, vitest_1.expect)(r.scannedFiles).toBe(1);
        }
        finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
    (0, vitest_1.it)("同刻写出（源码→ir.json 的常见顺序）→ fresh（不得推入全量重提）", () => {
        const dir = tmpdir("same");
        try {
            touch(path.join(dir, "app.ts"), "export const x = 1;", 1700000000000);
            touch(path.join(dir, "ir.json"), "[]", 1700000000000);
            const r = (0, ir_staleness_1.inspectIrFreshness)(dir);
            (0, vitest_1.expect)(r.stale).toBe(false);
            (0, vitest_1.expect)(r.reason).toBe("fresh");
        }
        finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
    (0, vitest_1.it)("子目录源码也算源码（只看根目录下的话会漏判）", () => {
        const dir = tmpdir("nested");
        try {
            touch(path.join(dir, "ir.json"), "[]", 1700000000000);
            const nested = path.join(dir, "src", "deep");
            fs.mkdirSync(nested, { recursive: true });
            touch(path.join(nested, "handler.ts"), "export function handle() {}", 1700000500000);
            const r = (0, ir_staleness_1.inspectIrFreshness)(dir);
            (0, vitest_1.expect)(r.stale).toBe(true);
            (0, vitest_1.expect)(r.newestSourcePath).toContain(path.join("src", "deep", "handler.ts"));
        }
        finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
    (0, vitest_1.it)("node_modules 等非源码目录被跳过（成本约束：不得遍历依赖树）", () => {
        const dir = tmpdir("skip");
        try {
            touch(path.join(dir, "ir.json"), "[]", 1700000500000);
            const nm = path.join(dir, "node_modules", "pkg");
            fs.mkdirSync(nm, { recursive: true });
            touch(path.join(nm, "index.js"), "module.exports = 1;", 1700000900000);
            const r = (0, ir_staleness_1.inspectIrFreshness)(dir);
            (0, vitest_1.expect)(r.stale).toBe(false);
            (0, vitest_1.expect)(r.reason).toBe("no-sources");
            (0, vitest_1.expect)(r.scannedFiles).toBe(0);
        }
        finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
    (0, vitest_1.it)("非源码后缀（png/md/json）不影响判定", () => {
        const dir = tmpdir("ext");
        try {
            touch(path.join(dir, "ir.json"), "[]", 1700000500000);
            touch(path.join(dir, "README.md"), "hello", 1700000900000);
            touch(path.join(dir, "logo.png"), "x", 1700000900000);
            const r = (0, ir_staleness_1.inspectIrFreshness)(dir);
            (0, vitest_1.expect)(r.stale).toBe(false);
            (0, vitest_1.expect)(r.reason).toBe("no-sources");
        }
        finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
    (0, vitest_1.it)("源码规模超预算 → exceedsAutoBudget（auto 模式只警告，不自动全量重提）", () => {
        const dir = tmpdir("budget");
        try {
            touch(path.join(dir, "ir.json"), "[]", 1700000000000);
            for (let i = 0; i < 5; i++) {
                touch(path.join(dir, `f${i}.ts`), "export const x = 1;", 1700000100000);
            }
            const r = (0, ir_staleness_1.inspectIrFreshness)(dir, undefined, { autoBudget: 3 });
            (0, vitest_1.expect)(r.stale).toBe(true); // 陈旧判定不受预算影响
            (0, vitest_1.expect)(r.exceedsAutoBudget).toBe(true);
            (0, vitest_1.expect)(r.scannedFiles).toBe(5);
        }
        finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
    (0, vitest_1.it)("遍历被上限截断时标记 evidenceComplete=false（超大仓库不得静默全量重提）", () => {
        const dir = tmpdir("trunc");
        try {
            touch(path.join(dir, "ir.json"), "[]", 1700000000000);
            for (let i = 0; i < 5; i++) {
                touch(path.join(dir, `f${i}.ts`), "export const x = 1;", 1700000100000);
            }
            // maxStats=2：扫到 2 个就停 —— stale 仍为真（证据已经够），但 fresh 不可信
            const r = (0, ir_staleness_1.inspectIrFreshness)(dir, undefined, { maxStats: 2 });
            (0, vitest_1.expect)(r.stale).toBe(true);
            (0, vitest_1.expect)(r.truncated).toBe(true);
            (0, vitest_1.expect)(r.evidenceComplete).toBe(false);
        }
        finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
    (0, vitest_1.it)("正常仓库（未截断）fresh 判定证据完整", () => {
        const dir = tmpdir("complete");
        try {
            touch(path.join(dir, "app.ts"), "export const x = 1;", 1700000000000);
            touch(path.join(dir, "ir.json"), "[]", 1700000100000);
            const r = (0, ir_staleness_1.inspectIrFreshness)(dir);
            (0, vitest_1.expect)(r.evidenceComplete).toBe(true);
            (0, vitest_1.expect)(r.reason).toBe("fresh");
        }
        finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
    (0, vitest_1.it)("逃逸阀：默认 auto", () => {
        const prev = process.env.PROGMUNE_IR_REEXTRACT;
        delete process.env.PROGMUNE_IR_REEXTRACT;
        (0, vitest_1.expect)((0, ir_staleness_1.reextractMode)()).toBe("auto");
        (0, vitest_1.expect)((0, ir_staleness_1.reextractEnabled)()).toBe(true);
        if (prev !== undefined)
            process.env.PROGMUNE_IR_REEXTRACT = prev;
    });
    (0, vitest_1.it)("逃生阀：always / never 语义", () => {
        const prev = process.env.PROGMUNE_IR_REEXTRACT;
        process.env.PROGMUNE_IR_REEXTRACT = "always";
        (0, vitest_1.expect)((0, ir_staleness_1.reextractMode)()).toBe("always");
        process.env.PROGMUNE_IR_REEXTRACT = "never";
        (0, vitest_1.expect)((0, ir_staleness_1.reextractMode)()).toBe("never");
        (0, vitest_1.expect)((0, ir_staleness_1.reextractEnabled)()).toBe(false);
        if (prev === undefined)
            delete process.env.PROGMUNE_IR_REEXTRACT;
        else
            process.env.PROGMUNE_IR_REEXTRACT = prev;
    });
});
