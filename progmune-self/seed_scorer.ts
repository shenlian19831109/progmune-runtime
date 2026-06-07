import { topByScore } from "./strategy-planner";
import { scoreNode } from "./strategy-planner";
// @progmune-generated session=sess_1780751628590_hxwpa timestamp=2026-06-06T13:13:52.158Z
// Generated with IR constraint: 549 functions, 7 protocol rules

export function main(candidates: CapabilityNode, intent: string, keywords: string[]) {
  const scores = scoreNode(candidates, intent, keywords);
  const top = topByScore(scores);
  return top;
}
