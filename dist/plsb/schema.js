"use strict";
/**
 * Phase 9: PLSB JSON Schema Generator
 *
 * Generates the JSON Schema for PLSB v1.0 artifacts.
 * External tools can use this to validate PLSB data.
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
exports.PLSB_SCHEMA_PATH = void 0;
exports.generatePLSBSchema = generatePLSBSchema;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const artifact_1 = require("./artifact");
exports.PLSB_SCHEMA_PATH = "benchmarks/plsb-schema.json";
function generatePLSBSchema(outputPath) {
    const schema = {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $id: artifact_1.PLSB_SCHEMA_URI,
        title: "Protocol Lifecycle Security Benchmark (PLSB) v1.0",
        description: "A benchmark for protocol lifecycle vulnerabilities — missing states, " +
            "missing edges, and illegal transitions that traditional SAST cannot detect. " +
            "13-category taxonomy covering resource leaks, auth bypass, transaction violations, " +
            "memory safety, and state consistency.",
        type: "object",
        required: ["$schema", "@id", "@version", "generated", "entries", "benchmark", "provenance"],
        properties: {
            $schema: {
                type: "string",
                format: "uri",
                description: "JSON Schema URI for this artifact",
            },
            "@id": {
                type: "string",
                format: "uri",
                description: "Permanent public reference URI for this benchmark version",
                const: artifact_1.PLSB_PUBLIC_URI,
            },
            "@version": {
                type: "string",
                description: "Semantic version of this artifact",
                pattern: "^\\d+\\.\\d+\\.\\d+$",
            },
            generated: {
                type: "string",
                format: "date-time",
                description: "ISO 8601 timestamp of generation",
            },
            entries: {
                type: "array",
                description: "Individual benchmark cases (vulnerability sequences)",
                items: {
                    type: "object",
                    required: ["id", "category", "severity", "broken", "expected", "verified", "source"],
                    properties: {
                        id: { type: "string" },
                        pls_id: { type: "string", pattern: "^PLS-\\d{3}$" },
                        category: { type: "string" },
                        severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
                        broken: { type: "array", items: { type: "string" } },
                        expected: { type: "array", items: { type: "string" } },
                        verified: { type: "boolean" },
                        source: { type: "string" },
                        cve: { type: "string" },
                        project: { type: "string" },
                        notes: { type: "string" },
                    },
                },
            },
            benchmark: {
                type: "object",
                required: ["name", "version", "taxonomy", "metadata"],
                properties: {
                    name: { type: "string", description: "Benchmark name" },
                    version: { type: "string" },
                    taxonomy: {
                        type: "array",
                        description: "Protocol Weakness Taxonomy (13 categories)",
                        items: {
                            type: "object",
                            required: ["id", "name", "category", "description"],
                            properties: {
                                id: {
                                    type: "string",
                                    description: "Unique PLS identifier (e.g., PLS-001)",
                                    pattern: "^PLS-\\d{3}$",
                                },
                                name: { type: "string" },
                                category: {
                                    type: "string",
                                    enum: [
                                        "resource_leak", "use_after_free", "auth_bypass",
                                        "session_fixation", "privilege_escalation",
                                        "transaction_violation", "double_free",
                                        "race_condition", "missing_validation",
                                    ],
                                },
                                description: { type: "string" },
                                example_broken: {
                                    type: "array",
                                    items: { type: "string" },
                                },
                                example_expected: {
                                    type: "array",
                                    items: { type: "string" },
                                },
                            },
                        },
                    },
                    metadata: {
                        type: "object",
                        required: ["total", "verified", "coverage", "recall", "precision"],
                        properties: {
                            total: { type: "integer", minimum: 0 },
                            verified: { type: "integer", minimum: 0 },
                            byCategory: { type: "object" },
                            byPLS: { type: "object" },
                            coverage: { type: "number", minimum: 0, maximum: 1 },
                            recall: { type: "number", minimum: 0, maximum: 1 },
                            precision: { type: "number", minimum: 0, maximum: 1 },
                        },
                    },
                },
            },
            provenance: {
                type: "object",
                required: ["source", "version", "corpusHash"],
                properties: {
                    source: { type: "string", description: "Generator identifier" },
                    version: { type: "string" },
                    corpusHash: {
                        type: "string",
                        description: "SHA-256 hash of the benchmark corpus",
                    },
                },
            },
        },
    };
    if (outputPath) {
        const outDir = path.dirname(outputPath);
        if (!fs.existsSync(outDir)) {
            fs.mkdirSync(outDir, { recursive: true });
        }
        fs.writeFileSync(outputPath, JSON.stringify(schema, null, 2), "utf-8");
    }
    return schema;
}
