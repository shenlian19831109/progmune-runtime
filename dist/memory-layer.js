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
exports.pruneEpisodicMemory = pruneEpisodicMemory;
exports.consolidateSemantic = consolidateSemantic;
exports.findSemanticTemplate = findSemanticTemplate;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const file_lock_1 = require("./file-lock");
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
    const all = JSON.parse(fs.readFileSync(EPISODIC_FILE, "utf-8"));
    const cutoff = Date.now() - EPISODE_TTL_MS;
    const fresh = all.filter(e => new Date(e.timestamp).getTime() > cutoff);
    if (fresh.length < all.length) {
        console.error(`[记忆衰减-读取] 过滤了 ${all.length - fresh.length} 条过期情景记忆`);
        fs.writeFileSync(EPISODIC_FILE, JSON.stringify(fresh, null, 2));
    }
    return fresh;
}
function saveEpisodes(episodes) {
    (0, file_lock_1.withLock)("episodic.json", () => {
        ensureDir(MEMORY_DIR);
        const cutoff = Date.now() - EPISODE_TTL_MS;
        const fresh = episodes.filter(e => new Date(e.timestamp).getTime() > cutoff);
        if (fresh.length !== episodes.length) {
            console.error(`[记忆衰减-写入] 清理了 ${episodes.length - fresh.length} 条过期情景记忆`);
        }
        fs.writeFileSync(EPISODIC_FILE, JSON.stringify(fresh.slice(0, MAX_EPISODES), null, 2));
    });
}
/** @requires EXECUTION_DATA @produces MEMORY_ID */
function recordEpisode(episode) {
    const episodes = loadEpisodes();
    const newEpisode = {
        ...episode,
        id: `ep_${Date.now()}`,
        timestamp: new Date().toISOString(),
    };
    episodes.unshift(newEpisode);
    // Simple cap: trim to prevent runaway growth between GC cycles
    if (episodes.length > MAX_EPISODES * 1.5) {
        episodes.length = MAX_EPISODES;
    }
    saveEpisodes(episodes);
    // Run GC every 100 episodes
    if (episodes.length % 100 === 0)
        pruneEpisodicMemory();
}
/** @requires LIMIT @produces EPISODE_LIST */
function getRecentEpisodes(limit = 10) {
    return loadEpisodes().slice(0, limit);
}
function getSuccessfulEpisodes(limit = 10) {
    return loadEpisodes().filter(e => e.success).slice(0, limit);
}
// ── Semantic GC: prune episodic memory ──
const MAX_EPISODES = 1000;
const MAX_AGE_DAYS = 30;
/** Prune episodic memory: keep high-value, recent, diverse episodes.
 *  Removes: old failures (>30 days), low-value duplicates, excess beyond max.
 *  Called periodically after recording new episodes. */
function pruneEpisodicMemory() {
    const episodes = loadEpisodes();
    if (episodes.length <= MAX_EPISODES)
        return 0;
    const now = Date.now();
    const scored = episodes.map((ep, i) => {
        const ageDays = (now - new Date(ep.timestamp).getTime()) / 86400000;
        // Score: success=+2, recent=+3, older=-1/day
        let score = ep.success ? 2 : 0;
        score += Math.max(0, 3 - ageDays * 0.5); // recent bonus, decays over 6 days
        score -= Math.max(0, (ageDays - MAX_AGE_DAYS) * 0.5); // penalty for >30 days
        return { ep, score, index: i };
    });
    // Keep top MAX_EPISODES by score
    scored.sort((a, b) => b.score - a.score);
    const kept = scored.slice(0, MAX_EPISODES).sort((a, b) => a.index - b.index);
    const removed = episodes.length - kept.length;
    if (removed > 0) {
        saveEpisodes(kept.map(s => s.ep));
        console.error(`[Memory] Semantic GC: removed ${removed} low-value episodes, kept ${kept.length}`);
    }
    return removed;
}
const SEMANTIC_FILE = path.join(MEMORY_DIR, "semantic.json");
const SEMANTIC_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天
function loadSemantic() {
    ensureDir(MEMORY_DIR);
    if (!fs.existsSync(SEMANTIC_FILE))
        return [];
    const all = JSON.parse(fs.readFileSync(SEMANTIC_FILE, "utf-8"));
    const cutoff = Date.now() - SEMANTIC_TTL_MS;
    const fresh = all.filter(t => new Date(t.lastUsedAt).getTime() > cutoff);
    if (fresh.length < all.length) {
        console.error(`[记忆衰减-读取] 清理了 ${all.length - fresh.length} 个过期语义模板`);
        fs.writeFileSync(SEMANTIC_FILE, JSON.stringify(fresh, null, 2));
    }
    return fresh;
}
function saveSemantic(templates) {
    (0, file_lock_1.withLock)("semantic.json", () => {
        ensureDir(MEMORY_DIR);
        // TTL 衰减：清理超过 30 天未使用的语义模板
        const cutoff = Date.now() - SEMANTIC_TTL_MS;
        const fresh = templates.filter(t => new Date(t.lastUsedAt).getTime() > cutoff);
        if (fresh.length !== templates.length) {
            console.error(`[记忆衰减] 清理了 ${templates.length - fresh.length} 个过期语义模板`);
        }
        fs.writeFileSync(SEMANTIC_FILE, JSON.stringify(fresh, null, 2));
    });
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
/** @requires INTENT @produces TEMPLATE
 *  Uses keyword overlap (replaces prefix matching) for semantic recall. */
function findSemanticTemplate(intent) {
    const templates = loadSemantic();
    if (templates.length === 0)
        return undefined;
    // Extract keywords from intent
    const words = new Set(intent.toLowerCase().split(/[\s,，]+/).filter(w => w.length > 2));
    if (words.size === 0)
        return undefined;
    // Score templates by keyword overlap
    let best;
    let bestScore = 0;
    for (const t of templates) {
        const tWords = t.intentPattern.toLowerCase().split(/[\s,，]+/);
        const shared = tWords.filter(w => words.has(w)).length;
        const total = new Set([...words, ...new Set(tWords)]).size;
        const score = shared / (total || 1); // Jaccard-like
        if (score > 0.5 && t.successRate >= 0.7 && score > bestScore) {
            bestScore = score;
            best = t;
        }
    }
    return best;
}
