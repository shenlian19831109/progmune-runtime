import * as fs from "fs";
import * as path from "path";

/**
 * Load IR (Intermediate Representation) from disk.
 * Centralised loader — used by validator, planner, and search modules.
 * Returns the flat function array regardless of whether the on-disk format
 * is a bare array or an object with a `functions` key.
 */
export function loadIR(filePath?: string): any[] {
  const irPath = filePath || path.resolve(__dirname, "../ir.json");
  if (!fs.existsSync(irPath)) return [];
  const raw = JSON.parse(fs.readFileSync(irPath, "utf-8"));
  return Array.isArray(raw) ? raw : (raw.functions || []);
}

/** Count exported functions in an IR function list.
 * @requires IR_FUNCTIONS @produces EXPORT_COUNT
 * @tags ir, count, export
 */
export function countExported(ir: any[]): number {
  return ir.filter((f: any) => f.exported).length;
}

/** Merge two results into a combined object.
 * @requires RESULT_A @produces MERGED_RESULT
 * @tags merge, combine
 */
export function mergeResults(a: any, b: any): { first: any; second: any } {
  return { first: a, second: b };
}

/**
 * Get all exported function declarations with capability metadata.
 * @requires IR_FUNCTIONS @produces EXPORTED_DECLARATIONS
 * @purpose Return exported functions with their purpose, requires, and produces
 * @tags ir, export, catalog
 * @useWhen building capability catalogs, listing available functions
 */
export function getExportedDeclarations(): any[] {
  const allFuncs = loadIR();
  return allFuncs
    .filter((f: any) => f.exported)
    .map((f: any) => ({
      name: f.name,
      purpose: f.purpose || "",
      requires: f.requires || [],
      produces: f.produces || [],
      tags: f.tags || [],
      file: f.file,
    }));
}
