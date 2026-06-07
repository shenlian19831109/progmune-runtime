// @progmune-generated session=sess_1780829129525_v10b3 timestamp=2026-06-07T10:45:32.704Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { findFixPathStatic } from "./ssg-validator";
import type { Map } from "./ssg-validator";

export function main(dev_pipeline: string) {
  const states = StateMachineValidator.getNamespaceStates(dev_pipeline);
  const fixPath = findFixPathStatic(states, dev_pipeline, states, states);
  return fixPath;
}
