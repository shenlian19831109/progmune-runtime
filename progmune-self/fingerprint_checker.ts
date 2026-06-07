// @progmune-generated session=sess_1780829022643_ct6xg timestamp=2026-06-07T10:43:46.241Z
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
