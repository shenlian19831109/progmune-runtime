// @progmune-generated session=sess_1780732077065_3s85z timestamp=2026-06-06T07:47:59.892Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { formatAuditResult } from "./audit";
import { formatFailureStats } from "./failure-collector";
import type { AuditResult } from "./audit";

export function main(result: AuditResult) {
  const report = formatAuditResult(result);
  const stats = formatFailureStats();
  return stats;
}
