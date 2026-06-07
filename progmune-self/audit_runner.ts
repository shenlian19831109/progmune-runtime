// @progmune-generated session=sess_1780751676603_2218b timestamp=2026-06-06T13:14:40.401Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { auditDirectory, formatAuditResult } from "./audit";
import type { AuditResult } from "./audit";

export function main(srcDir: string) {
  const auditResult = auditDirectory(srcDir, [object Object]);
  const formattedReport = formatAuditResult(auditResult);
  return formattedReport;
}
