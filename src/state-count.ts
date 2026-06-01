// @progmune-generated session=sess_1780304707951_0fip1 timestamp=2026-06-01T09:05:09.696Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 451 functions, 17 protocol rules
import { loadProtocols } from "./semantic-trace";
import { listAllStates } from "./ssg-validator";
import type { StateTransition } from "./ssg-validator";

export function main() {
  const protocols = loadProtocols("default");
  const states = listAllStates(protocols);
  return states;
}
main();
