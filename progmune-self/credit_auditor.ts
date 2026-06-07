// @progmune-generated session=sess_1780828986242_94zm5 timestamp=2026-06-07T10:43:09.346Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { getAllFailures } from "./failure-corpus";
import { getFailureAdjustedCredit } from "./feedback";

export function main() {
  const failures = getAllFailures();
  const credit = getFailureAdjustedCredit(failures);
  return credit;
}
main();
