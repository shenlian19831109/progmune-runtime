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
exports.saveCheckpoint = saveCheckpoint;
exports.loadCheckpoint = loadCheckpoint;
exports.clearCheckpoint = clearCheckpoint;
exports.recordFailure = recordFailure;
exports.recordSession = recordSession;
exports.getAllFailures = getAllFailures;
exports.getFailuresBySVL = getFailuresBySVL;
exports.getTopFailurePatterns = getTopFailurePatterns;
exports.getFailureGenome = getFailureGenome;
exports.getAllSessions = getAllSessions;
exports.getLearnedPatterns = getLearnedPatterns;
exports.queryAntibodies = queryAntibodies;
exports.getSemanticHeatmap = getSemanticHeatmap;
exports.generateCandidateRules = generateCandidateRules;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const file_lock_1 = require("./file-lock");
// 优先使用 PROGMUNE_PROJECT_DIR（由 MCP 服务器在调用时设置），确保多项目隔离
const projectDir = process.env.PROGMUNE_PROJECT_DIR || process.cwd();
const CORPUS_DIR = process.env.PROGMUNE_CORPUS_DIR
    || path.resolve(projectDir, ".progmune_corpus");
const SESSIONS_DIR = path.join(CORPUS_DIR, "sessions");
const CHECKPOINT_DIR = path.join(CORPUS_DIR, "checkpoints");
function ensureDir(dir) {
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
}
function checkpointPath(intent) {
    // 用 intent 的稳定 hash 作为文件名，避免特殊字符
    const hash = Buffer.from(intent).toString("base64").replace(/[/+=]/g, "_").slice(0, 32);
    return path.join(CHECKPOINT_DIR, `ckpt_${hash}.json`);
}
function saveCheckpoint(intent, data) {
    ensureDir(CHECKPOINT_DIR);
    const cp = {
        ...data,
        intent,
        timestamp: new Date().toISOString(),
    };
    fs.writeFileSync(checkpointPath(intent), JSON.stringify(cp, null, 2));
}
function loadCheckpoint(intent) {
    try {
        const raw = fs.readFileSync(checkpointPath(intent), "utf-8");
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
function clearCheckpoint(intent) {
    try {
        fs.unlinkSync(checkpointPath(intent));
    }
    catch { }
}
function recordFailure(record) {
    (0, file_lock_1.withLock)("failure-corpus", () => {
        ensureDir(CORPUS_DIR);
        const date = new Date().toISOString().slice(0, 10);
        const dateDir = path.join(CORPUS_DIR, date);
        ensureDir(dateDir);
        const seqFile = path.join(CORPUS_DIR, ".seq");
        let seq = 0;
        try {
            seq = parseInt(fs.readFileSync(seqFile, 'utf-8'), 10);
        }
        catch { }
        seq++;
        fs.writeFileSync(seqFile, String(seq));
        const id = `fail_${Date.now()}_${seq}`;
        const fullRecord = {
            ...record,
            id,
            timestamp: new Date().toISOString(),
            plannerAttempt: record.plannerAttempt || 1,
            plannerRetryTotal: record.plannerRetryTotal || 1,
        };
        const filename = `${id}.json`;
        fs.writeFileSync(path.join(dateDir, filename), JSON.stringify(fullRecord, null, 2));
        console.error(`[FailureCorpus] ${record.violatedSVL} | 尝试 ${record.plannerAttempt}/${record.plannerRetryTotal} | ${id}`);
    });
}
/** 记录一个完整的意图会话（成功或失败的所有尝试） */
function recordSession(session) {
    ensureDir(SESSIONS_DIR);
    const sessionId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const fullSession = { ...session, sessionId };
    fs.writeFileSync(path.join(SESSIONS_DIR, `${sessionId}.json`), JSON.stringify(fullSession, null, 2));
    return sessionId;
}
function getAllFailures() {
    const records = [];
    if (!fs.existsSync(CORPUS_DIR))
        return records;
    const dirs = fs.readdirSync(CORPUS_DIR).filter(d => d !== 'sessions');
    for (const dir of dirs) {
        const dirPath = path.join(CORPUS_DIR, dir);
        if (!fs.statSync(dirPath).isDirectory())
            continue;
        for (const file of fs.readdirSync(dirPath)) {
            if (file.endsWith(".json")) {
                try {
                    records.push(JSON.parse(fs.readFileSync(path.join(dirPath, file), "utf-8")));
                }
                catch { }
            }
        }
    }
    return records;
}
function getFailuresBySVL(level) {
    return getAllFailures().filter(r => r.violatedSVL === level);
}
function getTopFailurePatterns(limit = 5) {
    const groups = new Map();
    for (const r of getAllFailures()) {
        const key = `${r.violatedSVL}:${r.constraintType}`;
        const entry = groups.get(key) || { count: 0, examples: [] };
        entry.count++;
        if (entry.examples.length < 3)
            entry.examples.push(r.intent);
        groups.set(key, entry);
    }
    return [...groups.entries()]
        .map(([pattern, entry]) => ({ pattern, count: entry.count, examples: entry.examples }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);
}
/** 构建 AI 失败基因组 —— 按失效模式分组的完整画像 */
function getFailureGenome() {
    const all = getAllFailures();
    const bySVL = { "SVL-1": 0, "SVL-2": 0, "SVL-3": 0, "SVL-4": 0 };
    const byConstraint = {};
    // 修复路径统计
    const fixPathCounts = new Map();
    let totalRetries = 0;
    for (const r of all) {
        bySVL[r.violatedSVL] = (bySVL[r.violatedSVL] || 0) + 1;
        byConstraint[r.constraintType] = (byConstraint[r.constraintType] || 0) + 1;
        totalRetries += r.plannerAttempt || 1;
        if (r.ssgFixPath && r.ssgFixPath.length > 0) {
            const key = `${r.violatedSVL}:${r.ssgFixPath.join('→')}`;
            fixPathCounts.set(key, (fixPathCounts.get(key) || 0) + 1);
        }
    }
    const commonFixPaths = [...fixPathCounts.entries()]
        .map(([key, count]) => {
        const [violation, ...rest] = key.split(':');
        return { violation, fixPath: rest.join(':').split('→'), count };
    })
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
    return {
        totalFailures: all.length,
        bySVL,
        byConstraintType: byConstraint,
        topPatterns: getTopFailurePatterns(5),
        commonFixPaths,
        averageRetriesToSuccess: all.length > 0 ? Math.round((totalRetries / all.length) * 10) / 10 : 0,
    };
}
/** 获取所有意图会话 */
function getAllSessions() {
    const sessions = [];
    if (!fs.existsSync(SESSIONS_DIR))
        return sessions;
    for (const file of fs.readdirSync(SESSIONS_DIR)) {
        if (file.endsWith(".json")) {
            try {
                sessions.push(JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, file), "utf-8")));
            }
            catch { }
        }
    }
    return sessions;
}
function computeACL(count, distinctIntents, resolvedRate) {
    const acl4Count = parseInt(process.env.PROGMUNE_ACL4_COUNT || "10", 10);
    const acl4Intents = parseInt(process.env.PROGMUNE_ACL4_INTENTS || "5", 10);
    const acl3Count = parseInt(process.env.PROGMUNE_ACL3_COUNT || "4", 10);
    const acl3Intents = parseInt(process.env.PROGMUNE_ACL3_INTENTS || "3", 10);
    const acl2Count = parseInt(process.env.PROGMUNE_ACL2_COUNT || "2", 10);
    if (count >= acl4Count && distinctIntents >= acl4Intents)
        return "ACL-4";
    if (count >= acl3Count || distinctIntents >= acl3Intents)
        return "ACL-3";
    if (count >= acl2Count)
        return "ACL-2";
    return "ACL-1";
}
function getLearnedPatterns() {
    const sessions = getAllSessions();
    const agg = new Map();
    for (const s of sessions) {
        for (const a of s.attempts) {
            if (!a.ssgFixPath || a.ssgFixPath.length === 0)
                continue;
            const signature = `${a.violatedSVL}:${(a.ssgMissingFunctions || ["unknown"]).join(",")}`;
            const existing = agg.get(signature);
            if (existing) {
                existing.count++;
                existing.intents.add(s.intent);
                if (s.resolved)
                    existing.resolvedCount++;
                if (s.timestamp > existing.lastSeen)
                    existing.lastSeen = s.timestamp;
            }
            else {
                agg.set(signature, {
                    violation: `${a.violatedSVL}: ${(a.ssgMissingFunctions || ["unknown"]).join(", ")}`,
                    fixPath: a.ssgFixPath,
                    count: 1,
                    intents: new Set([s.intent]),
                    resolvedCount: s.resolved ? 1 : 0,
                    firstSeen: s.timestamp,
                    lastSeen: s.timestamp,
                });
            }
        }
    }
    const patterns = [];
    for (const [signature, data] of agg) {
        const distinctCount = data.intents.size;
        const resolvedRate = data.count > 0 ? Math.round((data.resolvedCount / data.count) * 100) / 100 : 0;
        patterns.push({
            signature,
            violation: data.violation,
            fixPath: data.fixPath,
            occurrenceCount: data.count,
            distinctIntents: [...data.intents],
            resolvedRate,
            antibodyLevel: computeACL(data.count, distinctCount, resolvedRate),
            firstSeen: data.firstSeen,
            lastSeen: data.lastSeen,
        });
    }
    patterns.sort((a, b) => b.occurrenceCount - a.occurrenceCount);
    return { failureToFix: patterns };
}
/** 查询匹配当前意图的高置信度抗体（ACL-3+），用于推理层免疫加速 */
function queryAntibodies(intent, minACL = "ACL-3") {
    const { failureToFix } = getLearnedPatterns();
    const aclRank = { "ACL-1": 1, "ACL-2": 2, "ACL-3": 3, "ACL-4": 4 };
    const minRank = aclRank[minACL];
    const intentLower = intent.toLowerCase();
    const intentWords = new Set(intentLower.split(/[\s,，、]+/).filter(w => w.length > 1));
    return failureToFix
        .filter(p => aclRank[p.antibodyLevel] >= minRank)
        .filter(p => p.fixPath && p.fixPath.length > 0)
        .map(p => {
        // 计算意图相似度
        let overlapScore = 0;
        for (const di of p.distinctIntents) {
            const diWords = new Set(di.toLowerCase().split(/[\s,，、]+/).filter(w => w.length > 1));
            const intersection = [...intentWords].filter(w => diWords.has(w)).length;
            const union = new Set([...intentWords, ...diWords]).size;
            overlapScore = Math.max(overlapScore, union > 0 ? intersection / union : 0);
        }
        return { ...p, _score: overlapScore };
    })
        .filter(p => p._score > 0.2) // 至少 20% 的 Jaccard 相似度
        .sort((a, b) => b._score - a._score);
}
/** 语义热力图：哪些协议/层最脆弱，约束如何聚类 */
function getSemanticHeatmap() {
    const sessions = getAllSessions();
    const allFailures = getAllFailures();
    const total = allFailures.length || 1;
    // Fragile protocols: which functions are most frequently blocked
    const funcCounts = new Map();
    for (const r of allFailures) {
        const blockedMatch = r.errorDetail.match(/(\w+)\s*(要求|requires|blocked|不允许|不合法)/);
        const fn = blockedMatch ? blockedMatch[1] : (r.actionSequence?.[0]?.function || "unknown");
        const existing = funcCounts.get(fn);
        if (existing) {
            existing.count++;
        }
        else {
            funcCounts.set(fn, { count: 1, svl: r.violatedSVL });
        }
    }
    const fragileProtocols = [...funcCounts.entries()]
        .map(([fn, data]) => ({ function: fn, violationCount: data.count, svl: data.svl }))
        .sort((a, b) => b.violationCount - a.violationCount)
        .slice(0, 10);
    // SVL hotspots
    const svlHotspots = [];
    const svlCounts = {};
    for (const r of allFailures) {
        svlCounts[r.violatedSVL] = (svlCounts[r.violatedSVL] || 0) + 1;
    }
    for (const [svl, count] of Object.entries(svlCounts)) {
        svlHotspots.push({ svl, count, percentage: Math.round((count / total) * 100) });
    }
    svlHotspots.sort((a, b) => b.count - a.count);
    // Constraint clusters: which anomaly types co-occur in the same session
    const constraintClusters = [];
    for (const s of sessions) {
        if (s.attempts.length < 2)
            continue;
        const types = [...new Set(s.attempts.map(a => a.constraintType))].sort();
        if (types.length >= 2) {
            constraintClusters.push({ constraints: types, count: s.attempts.length, intent: s.intent });
        }
    }
    constraintClusters.sort((a, b) => b.count - a.count);
    // High friction intents: which tasks require the most adaptations
    const highFrictionIntents = sessions
        .map(s => ({
        intent: s.intent,
        adaptationCount: s.totalRetries,
        anomalyTypes: [...new Set(s.attempts.map(a => a.constraintType))],
    }))
        .sort((a, b) => b.adaptationCount - a.adaptationCount)
        .slice(0, 8);
    return { fragileProtocols, svlHotspots, constraintClusters, highFrictionIntents };
}
function generateCandidateRules() {
    const genome = getFailureGenome();
    const rules = [];
    // SVL-4 修复路径
    const ssgFixes = genome.commonFixPaths.filter(f => f.violation === 'SVL-4');
    if (ssgFixes.length > 0) {
        const top = ssgFixes[0];
        rules.push(`SSG 修复规则: 当检测到协议违规时，优先尝试调用 ${top.fixPath.join(' → ')}。`);
    }
    if (genome.bySVL["SVL-1"] > genome.bySVL["SVL-4"]) {
        rules.push("SVL-1 是最高频失效模式——建议强化 IR 提取的符号覆盖度。");
    }
    if (genome.bySVL["SVL-4"] > 0) {
        rules.push("SVL-4 协议违规建议：为关键函数添加 @protocol JSDoc 注解。");
    }
    if (genome.averageRetriesToSuccess > 2) {
        rules.push(`平均需要 ${genome.averageRetriesToSuccess} 次重试才能成功——考虑优化 Planner 路径排序。`);
    }
    return rules;
}
