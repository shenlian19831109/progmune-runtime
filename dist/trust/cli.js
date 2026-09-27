"use strict";
/**
 * Phase 1: Trust CLI — `progmune trust` command
 *
 * Usage:
 *   npx ts-node src/trust/cli.ts <projectPath> [options]
 *
 * Options:
 *   --commit <sha>     Git commit SHA
 *   --branch <name>    Git branch name
 *   --policy <path>    Policy config file (default: .progmune-policy.json)
 *   --language <lang>  Project language
 *   --json             Output as JSON
 *   --help, -h         Show help
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
const path = __importStar(require("path"));
const engine_1 = require("./engine");
const terminal_1 = require("./formatters/terminal");
const json_1 = require("./formatters/json");
const ci_1 = require("./formatters/ci");
const args = process.argv.slice(2);
async function main() {
    // Help flag
    if (args.includes("--help") || args.includes("-h")) {
        console.log(`
Progmune Trust CLI — AI Trust Decision Engine

Usage:
  npx ts-node src/trust/cli.ts <projectPath> [options]

Options:
  --commit <sha>      Git commit SHA for audit trail
  --branch <name>     Git branch name
  --policy <path>     Policy config file (default: .progmune-policy.json)
  --language <lang>   Project language (typescript, python, etc.)
  --json              Output machine-readable JSON
  --help, -h          Show this help

Example:
  npx ts-node src/trust/cli.ts . --commit HEAD --json
`);
        process.exit(0);
    }
    // Extract positional arg (project path)
    const positional = args.filter((a) => !a.startsWith("--"));
    const projectPath = positional[0] || process.cwd();
    // Parse flags
    const getFlag = (name) => {
        const idx = args.indexOf(`--${name}`);
        if (idx >= 0 && idx + 1 < args.length) {
            return args[idx + 1];
        }
        return undefined;
    };
    const isJson = args.includes("--json");
    const isCi = args.includes("--ci");
    const commit = getFlag("commit") || "unknown";
    const branch = getFlag("branch");
    const policy = getFlag("policy");
    const language = getFlag("language");
    const ctx = {
        projectPath: path.resolve(projectPath),
        projectName: path.basename(path.resolve(projectPath)),
        commit,
        branch,
        policyName: policy,
        language,
    };
    try {
        const decision = await (0, engine_1.evaluateTrust)(ctx);
        if (isJson) {
            console.log((0, json_1.formatTrustJSON)(decision));
        }
        else if (isCi) {
            console.log((0, ci_1.formatTrustCI)(decision));
        }
        else {
            console.log((0, terminal_1.formatTrustTerminal)(decision));
        }
        // Exit code reflects decision
        process.exit((0, ci_1.ciExitCode)(decision));
    }
    catch (e) {
        console.error(`❌ Trust evaluation failed: ${e.message}`);
        process.exit(3);
    }
}
main();
