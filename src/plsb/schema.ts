/**
 * Phase 9: PLSB JSON Schema Generator
 *
 * Generates the JSON Schema for PLSB v1.0 artifacts.
 * External tools can use this to validate PLSB data.
 */

import * as fs from "fs";
import * as path from "path";
import { PLSB_SCHEMA_URI, PLSB_PUBLIC_URI } from "./artifact";

export const PLSB_SCHEMA_PATH = "benchmarks/plsb-schema.json";

export function generatePLSBSchema(outputPath?: string): object {
  const schema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: PLSB_SCHEMA_URI,
    title: "Protocol Lifecycle Security Benchmark (PLSB) v1.0",
    description:
      "A benchmark for protocol lifecycle vulnerabilities — missing states, " +
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
        const: PLSB_PUBLIC_URI,
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
