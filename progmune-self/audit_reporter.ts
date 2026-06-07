// @progmune-generated session=sess_1780831271521_iwcm9 timestamp=2026-06-07T11:21:21.146Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { formatAuditResult } from "./audit";
import { formatFailureStats } from "./failure-collector";
import type { AuditResult } from "./audit";

export function main(result: AuditResult) {
  const auditResult = formatAuditResult(result);
  const failureStats = formatFailureStats();
  return failureStats;
}
