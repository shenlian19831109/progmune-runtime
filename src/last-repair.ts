// @progmune-generated session=sess_1780302873969_8chx8 timestamp=2026-06-01T08:34:35.701Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 428 functions, 17 protocol rules
import { getExecutionMetrics } from "./execute";
import { getRecentEpisodes } from "./memory-layer";

export function main() {
  const metrics = getExecutionMetrics();
  const episodes = getRecentEpisodes(0);
  return episodes;
}
main();
