// @progmune-generated session=sess_1780751587102_l3a0t timestamp=2026-06-06T13:13:09.910Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { pruneEpisodicMemory, recordEpisode } from "./memory-layer";
import type { Omit } from "./memory-layer";

export function main() {
  const pruned = pruneEpisodicMemory();
  const episode = recordEpisode(pruned);
  return episode;
}
main();
