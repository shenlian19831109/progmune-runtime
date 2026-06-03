import * as fs from "fs";
import * as path from "path";
/**
 * Load IR (Intermediate Representation) from disk.
 * Centralised loader — used by validator, planner, and search modules.
 * Returns the flat function array regardless of whether the on-disk format
 * is a bare array or an object with a `functions` key.
 */
export function loadIR(filePath) {
    const irPath = filePath || path.resolve(__dirname, "../ir.json");
    if (!fs.existsSync(irPath))
        return [];
    const raw = JSON.parse(fs.readFileSync(irPath, "utf-8"));
    return Array.isArray(raw) ? raw : (raw.functions || []);
}
/** Count exported functions in an IR function list.
 * @requires IR_FUNCTIONS @produces EXPORT_COUNT
 * @tags ir, count, export
 */
export function countExported(ir) {
    return ir.filter((f) => f.exported).length;
}
/** Merge two results into a combined object.
 * @requires RESULT_A @produces MERGED_RESULT
 * @tags merge, combine
 */
export function mergeResults(a, b) {
    return { first: a, second: b };
}
