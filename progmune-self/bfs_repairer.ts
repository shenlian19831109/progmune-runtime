// @progmune-generated session=sess_1780751477014_o6x29 timestamp=2026-06-06T13:11:21.332Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { findFixPathStatic } from "./ssg-validator";
import type { Map } from "./ssg-validator";

export function main(dev_pipeline: string) {
  const states = StateMachineValidator.getNamespaceStates(dev_pipeline);
  const fixPath = findFixPathStatic(states, dev_pipeline, states, states);
  return fixPath;
}
