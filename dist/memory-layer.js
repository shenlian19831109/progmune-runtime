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
exports.WorkMemory = void 0;
exports.recordEpisode = recordEpisode;
exports.getRecentEpisodes = getRecentEpisodes;
exports.getSuccessfulEpisodes = getSuccessfulEpisodes;
exports.consolidateSemantic = consolidateSemantic;
exports.findSemanticTemplate = findSemanticTemplate;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// 基于项目路径的隔离记忆目录，可通过环境变量 PROGMUNE_MEMORY_DIR 自定义
// 优先使用 PROGMUNE_PROJECT_DIR（由 MCP 服务器在调用时设置），确保多项目隔离
const projectDir = process.env.PROGMUNE_PROJECT_DIR || process.cwd();
const MEMORY_DIR = process.env.PROGMUNE_MEMORY_DIR
    || path.resolve(projectDir, ".progmune_memory");
function ensureDir(dir) {
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
}
// ========== 工作记忆 ==========
class WorkMemory {
    constructor() {
        this.bindings = new Map();
        this.intent = "";
    }
    setIntent(intent) { this.intent = intent; }
    getIntent() { return this.intent; }
    bind(name, type) { this.bindings.set(name, type); }
    get(name) { return this.bindings.get(name); }
    clear() { this.bindings.clear(); this.intent = ""; }
}
exports.WorkMemory = WorkMemory;
const EPISODIC_FILE = path.join(MEMORY_DIR, "episodic.json");
const MAX_EPISODES = 50;
const EPISODE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天
function loadEpisodes() {
    ensureDir(MEMORY_DIR);
    if (!fs.existsSync(EPISODIC_FILE))
        return [];
    return JSON.parse(fs.readFileSync(EPISODIC_FILE, "utf-8"));
}
function saveEpisodes(episodes) {
    ensureDir(MEMORY_DIR);
    // TTL 衰减：过滤掉超过 7 天的旧记录
    const cutoff = Date.now() - EPISODE_TTL_MS;
    const fresh = episodes.filter(e => new Date(e.timestamp).getTime() > cutoff);
    if (fresh.length !== episodes.length) {
        console.error(`[记忆衰减] 清理了 ${episodes.length - fresh.length} 条过期情景记忆`);
    }
    fs.writeFileSync(EPISODIC_FILE, JSON.stringify(fresh.slice(0, MAX_EPISODES), null, 2));
}
function recordEpisode(episode) {
    const episodes = loadEpisodes();
    const newEpisode = {
        ...episode,
        id: `ep_${Date.now()}`,
        timestamp: new Date().toISOString(),
    };
    episodes.unshift(newEpisode);
    if (episodes.length > MAX_EPISODES) {
        episodes.length = MAX_EPISODES;
    }
    saveEpisodes(episodes);
}
function getRecentEpisodes(limit = 10) {
    return loadEpisodes().slice(0, limit);
}
function getSuccessfulEpisodes(limit = 10) {
    return loadEpisodes().filter(e => e.success).slice(0, limit);
}
const SEMANTIC_FILE = path.join(MEMORY_DIR, "semantic.json");
const SEMANTIC_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天
function loadSemantic() {
    ensureDir(MEMORY_DIR);
    if (!fs.existsSync(SEMANTIC_FILE))
        return [];
    return JSON.parse(fs.readFileSync(SEMANTIC_FILE, "utf-8"));
}
function saveSemantic(templates) {
    ensureDir(MEMORY_DIR);
    // TTL 衰减：清理超过 30 天未使用的语义模板
    const cutoff = Date.now() - SEMANTIC_TTL_MS;
    const fresh = templates.filter(t => new Date(t.lastUsedAt).getTime() > cutoff);
    if (fresh.length !== templates.length) {
        console.error(`[记忆衰减] 清理了 ${templates.length - fresh.length} 个过期语义模板`);
    }
    fs.writeFileSync(SEMANTIC_FILE, JSON.stringify(fresh, null, 2));
}
function consolidateSemantic(minOccurrences = 3) {
    const episodes = getSuccessfulEpisodes(MAX_EPISODES);
    const grouped = new Map();
    for (const ep of episodes) {
        const pattern = ep.intent.substring(0, 20);
        if (!grouped.has(pattern))
            grouped.set(pattern, []);
        grouped.get(pattern).push(ep);
    }
    const templates = loadSemantic();
    for (const [pattern, eps] of grouped) {
        if (eps.length >= minOccurrences) {
            const existing = templates.find(t => t.intentPattern === pattern);
            if (existing) {
                existing.successRate = (existing.successRate * existing.useCount + eps.length) / (existing.useCount + eps.length);
                existing.useCount += eps.length;
                existing.lastUsedAt = new Date().toISOString();
                existing.actionSequence = eps[0].actions;
            }
            else {
                templates.push({
                    id: `tmpl_${Date.now()}`,
                    intentPattern: pattern,
                    actionSequence: eps[0].actions,
                    successRate: 1.0,
                    useCount: eps.length,
                    createdAt: new Date().toISOString(),
                    lastUsedAt: new Date().toISOString(),
                });
            }
        }
    }
    saveSemantic(templates);
    console.error(`[语义记忆] 巩固完成，模板数量: ${templates.length}`);
}
function findSemanticTemplate(intent) {
    const templates = loadSemantic();
    if (templates.length === 0)
        return undefined;
    const prefix = intent.substring(0, 20).toLowerCase();
    const exactMatch = templates.find(t => t.intentPattern.toLowerCase() === prefix);
    if (exactMatch && exactMatch.successRate >= 0.7)
        return exactMatch;
    const fuzzyMatch = templates.find(t => {
        const pattern = t.intentPattern.toLowerCase();
        return (prefix.includes(pattern) || pattern.includes(prefix)) && t.successRate >= 0.8;
    });
    return fuzzyMatch;
}
