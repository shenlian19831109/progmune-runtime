// @progmune-generated session=sess_1780831122740_2hg0z timestamp=2026-06-07T11:19:16.493Z
// Generated with IR constraint: 549 functions, 7 protocol rules
import { findRootBranch, findChildBranches } from "./branch-ledger";
import { findSemanticTemplate, consolidateSemantic } from "./memory-layer";
import { findSnapshotBySession } from "./semantic-snapshot";
import { findFixPathStatic, findProducer, findConsumer, findViolations, findTransition } from "./ssg-validator";
import { getSemanticHeatmap } from "./failure-corpus";
import { semanticMatch } from "./planner-prompts";
import { checkSemantic } from "./semantic-validator";
import { extractKeywords } from "./utils";
import { searchPlan } from "./search-planner";
import type { Branch, Map } from "./branch-ledger";
import type { Map } from "./ssg-validator";
import type { StateTransition, Action } from "./runtime-types";

export function main() {
  const findRootBranch_result = findRootBranch("{{branches}}");
  const findChildBranches_result = findChildBranches("{{parent}}", "{{allBranches}}");
  const findSuccessfulLeaf_result = findSuccessfulLeaf("{{branch}}", "{{allBranches}}");
  const findSemanticTemplate_result = findSemanticTemplate("{{intent}}");
  const findCompatibleVar_result = findCompatibleVar("{{declaredVars}}", "{{neededType}}");
  const findSnapshotBySession_result = findSnapshotBySession("{{sessionId}}");
  const SemanticTopology.findSimilar_result = SemanticTopology.findSimilar("{{funcName}}", "{{topN}}");
  const findFixPathStatic_result = findFixPathStatic("{{rules}}", "{{namespace}}", "{{current}}", "{{targetPreStates}}");
  const findProducer_result = findProducer("{{state}}", "{{ledger}}");
  const findConsumer_result = findConsumer("{{state}}", "{{ledger}}");
  const findViolations_result = findViolations("{{ledger}}");
  const findTransition_result = findTransition("{{actionIndex}}", "{{ledger}}");
  const findRelated_result = findRelated("{{graph}}", "{{capability}}", "{{allNodes}}", "{{field}}", "{{isProducer}}");
  const findProducers_result = findProducers("{{graph}}", "{{capability}}", "{{allNodes}}");
  const findConsumers_result = findConsumers("{{graph}}", "{{capability}}", "{{allNodes}}");
  const findIndex_result = findIndex();
  const findSimilar_result = findSimilar();
  const getSemanticHeatmap_result = getSemanticHeatmap();
  const loadSemantic_result = loadSemantic();
  const saveSemantic_result = saveSemantic("{{templates}}");
  const consolidateSemantic_result = consolidateSemantic("{{minOccurrences}}");
  const semanticMatch_result = semanticMatch("{{a}}", "{{b}}");
  const runSemanticTest_result = runSemanticTest();
  const result_0 = SemanticTopology.build("{{ir}}");
  const result_1 = SemanticTopology.addEdge("{{a}}", "{{b}}", "{{weight}}", "{{reason}}");
  const SemanticTopology.similarity_result = SemanticTopology.similarity("{{funcA}}", "{{funcB}}");
  const SemanticTopology.capabilityMatch_result = SemanticTopology.capabilityMatch("{{produce}}", "{{require}}");
  const checkSemantic_result = checkSemantic("{{intent}}", "{{actions}}");
  const WorkMemory.setIntent_result = WorkMemory.setIntent("{{intent}}");
  const WorkMemory.getIntent_result = WorkMemory.getIntent();
  const matchIntent_result = matchIntent("{{intent}}", "{{keywords}}");
  const extractKeywords_result = extractKeywords("{{intent}}");
  const keywordKey_result = keywordKey();
  const searchPlan_result = searchPlan("{{intent}}", "{{beamWidth}}", "{{maxDepth}}");
  return { findRootBranch_result, findChildBranches_result, findSuccessfulLeaf_result, findSemanticTemplate_result, findCompatibleVar_result, findSnapshotBySession_result, SemanticTopology.findSimilar_result, findFixPathStatic_result, findProducer_result, findConsumer_result, findViolations_result, findTransition_result, findRelated_result, findProducers_result, findConsumers_result, findIndex_result, findSimilar_result, getSemanticHeatmap_result, loadSemantic_result, saveSemantic_result, consolidateSemantic_result, semanticMatch_result, runSemanticTest_result, SemanticTopology.similarity_result, SemanticTopology.capabilityMatch_result, checkSemantic_result, WorkMemory.setIntent_result, WorkMemory.getIntent_result, matchIntent_result, extractKeywords_result, keywordKey_result, searchPlan_result };
}
main();
