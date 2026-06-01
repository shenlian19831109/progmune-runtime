// @progmune-generated session=sess_1780343705506_4rpek timestamp=2026-06-01T19:55:07.332Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 392 functions, 17 protocol rules
import { getExecutionMetrics } from "./execute";
import { getRecentEpisodes } from "./memory-layer";

export function main() {
  const metrics = getExecutionMetrics();
  const episodes = getRecentEpisodes(0);
  return episodes;
}
main();
