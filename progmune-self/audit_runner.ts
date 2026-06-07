// @progmune-generated session=sess_1780831250052_xgc58 timestamp=2026-06-07T11:21:00.776Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { deriveMetadata } from "./derive-metadata";
import { auditDirectory, formatAuditResult } from "./audit";
import type { AuditResult } from "./audit";

export function main(srcDir: string) {
  const meta = deriveMetadata(srcDir);
  const audit = auditDirectory(srcDir, [object Object]);
  const report = formatAuditResult(audit);
  return report;
}
