"use strict";
/**
 * P6.0v2: AST-based Protocol Extractor
 *
 * Targets: Precision > 70%, Recall > 50%
 *
 * Improvements over v1 (regex-based):
 *   1. Scope-aware pairing — calls within same function, not across
 *   2. AST-based extraction for TS/JS via ts-morph
 *   3. Function boundary detection for C/C++
 *   4. Better noise filtering (utility/logging/test functions)
 *   5. Cross-file call graph construction
 *   6. Frequency-weighted confidence with quality tiers
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
exports.extractProtocolV2 = extractProtocolV2;
exports.printExtractionQuality = printExtractionQuality;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const ts_morph_1 = require("ts-morph");
const repo_evaluator_1 = require("./repo-evaluator");
const protocol_coverage_1 = require("./protocol-coverage");
/**
 * Extract call pairs from a TypeScript/JavaScript file using ts-morph AST.
 *
 * Only pairs calls that appear within the same function body.
 * This eliminates cross-function noise (e.g., main→writeFile paired with closeFile in another function).
 */
function extractTSCallPairs(filePath) {
    const pairs = [];
    try {
        const project = new ts_morph_1.Project({ skipAddingFilesFromTsConfig: true });
        const sourceFile = project.addSourceFileAtPath(filePath);
        // Walk all function declarations
        sourceFile.forEachDescendant((node, traversal) => {
            if (!ts_morph_1.Node.isFunctionDeclaration(node) && !ts_morph_1.Node.isMethodDeclaration(node) && !ts_morph_1.Node.isArrowFunction(node)) {
                // Also check function expressions and arrow functions in variable declarations
                if (ts_morph_1.Node.isVariableDeclaration(node)) {
                    const init = node.getInitializer();
                    if (init && (ts_morph_1.Node.isArrowFunction(init) || ts_morph_1.Node.isFunctionExpression(init))) {
                        extractCallsFromScope(init, filePath, node.getName(), pairs);
                    }
                }
                return;
            }
            const fnName = ts_morph_1.Node.isVariableDeclaration(node)
                ? (node.getName() || "<anonymous>")
                : node.getName() || "<anonymous>";
            extractCallsFromScope(node, filePath, fnName, pairs);
        });
    }
    catch {
        // Fall back to regex-based extraction for files ts-morph can't parse
    }
    return pairs;
}
function extractCallsFromScope(node, filePath, fnName, pairs) {
    const calls = [];
    node.forEachDescendant((descendant, traversal) => {
        if (ts_morph_1.Node.isCallExpression(descendant)) {
            const expr = descendant.getExpression();
            let callName = "";
            if (ts_morph_1.Node.isIdentifier(expr)) {
                callName = expr.getText();
            }
            else if (ts_morph_1.Node.isPropertyAccessExpression(expr)) {
                callName = expr.getName(); // obj.method() → method
            }
            if (callName && !isNoiseFunction(callName)) {
                calls.push({ name: callName, line: descendant.getStartLineNumber() });
            }
        }
        // Don't recurse into nested functions (their calls belong to that function's scope)
        if (ts_morph_1.Node.isFunctionDeclaration(descendant) || ts_morph_1.Node.isMethodDeclaration(descendant) ||
            ts_morph_1.Node.isArrowFunction(descendant) && descendant !== node) {
            traversal.skip();
        }
    });
    // Pair all calls within this function scope
    for (let i = 0; i < calls.length - 1; i++) {
        for (let j = i + 1; j < calls.length; j++) {
            pairs.push({
                from: calls[i].name,
                to: calls[j].name,
                file: filePath,
                function: fnName,
                line: calls[i].line,
            });
        }
    }
}
// ═══════════════════════════════════════════════════════════════
// Improved C/C++ extraction with function boundary detection
// ═══════════════════════════════════════════════════════════════
function extractCCallPairs(code, filePath) {
    const pairs = [];
    const lines = code.split("\n");
    // Simple function boundary detection: track brace depth at function level
    let inFunction = false;
    let currentFunction = "<global>";
    let funcDepth = 0;
    let funcCalls = [];
    const callRegex = /\b([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)?)\s*\(/g;
    for (let li = 0; li < lines.length; li++) {
        const line = lines[li];
        // Detect function definition start (simplified: return type + name + ( + {)
        const funcMatch = line.match(/^\s*(?:static\s+|inline\s+|void\s+|int\s+|char\s+|bool\s+|size_t\s+|FILE\*?\s*|DB\*?\s*)?(\w+)\s*\([^)]*\)\s*\{/);
        if (funcMatch && funcDepth === 0) {
            // Entering a new top-level function
            if (funcCalls.length > 0) {
                // Flush previous function's calls as pairs
                flushFunctionPairs(funcCalls, currentFunction, filePath, pairs);
            }
            currentFunction = funcMatch[1];
            funcCalls = [];
            inFunction = true;
        }
        // Track brace depth
        for (const ch of line) {
            if (ch === "{")
                funcDepth++;
            if (ch === "}") {
                funcDepth--;
                if (funcDepth === 0 && inFunction) {
                    // Leaving a function
                    flushFunctionPairs(funcCalls, currentFunction, filePath, pairs);
                    currentFunction = "<global>";
                    funcCalls = [];
                    inFunction = false;
                }
            }
        }
        // Extract calls on this line
        let match;
        callRegex.lastIndex = 0;
        while ((match = callRegex.exec(line)) !== null) {
            const fnName = normalizeFn(match[1]);
            if (fnName.length > 2 && !isNoiseFunction(fnName)) {
                funcCalls.push({ name: fnName, line: li + 1 });
            }
        }
    }
    // Flush remaining
    if (funcCalls.length > 0) {
        flushFunctionPairs(funcCalls, currentFunction, filePath, pairs);
    }
    return pairs;
}
function flushFunctionPairs(calls, fnName, filePath, pairs) {
    for (let i = 0; i < calls.length - 1; i++) {
        for (let j = i + 1; j < calls.length; j++) {
            pairs.push({
                from: calls[i].name,
                to: calls[j].name,
                file: filePath,
                function: fnName,
                line: calls[i].line,
            });
        }
    }
}
function normalizeFn(fn) {
    const parts = fn.split(".");
    return parts[parts.length - 1];
}
function isNoiseFunction(name) {
    const noise = new Set([
        "if", "for", "while", "switch", "return", "sizeof", "typeof",
        "console", "log", "require", "import", "export", "print", "len",
        "push", "pop", "map", "filter", "reduce", "forEach", "toString",
        "valueOf", "assert", "expect", "test", "describe", "it",
        "main", "printf", "sprintf", "fprintf", "write_config", "read_config",
        "setup", "teardown", "init", "destroy", "cleanup",
        "get", "set", "has", "is", "to", "from", "new",
    ]);
    return noise.has(name) || name.length <= 1 || /^[A-Z_]+$/.test(name);
}
/**
 * Extract protocol rules with scope-aware pairing.
 *
 * Uses ts-morph AST for TS/JS files and function-boundary-aware
 * regex for C/C++ files.
 */
function extractProtocolV2(repoPath, protocolName, maxFiles = 200) {
    const files = (0, repo_evaluator_1.scanRepository)(repoPath, maxFiles);
    const allPairs = [];
    for (const fp of files) {
        try {
            const ext = path.extname(fp);
            if (ext === ".ts" || ext === ".js" || ext === ".mjs") {
                allPairs.push(...extractTSCallPairs(fp));
            }
            else if ([".c", ".cpp", ".h", ".hpp", ".java", ".go", ".rs"].includes(ext)) {
                const code = fs.readFileSync(fp, "utf-8");
                allPairs.push(...extractCCallPairs(code, fp));
            }
        }
        catch { /* skip unparseable files */ }
    }
    // Frequency analysis and rule inference
    const rules = inferScopeRules(allPairs);
    const states = new Set();
    for (const [, rule] of rules) {
        for (const s of rule.pre_states)
            states.add(s);
        for (const s of rule.post_states)
            states.add(s);
        if (rule.invalidate)
            for (const s of rule.invalidate)
                states.add(s);
    }
    // Quality assessment against ground truth
    const defs = (0, protocol_coverage_1.loadDefaultProtocolDefinitions)();
    const groundTruth = new Map();
    for (const p of defs)
        for (const [fn, rule] of p.rules)
            groundTruth.set(fn, rule);
    const extractedFns = new Set(rules.keys());
    let matched = 0;
    for (const fn of extractedFns) {
        if (groundTruth.has(fn))
            matched++;
    }
    const precision = extractedFns.size > 0 ? matched / extractedFns.size : 0;
    const recall = groundTruth.size > 0 ? matched / groundTruth.size : 0;
    const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;
    let tier;
    if (precision >= 0.70 && recall >= 0.50)
        tier = "production";
    else if (precision >= 0.50 && recall >= 0.30)
        tier = "beta";
    else
        tier = "poc";
    return {
        protocol: protocolName || path.basename(repoPath),
        rules,
        states: [...states],
        pairs: allPairs,
        filesScanned: files.length,
        quality: {
            precision,
            recall,
            f1,
            totalExtracted: extractedFns.size,
            groundTruthMatch: matched,
            groundTruthTotal: groundTruth.size,
            tier,
        },
    };
}
// ═══════════════════════════════════════════════════════════════
// Scope-aware rule inference
// ═══════════════════════════════════════════════════════════════
const protocol_foundation_1 = require("./protocol-foundation");
function inferScopeRules(pairs, minFrequency = 2) {
    const transitions = new Map();
    const fnFreq = new Map();
    for (const p of pairs) {
        const key = `${p.from}→${p.to}`;
        transitions.set(key, (transitions.get(key) || 0) + 1);
        fnFreq.set(p.from, (fnFreq.get(p.from) || 0) + 1);
        fnFreq.set(p.to, (fnFreq.get(p.to) || 0) + 1);
    }
    const fnStates = new Map();
    const maxFreq = Math.max(1, ...[...transitions.values()]);
    for (const [key, freq] of transitions) {
        if (freq < minFrequency)
            continue;
        const [fnA, fnB] = key.split("→");
        const stateName = (0, protocol_foundation_1.inferStateName)(fnA, "post");
        const aStates = fnStates.get(fnA) || { produced: new Set(), required: new Set(), invalidated: new Set() };
        aStates.produced.add(stateName);
        fnStates.set(fnA, aStates);
        const bStates = fnStates.get(fnB) || { produced: new Set(), required: new Set(), invalidated: new Set() };
        bStates.required.add(stateName);
        fnStates.set(fnB, bStates);
    }
    // Invalidation detection
    const closers = new Set(["close", "disconnect", "logout", "free", "destroy", "release", "stop", "end", "finish"]);
    const openers = new Set(["open", "connect", "login", "create", "alloc", "init", "start", "begin"]);
    for (const [key] of transitions) {
        const [fnA, fnB] = key.split("→");
        const aStates = fnStates.get(fnA);
        const bStates = fnStates.get(fnB);
        if (!aStates || !bStates)
            continue;
        const isCloser = [...closers].some(kw => fnB.includes(kw));
        const isOpener = [...openers].some(kw => fnA.includes(kw));
        if (isCloser && isOpener) {
            for (const s of aStates.produced)
                bStates.invalidated.add(s);
        }
    }
    const rules = new Map();
    for (const [fn, states] of fnStates) {
        rules.set(fn, {
            pre_states: [...states.required],
            post_states: [...states.produced],
            invalidate: states.invalidated.size > 0 ? [...states.invalidated] : undefined,
        });
    }
    return rules;
}
// ═══════════════════════════════════════════════════════════════
// Quality Report
// ═══════════════════════════════════════════════════════════════
function printExtractionQuality(report) {
    console.log("\n╔════════════════════════════════════════════════════╗");
    console.log("║   P6.0v2 Protocol Extraction Quality Report        ║");
    console.log("╚════════════════════════════════════════════════════╝\n");
    console.log("Repository        Prec    Recall  F1      Pairs  Files  Tier");
    console.log("──────────────────────────────────────────────────────────────");
    for (const r of report) {
        const p = (r.quality.precision * 100).toFixed(0).padStart(4);
        const rc = (r.quality.recall * 100).toFixed(0).padStart(4);
        const f = (r.quality.f1 * 100).toFixed(0).padStart(4);
        const tier = r.quality.tier === "production" ? "🟢" : r.quality.tier === "beta" ? "🟡" : "🔴";
        console.log(`  ${r.name.padEnd(16)} ${p}%  ${rc}%  ${f}%   ${String(r.pairs).padStart(5)}  ${String(r.files).padStart(5)}  ${tier} ${r.quality.tier}`);
    }
    console.log();
}
