// @progmune-generated session=sess_1780751224111_sodtp timestamp=2026-06-06T13:07:13.168Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { getFailureAdjustedCredit } from "./feedback";

export function main(extractIR: string, validateAction: string, validateActionSequence: string, emitCode: string, recordSession: string) {
  const credit1 = getFailureAdjustedCredit(extractIR);
  const credit2 = getFailureAdjustedCredit(validateAction);
  const credit3 = getFailureAdjustedCredit(validateActionSequence);
  const credit4 = getFailureAdjustedCredit(emitCode);
  const credit5 = getFailureAdjustedCredit(recordSession);
  return credit5;
}
