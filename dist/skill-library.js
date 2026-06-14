"use strict";
/**
 * P5.1: Skill Library
 *
 * Formalizes MacroGraph nodes into a queryable, composable skill catalog.
 *
 * A Skill is a named, reusable action sequence with known preconditions,
 * effects, and success metrics. It abstracts the low-level action space
 * into a higher-level skill space, reducing planner search depth.
 *
 * Three-level hierarchy:
 *   Goal  →  Skill  →  Action
 *   (what)   (how)     (primitive)
 *
 * Example:
 *   Goal:  "safely write config file"
 *   Skill: safe_file_write
 *   Macro: [open_file, write_file, close_file]
 *   Effect: FILE_OPEN → FILE_DIRTY → FILE_CLOSED
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
exports.SkillLibrary = void 0;
exports.printSkillLibrary = printSkillLibrary;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const macro_graph_1 = require("./macro-graph");
const SKILL_DIR = path.resolve(process.env.PROGMUNE_PROJECT_DIR || process.cwd(), ".progmune_corpus", "skills");
function ensureDir(dir) {
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
}
// ═══════════════════════════════════════════════════════════════
// Skill Library
// ═══════════════════════════════════════════════════════════════
class SkillLibrary {
    constructor() {
        this.skills = new Map();
        /** Index: effects → skills that produce this effect. */
        this.byEffect = new Map();
        /** Index: preconditions → skills that require this state. */
        this.byPrecond = new Map();
    }
    /**
     * Learn skills from telemetry via MacroGraph mining.
     */
    learn(telemetry, rules) {
        const builder = new macro_graph_1.MacroGraphBuilder();
        const graph = builder.learnMacros(telemetry, rules, 0.7, 3);
        for (const [, node] of graph.nodes) {
            this.addSkill(nodeToSkill(node));
        }
    }
    /** Add a skill to the library, updating indexes. */
    addSkill(skill) {
        this.skills.set(skill.id, skill);
        for (const effect of skill.effects) {
            const list = this.byEffect.get(effect) || [];
            list.push(skill);
            this.byEffect.set(effect, list);
        }
        for (const pre of skill.preconditions) {
            const list = this.byPrecond.get(pre) || [];
            list.push(skill);
            this.byPrecond.set(pre, list);
        }
    }
    /**
     * Find skills whose preconditions are satisfied by current state.
     */
    findApplicable(currentStates) {
        const currentSet = new Set(currentStates);
        return [...this.skills.values()].filter(s => s.preconditions.length === 0 || s.preconditions.every(p => currentSet.has(p)));
    }
    /**
     * Find skills that produce a target state (effect match).
     */
    findProducers(targetState) {
        return this.byEffect.get(targetState) || [];
    }
    /**
     * Compose a skill chain from current state to goal state.
     *
     * Returns the shortest chain (by skill count) that transforms
     * currentStates into a state set containing targetStates.
     */
    compose(currentStates, targetStates, maxDepth = 4) {
        const chains = [];
        const currentSet = new Set(currentStates);
        // BFS over skill space
        const visited = new Set();
        const queue = [];
        // Seed: skills that can fire from current state
        const startable = this.findApplicable(currentStates);
        for (const s of startable) {
            const next = new Set(currentStates);
            for (const e of s.effects)
                next.add(e);
            queue.push({ skills: [s], states: next, depth: 1 });
            visited.add(s.id);
        }
        while (queue.length > 0 && chains.length < 10) {
            const { skills, states, depth } = queue.shift();
            if (depth > maxDepth)
                continue;
            // Target reached?
            if (targetStates.length > 0 && targetStates.every(t => states.has(t))) {
                chains.push(skills);
                continue;
            }
            // Try the next skill
            const nextSkills = this.findApplicable([...states]);
            for (const ns of nextSkills) {
                if (skills.some(s => s.id === ns.id))
                    continue; // no cycles
                const key = skills.map(s => s.id).join("→") + "→" + ns.id;
                if (visited.has(key))
                    continue;
                visited.add(key);
                const next = new Set(states);
                for (const e of ns.effects)
                    next.add(e);
                queue.push({ skills: [...skills, ns], states: next, depth: depth + 1 });
            }
        }
        // Sort by success rate (descending)
        chains.sort((a, b) => {
            const rA = a.reduce((s, sk) => s + sk.successRate, 0) / a.length;
            const rB = b.reduce((s, sk) => s + sk.successRate, 0) / b.length;
            return rB - rA;
        });
        return chains;
    }
    /**
     * Expand a skill chain into a flat action sequence.
     */
    expand(skills) {
        return skills.flatMap(s => s.macro);
    }
    /**
     * Expand a single skill by name into its action sequence.
     */
    expandSkill(skillId) {
        const skill = this.skills.get(skillId);
        return skill ? [...skill.macro] : null;
    }
    /** All skills in the library. */
    all() {
        return [...this.skills.values()].sort((a, b) => b.successRate - a.successRate);
    }
    /** Number of skills. */
    get size() { return this.skills.size; }
    // ── Persistence ──
    save(filepath) {
        ensureDir(SKILL_DIR);
        const fp = filepath || path.join(SKILL_DIR, `skills-${new Date().toISOString().slice(0, 10)}.json`);
        fs.writeFileSync(fp, JSON.stringify([...this.skills.values()], null, 2));
        return fp;
    }
    load(filepath) {
        const fp = filepath || path.join(SKILL_DIR, `skills-${new Date().toISOString().slice(0, 10)}.json`);
        if (!fs.existsSync(fp))
            return;
        try {
            const data = JSON.parse(fs.readFileSync(fp, "utf-8"));
            for (const s of data)
                this.addSkill(s);
        }
        catch { /* empty or corrupted */ }
    }
}
exports.SkillLibrary = SkillLibrary;
// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════
function nodeToSkill(node) {
    // Infer a goal description from the action names
    const goalPattern = node.actions
        .map(fn => fn.replace(/_/g, " "))
        .join(" then ");
    return {
        id: node.id,
        goal: goalPattern,
        protocol: node.protocol,
        preconditions: node.preconditions,
        effects: node.postconditions,
        macro: node.actions,
        successRate: node.reward,
        acceptanceRate: node.reward,
        frequency: node.frequency,
        avgLatencyMs: node.source?.avgLatencyMs || 0,
    };
}
function printSkillLibrary(library) {
    console.log("\n─── Skill Library ───");
    console.log(`Skills: ${library.size}`);
    console.log();
    const skills = library.all();
    if (skills.length === 0) {
        console.log("  No skills learned yet. Collect more feedback data.");
        return;
    }
    console.log("Success  Accept  Freq  Skill");
    console.log("──────────────────────────────────────────────────");
    for (const s of skills.slice(0, 15)) {
        const succ = (s.successRate * 100).toFixed(0).padStart(4);
        const acc = (s.acceptanceRate * 100).toFixed(0).padStart(4);
        const freq = String(s.frequency).padStart(4);
        console.log(`  ${succ}%  ${acc}%  ${freq}  ${s.goal}`);
        console.log(`         protocol: ${s.protocol.padEnd(12)} pre: [${s.preconditions.join(",") || "none"}] → [${s.effects.join(",") || "none"}]`);
    }
    console.log();
}
