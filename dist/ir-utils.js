"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.countExported = countExported;
exports.mergeResults = mergeResults;
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
