// @progmune-generated session=sess_1780751309586_5ty7v timestamp=2026-06-06T13:08:33.634Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { registerAllMissingFingerprints, verifyAllFingerprints } from "./ledger-registry";
import { getRuleHash } from "./protocol-registry";

export function main() {
  const fingerprints = registerAllMissingFingerprints();
  const ruleHash = getRuleHash();
  const verification = verifyAllFingerprints(ruleHash);
  return verification;
}
main();
