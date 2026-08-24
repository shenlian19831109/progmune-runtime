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
exports.loadIR = loadIR;
exports.countExported = countExported;
exports.mergeResults = mergeResults;
exports.getExportedDeclarations = getExportedDeclarations;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * Load IR (Intermediate Representation) from disk.
 * Centralised loader — used by validator, planner, and search modules.
 * Returns the flat function array regardless of whether the on-disk format
 * is a bare array or an object with a `functions` key.
 */
function loadIR(filePath) {
    // Resolution order: explicit path → PROGMUNE_PROJECT_DIR → CWD →
    // package directory (legacy fallback). The package dir must be LAST —
    // in an installed-package setup the project's ir.json lives in the
    // consuming project, not inside node_modules/progmune-runtime.
    const candidates = [];
    if (filePath)
        candidates.push(filePath);
    const projectDir = process.env.PROGMUNE_PROJECT_DIR;
    if (projectDir)
        candidates.push(path.resolve(projectDir, "ir.json"));
    candidates.push(path.resolve(process.cwd(), "ir.json"));
    candidates.push(path.resolve(__dirname, "../ir.json"));
    for (const irPath of candidates) {
        if (fs.existsSync(irPath)) {
            const raw = JSON.parse(fs.readFileSync(irPath, "utf-8"));
            return Array.isArray(raw) ? raw : (raw.functions || []);
        }
    }
    return [];
}
/** Count exported functions in an IR function list.
 * @requires IR_FUNCTIONS @produces EXPORT_COUNT
 * @tags ir, count, export
 */
function countExported(ir) {
    return ir.filter((f) => f.exported).length;
}
/** Merge two results into a combined object.
 * @requires RESULT_A @produces MERGED_RESULT
 * @tags merge, combine
 */
function mergeResults(a, b) {
    return { first: a, second: b };
}
/**
 * Get all exported function declarations with capability metadata.
 * @requires IR_FUNCTIONS @produces EXPORTED_DECLARATIONS
 * @purpose Return exported functions with their purpose, requires, and produces
 * @tags ir, export, catalog
 * @useWhen building capability catalogs, listing available functions
 */
function getExportedDeclarations() {
    const allFuncs = loadIR();
    return allFuncs
        .filter((f) => f.exported)
        .map((f) => ({
        name: f.name,
        purpose: f.purpose || "",
        requires: f.requires || [],
        produces: f.produces || [],
        tags: f.tags || [],
        file: f.file,
    }));
}
