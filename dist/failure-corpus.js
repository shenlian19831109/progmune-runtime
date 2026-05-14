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
exports.getAllFailures = getAllFailures;
exports.getFailuresBySVL = getFailuresBySVL;
exports.getTopFailurePatterns = getTopFailurePatterns;
exports.generateCandidateRules = generateCandidateRules;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const CORPUS_DIR = path.resolve(__dirname, "../failure_corpus");
function ensureDir(dir) {
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
}
function recordFailure(record) {
    ensureDir(CORPUS_DIR);
    const date = new Date().toISOString().slice(0, 10);
    const dateDir = path.join(CORPUS_DIR, date);
    ensureDir(dateDir);
    const id = `fail_${Date.now()}`;
    const fullRecord = {
        ...record,
        id,
        timestamp: new Date().toISOString(),
    };
    const filename = `${id}.json`;
    const filepath = path.join(dateDir, filename);
    fs.writeFileSync(filepath, JSON.stringify(fullRecord, null, 2));
    console.log(`[FailureCorpus] 记录失败案例: ${id} [${record.violatedSVL}]`);
}
function getAllFailures() {
    const records = [];
    if (!fs.existsSync(CORPUS_DIR))
        return records;
    const dirs = fs.readdirSync(CORPUS_DIR);
    for (const dir of dirs) {
        const dirPath = path.join(CORPUS_DIR, dir);
        if (!fs.statSync(dirPath).isDirectory())
            continue;
        const files = fs.readdirSync(dirPath);
        for (const file of files) {
            if (file.endsWith(".json")) {
                const content = fs.readFileSync(path.join(dirPath, file), "utf-8");
                records.push(JSON.parse(content));
            }
        }
    }
    return records;
}
function getFailuresBySVL(level) {
    return getAllFailures().filter(r => r.violatedSVL === level);
}
function getTopFailurePatterns(limit = 5) {
    const counts = new Map();
    const all = getAllFailures();
    for (const r of all) {
        const key = `${r.violatedSVL}:${r.constraintType}`;
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts.entries()]
        .map(([pattern, count]) => ({ pattern, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);
}
function generateCandidateRules() {
    const patterns = getTopFailurePatterns(3);
    const rules = [];
    for (const p of patterns) {
        if (p.pattern === "SVL-4:protocol") {
            rules.push("建议：为相关函数添加 SSG 协议约束，检查前置状态。");
        }
        else if (p.pattern === "SVL-1:symbol_existence") {
            rules.push("建议：检查项目 IR 是否缺少必要的函数定义。");
        }
        else if (p.pattern === "SVL-3:dataflow") {
            rules.push("建议：强化变量声明检查，确保变量使用前已初始化。");
        }
    }
    return rules;
}
