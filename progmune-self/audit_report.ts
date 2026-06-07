// @progmune-generated session=sess_1780828880150_1kki8 timestamp=2026-06-07T10:41:23.229Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { formatAuditResult } from "./audit";
import { formatFailureStats } from "./failure-collector";
import type { AuditResult } from "./audit";

export function main(result: AuditResult) {
  const report = formatAuditResult(result);
  const stats = formatFailureStats();
  return stats;
}
