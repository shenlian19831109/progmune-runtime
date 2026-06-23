/**
 * Phase 9: PLSB Artifact Generator
 *
 * Generates the versioned PLSB v1.0 JSON artifact.
 * This is a standalone, self-describing benchmark file
 * suitable for external consumption (evaluators, CI, papers).
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

/** Public reference URI for PLSB v1.0 — fixed, citable URL */
export const PLSB_PUBLIC_URI = "https://progmune.io/plsb/v1.0";
export const PLSB_SCHEMA_URI = `${PLSB_PUBLIC_URI}/schema.json`;

export interface PLSBArtifact {
  $schema: string;             // JSON Schema URI
  "@id": string;               // Public reference URI (permanent)
  "@version": string;          // Semantic version
  generated: string;           // ISO 8601 timestamp
  entries: Array<{
    id: string;
    pls_id?: string;
    category: string;
    severity: "critical" | "high" | "medium" | "low";
    broken: string[];
    expected: string[];
    verified: boolean;
    source: string;
    cve?: string;
    project?: string;
    notes?: string;
  }>;
  benchmark: {
    name: string;
    version: string;
    taxonomy: Array<{
      id: string;
      name: string;
      category: string;
      description: string;
      example_broken: string[];
      example_expected: string[];
    }>;
    metadata: {
      total: number;
      verified: number;
      byCategory: Record<string, number>;
      byPLS: Record<string, number>;
      coverage: number;
      recall: number;
      precision: number;
    };
  };
  provenance: {
    source: string;
    version: string;
    corpusHash: string;
  };
}

export function generatePLSBArtifact(
  outputPath?: string
): PLSBArtifact {
  const { buildPLSB, PROTOCOL_WEAKNESS_TAXONOMY } = require("../plsb-benchmark");
  const benchmark = buildPLSB();

  // Build a corpus hash from the benchmark content
  const corpusHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(benchmark))
    .digest("hex")
    .slice(0, 16);

  const artifact: PLSBArtifact = {
    $schema: PLSB_SCHEMA_URI,
    "@id": PLSB_PUBLIC_URI,
    "@version": "1.0.0",
    generated: new Date().toISOString(),
    entries: (benchmark.entries || []).map((e: any) => ({
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
      taxonomy: PROTOCOL_WEAKNESS_TAXONOMY.map((t: any) => ({
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
export const PLSB_ARTIFACT_PATH = "benchmarks/plsb-v1.0.json";
