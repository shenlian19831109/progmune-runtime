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
exports.createSnapshot = createSnapshot;
exports.saveSnapshot = saveSnapshot;
exports.loadSnapshot = loadSnapshot;
exports.listSnapshots = listSnapshots;
exports.diffSnapshots = diffSnapshots;
exports.summarizeSnapshot = summarizeSnapshot;
exports.findSnapshotBySession = findSnapshotBySession;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
const projectDir = process.env.PROGMUNE_PROJECT_DIR || process.cwd();
const SNAPSHOT_DIR = path.resolve(projectDir, ".progmune_corpus", "snapshots");
function ensureDir(dir) {
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
}
/** 从 IR 数据创建快照 */
/** @requires IR_DATA @produces SNAPSHOT */
function createSnapshot(ir, intent, sessionId) {
    const functions = ir.map((f) => ({
        name: f.name,
        params: (f.params || []).map((p) => ({ name: p.name, type: p.type })),
        returnType: f.returnType || "void",
    }));
    const hash = crypto.createHash("md5")
        .update(JSON.stringify(functions))
        .digest("hex")
        .slice(0, 12);
    return {
        id: `snap_${Date.now()}_${hash}`,
        timestamp: new Date().toISOString(),
        intent,
        sessionId,
        functions,
    };
}
/** 持久化快照 */
/** @requires SNAPSHOT @produces SNAPSHOT_ID */
function saveSnapshot(snapshot) {
    ensureDir(SNAPSHOT_DIR);
    fs.writeFileSync(path.join(SNAPSHOT_DIR, `${snapshot.id}.json`), JSON.stringify(snapshot, null, 2));
    return snapshot.id;
}
/** 加载快照 */
function loadSnapshot(snapshotId) {
    try {
        const raw = fs.readFileSync(path.join(SNAPSHOT_DIR, `${snapshotId}.json`), "utf-8");
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
/** 列出所有快照 */
function listSnapshots() {
    const snapshots = [];
    if (!fs.existsSync(SNAPSHOT_DIR))
        return snapshots;
    for (const file of fs.readdirSync(SNAPSHOT_DIR)) {
        if (file.endsWith(".json")) {
            try {
                snapshots.push(JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, file), "utf-8")));
            }
            catch { /* snapshot may be unavailable */ }
        }
    }
    snapshots.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return snapshots;
}
/** 计算两个快照之间的差异 */
function diffSnapshots(before, after) {
    const beforeMap = new Map();
    const afterMap = new Map();
    for (const f of before.functions)
        beforeMap.set(f.name, f);
    for (const f of after.functions)
        afterMap.set(f.name, f);
    const added = [];
    const removed = [];
    const changed = [];
    let unchanged = 0;
    for (const [name, f] of afterMap) {
        if (!beforeMap.has(name)) {
            added.push(f);
        }
        else {
            const bf = beforeMap.get(name);
            const bSig = `${bf.returnType}:${bf.params.map(p => `${p.name}:${p.type}`).join(",")}`;
            const aSig = `${f.returnType}:${f.params.map(p => `${p.name}:${p.type}`).join(",")}`;
            if (bSig !== aSig) {
                changed.push({ before: bf, after: f });
            }
            else {
                unchanged++;
            }
        }
    }
    for (const [name, f] of beforeMap) {
        if (!afterMap.has(name)) {
            removed.push(f);
        }
    }
    return { added, removed, changed, unchanged };
}
/** 生成快照摘要 */
function summarizeSnapshot(snapshot) {
    const lines = [
        `Snapshot: ${snapshot.id}`,
        `Timestamp: ${snapshot.timestamp}`,
        `Functions: ${snapshot.functions.length}`,
    ];
    if (snapshot.intent)
        lines.push(`Intent: ${snapshot.intent}`);
    if (snapshot.sessionId)
        lines.push(`Session: ${snapshot.sessionId}`);
    return lines.join("\n");
}
/** 按 sessionId 查找快照，返回最近的一个（或 undefined） */
function findSnapshotBySession(sessionId) {
    const snapshots = listSnapshots();
    return snapshots.find(s => s.sessionId === sessionId);
}
