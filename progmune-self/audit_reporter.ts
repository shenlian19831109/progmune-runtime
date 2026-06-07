// @progmune-generated session=sess_1780751693711_ziwd1 timestamp=2026-06-06T13:14:57.583Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { formatAuditResult } from "./audit";
import type { AuditResult } from "./audit";

export function main(result: AuditResult) {
  const report = formatAuditResult(result);
  return report;
}
