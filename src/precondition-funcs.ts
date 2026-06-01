// @progmune-generated session=sess_1780294758264_q5da1 timestamp=2026-06-01T06:19:19.558Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 394 functions, 17 protocol rules
import { loadProtocols } from "./semantic-trace";
import { listAllStates } from "./ssg-validator";
import type { StateTransition } from "./ssg-validator";

export function main() {
  const protocols = loadProtocols("default");
  const states = listAllStates({} as StateTransition[]);
  return states;
}
main();
