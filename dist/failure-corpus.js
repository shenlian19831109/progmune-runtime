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
exports.recordFailure = recordFailure;
exports.recordSession = recordSession;
exports.getAllFailures = getAllFailures;
exports.getFailuresBySVL = getFailuresBySVL;
exports.getTopFailurePatterns = getTopFailurePatterns;
exports.getFailureGenome = getFailureGenome;
exports.getAllSessions = getAllSessions;
exports.getLearnedPatterns = getLearnedPatterns;
exports.generateCandidateRules = generateCandidateRules;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const file_lock_1 = require("./file-lock");
const CORPUS_DIR = path.resolve(__dirname, "../failure_corpus");
const SESSIONS_DIR = path.resolve(__dirname, "../failure_corpus/sessions");
function ensureDir(dir) {
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
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
    const sessionId = `sess_${Date.now()}`;
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
        totalRetries += r.plannerAttempt;
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
/** 查询学到的东西：哪些失效模式最常见，对应的修复路径是什么 */
function getLearnedPatterns() {
    const sessions = getAllSessions();
    const patterns = [];
    for (const s of sessions) {
        for (const a of s.attempts) {
            if (a.ssgFixPath && a.ssgFixPath.length > 0) {
                patterns.push({
                    intent: s.intent,
                    violation: `${a.violatedSVL}: ${a.ssgMissingFunctions?.join(', ') || 'unknown'}`,
                    fixPath: a.ssgFixPath,
                    resolved: s.resolved,
                });
            }
        }
    }
    return { failureToFix: patterns };
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
