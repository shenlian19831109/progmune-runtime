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
