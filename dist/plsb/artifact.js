"use strict";
/**
 * Phase 9: PLSB Artifact Generator
 *
 * Generates the versioned PLSB v1.0 JSON artifact.
 * This is a standalone, self-describing benchmark file
 * suitable for external consumption (evaluators, CI, papers).
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
exports.PLSB_ARTIFACT_PATH = exports.PLSB_SCHEMA_URI = exports.PLSB_PUBLIC_URI = void 0;
exports.generatePLSBArtifact = generatePLSBArtifact;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
/** Public reference URI for PLSB v1.0 — fixed, citable URL */
exports.PLSB_PUBLIC_URI = "https://progmune.io/plsb/v1.0";
exports.PLSB_SCHEMA_URI = `${exports.PLSB_PUBLIC_URI}/schema.json`;
function generatePLSBArtifact(outputPath) {
    const { buildPLSB, PROTOCOL_WEAKNESS_TAXONOMY } = require("../plsb-benchmark");
    const benchmark = buildPLSB();
    // Build a corpus hash from the benchmark content
    const corpusHash = crypto
        .createHash("sha256")
        .update(JSON.stringify(benchmark))
        .digest("hex")
        .slice(0, 16);
    const artifact = {
        $schema: exports.PLSB_SCHEMA_URI,
        "@id": exports.PLSB_PUBLIC_URI,
        "@version": "1.0.0",
        generated: new Date().toISOString(),
        entries: (benchmark.entries || []).map((e) => ({
            id: e.id,
            pls_id: e.pls_id || undefined,
            category: e.category,
            severity: e.severity,
            broken: e.broken || [],
            expected: e.expected || [],
            verified: e.verified || false,
            source: e.source || "unknown",
            cve: e.cve || undefined,
            project: e.project || undefined,
            notes: e.notes || undefined,
        })),
        benchmark: {
            name: benchmark.name || "PLSB-100",
            version: benchmark.version || "1.0",
            taxonomy: PROTOCOL_WEAKNESS_TAXONOMY.map((t) => ({
                id: t.id,
                name: t.name,
                category: t.category,
                description: t.description,
                example_broken: t.example_broken || [],
                example_expected: t.example_expected || [],
            })),
            metadata: {
                total: benchmark.metadata?.total || 0,
                verified: benchmark.metadata?.verified || 0,
                byCategory: benchmark.metadata?.byCategory || {},
                byPLS: benchmark.metadata?.byPLS || {},
                coverage: benchmark.metadata?.coverage || 0,
                recall: benchmark.metadata?.recall || 0,
                precision: benchmark.metadata?.precision || 0,
            },
        },
        provenance: {
            source: "progmune-runtime",
            version: "3.2.0",
            corpusHash,
        },
    };
    // Write to disk
    if (outputPath) {
        const outDir = path.dirname(outputPath);
        if (!fs.existsSync(outDir)) {
            fs.mkdirSync(outDir, { recursive: true });
        }
        fs.writeFileSync(outputPath, JSON.stringify(artifact, null, 2), "utf-8");
    }
    return artifact;
}
/** Default output path for the PLSB artifact */
exports.PLSB_ARTIFACT_PATH = "benchmarks/plsb-v1.0.json";
