// @progmune-generated session=sess_1780750745331_yqzx7 timestamp=2026-06-06T12:59:09.980Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { formatAuditResult } from "./audit";
import { formatFailureStats } from "./failure-collector";
import type { AuditResult } from "./audit";

export function main(result: AuditResult) {
  const report = formatAuditResult(result);
  const stats = formatFailureStats();
  return stats;
}
