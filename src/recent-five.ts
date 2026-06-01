// @progmune-generated session=sess_1780304660211_kfahn timestamp=2026-06-01T09:04:22.303Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 446 functions, 17 protocol rules
import { getExecutionMetrics } from "./execute";
import { getRecentEpisodes } from "./memory-layer";

export function main() {
  const metrics = getExecutionMetrics();
  const episodes = getRecentEpisodes(0);
  return episodes;
}
main();
