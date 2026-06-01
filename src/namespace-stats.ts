// @progmune-generated session=sess_1780294518049_6plzh timestamp=2026-06-01T06:15:20.012Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 387 functions, 17 protocol rules
import { loadProtocols } from "./semantic-trace";
import { parseProtocolsFromJSON } from "./ssg-validator";
import { buildProtocolChainHint } from "./planner";
import type { FunctionProtocol } from "./planner";

export function main() {
  const protocols = loadProtocols("default");
  const parsed = parseProtocolsFromJSON(protocols);
  const hint = buildProtocolChainHint(parsed);
  return hint;
}
main();
