# Capability Graph Report

## Overview
- Total functions: **549**
- Exported: **226**
- With produces: **317** (58%)
- With requires: **230** (42%)
- With purpose: **549** (100%)
- Data-flow edges: **3392**

## Top Domains
| Tag | Functions |
|-----|----------|
| (external) | 94 |
| semantic | 69 |
| memory | 56 |
| layer | 56 |
| validator | 40 |
| planner | 34 |
| trace | 33 |
| ssg | 32 |
| ledger | 29 |
| topology | 25 |

## Coverage Trend
- v2.1.4: requires ~26%, produces ~26%, purpose ~30%
- v2.5.x: requires **46%**, produces **62%**, purpose **100%**
- Target (v2.6): requires **80%+**, produces **80%+**

## Sample Chains

## Chain: "generate benchmark report" (score: 6.1)

```mermaid
graph LR
  benchmarkPassRate["benchmarkPassRate<br/><small>★7.4<br/>PASS_RATE_DATA</small>"]
  benchmarkReport["benchmarkReport<br/><small>★13.5<br/>BENCHMARK_REPORT</small>"]
  benchmarkPassRate -->|"PASS_RATE_DATA"| benchmarkReport
  benchmarkCount["benchmarkCount<br/><small>★6.4<br/>TASK_COUNT</small>"]
  benchmarkReport -->|"→"| benchmarkCount
  loadBenchmarks["loadBenchmarks<br/><small>★5.6<br/>BENCHMARK_TASKS</small>"]
  benchmarkCount -->|"→"| loadBenchmarks
  benchmarkLoadLatest["benchmarkLoadLatest<br/><small>★6.3<br/>BENCHMARK_RESULT</small>"]
  loadBenchmarks -->|"→"| benchmarkLoadLatest
```

## Chain: "extract IR from project and validate the actions" (score: 5.4)

```mermaid
graph LR
  loadIR["loadIR<br/><small>★6.8<br/>DATA</small>"]
  validateActionResult["validateActionResult<br/><small>★7.2<br/>VALIDATION_RESULT</small>"]
  loadIR -->|"DATA"| validateActionResult
  validateProposal["validateProposal<br/><small>★6.8<br/>VALIDATION_RESULT</small>"]
  validateActionResult -->|"→"| validateProposal
  validateTransition["validateTransition<br/><small>★5.2<br/>VALIDATION_RESULT</small>"]
  validateProposal -->|"→"| validateTransition
  extractKeywords["extractKeywords<br/><small>★7.5<br/>KEYWORDS</small>"]
  validateTransition -->|"→"| extractKeywords
```

## Chain: "list all sessions and find failure patterns" (score: 8.2)

```mermaid
graph LR
  listAllStates["listAllStates<br/><small>★9.3<br/>DATA</small>"]
  getAllFailures["getAllFailures<br/><small>★9.3<br/>FAILURE_LIST</small>"]
  listAllStates -->|"→"| getAllFailures
  getTopFailurePatterns["getTopFailurePatterns<br/><small>★11.1<br/>FAILURE_PATTERNS</small>"]
  getAllFailures -->|"FAILURE_LIST"| getTopFailurePatterns
  getLearnedPatterns["getLearnedPatterns<br/><small>★8.4<br/>LEARNED_PATTERNS</small>"]
  getTopFailurePatterns -->|"→"| getLearnedPatterns
  getAllSessions["getAllSessions<br/><small>★11.9<br/>SESSION_LIST<br/>SESSION_LIST</small>"]
  getLearnedPatterns -->|"→"| getAllSessions
  countResolved["countResolved<br/><small>★6.3<br/>RESOLVED_COUNT</small>"]
  getAllSessions -->|"SESSION_LIST"| countResolved
```

## Chain: "suggest repairs for a failed session" (score: 5.7)

```mermaid
graph LR
  suggestProtocolRepair["suggestProtocolRepair<br/><small>★5.1</small>"]
  suggestInvariantRepair["suggestInvariantRepair<br/><small>★8.9<br/>DELTA_CHECK</small>"]
  suggestProtocolRepair -->|"→"| suggestInvariantRepair
  countResolved["countResolved<br/><small>★3.4<br/>RESOLVED_COUNT</small>"]
  suggestInvariantRepair -->|"→"| countResolved
  formatSessionCounts["formatSessionCounts<br/><small>★9.2<br/>FORMATTED_COUNT</small>"]
  countResolved -->|"RESOLVED_COUNT"| formatSessionCounts
  getAllSessions["getAllSessions<br/><small>★5.5<br/>SESSION_LIST<br/>SESSION_LIST</small>"]
  formatSessionCounts -->|"→"| getAllSessions
```

## Chain: "compute system health score" (score: 5.6)

```mermaid
graph LR
  formatHealthLevel["formatHealthLevel<br/><small>★8.3<br/>HEALTH_STATUS</small>"]
  computeHealthScore["computeHealthScore<br/><small>★20.6<br/>HEALTH_SCORE</small>"]
  formatHealthLevel -->|"→"| computeHealthScore
  getFailureGenome["getFailureGenome<br/><small>★0.0<br/>FAILURE_GENOME<br/>FAILURE_GENOME</small>"]
  computeHealthScore -->|"→"| getFailureGenome
  loadCheckpoint["loadCheckpoint<br/><small>★0.0<br/>DATA</small>"]
  getFailureGenome -->|"→"| loadCheckpoint
  computeImmuneMetrics["computeImmuneMetrics<br/><small>★5.7<br/>RESULT</small>"]
  loadCheckpoint -->|"→"| computeImmuneMetrics
```

## Full Capability Graph

```mermaid
graph LR
  main[/"main"/]
  executeActionCode[/"executeActionCode"/]
  auditDirectory[/"auditDirectory"/]
  formatAuditResult[/"formatAuditResult"/]
  benchmarkCount[/"benchmarkCount"/]
  main[/"main"/]
  benchmarkPassRate[/"benchmarkPassRate"/]
  benchmarkReport[/"benchmarkReport"/]
  benchmarkSave[/"benchmarkSave"/]
  benchmarkLoadLatest[/"benchmarkLoadLatest"/]
  main[/"main"/]
  generateBranchId[/"generateBranchId"/]
  createRootBranch[/"createRootBranch"/]
  createBranch[/"createBranch"/]
  forkBranch[/"forkBranch"/]
  mergeBranches[/"mergeBranches"/]
  flattenBranch[/"flattenBranch"/]
  getBranchPath[/"getBranchPath"/]
  replayBranch[/"replayBranch"/]
  buildBranchMap[/"buildBranchMap"/]
  findRootBranch[/"findRootBranch"/]
  findChildBranches[/"findChildBranches"/]
  describeBranchTree[/"describeBranchTree"/]
  evaluateBranches[/"evaluateBranches"/]
  wrapAsBranch[/"wrapAsBranch"/]
  unwrapBranchTree[/"unwrapBranchTree"/]
  deriveMetadata["deriveMetadata"]
  applyDerivedMetadata[/"applyDerivedMetadata"/]
  replaySession[/"replaySession"/]
  replayLedger[/"replayLedger"/]
  replayWithDetail[/"replayWithDetail"/]
  emitCode[/"emitCode"/]
  recordGeneration[/"recordGeneration"/]
  getExecutionMetrics[/"getExecutionMetrics"/]
  execute[/"execute"/]
  verifyCompiles[/"verifyCompiles"/]
  verifyFileMarker[/"verifyFileMarker"/]
  extractIRPython[("extractIRPython")]
  extractIR[/"extractIR"/]
  extractIRWithTypes[/"extractIRWithTypes"/]
  classifyError[/"classifyError"/]
  classifyPlanError[/"classifyPlanError"/]
  recordFailure[/"recordFailure"/]
  loadFailures[/"loadFailures"/]
  failureStats[/"failureStats"/]
  formatFailureStats[/"formatFailureStats"/]
  saveCheckpoint[/"saveCheckpoint"/]
  loadCheckpoint[("loadCheckpoint")]
  clearCheckpoint[/"clearCheckpoint"/]
  recordFailure["recordFailure"]
  recordSession[/"recordSession"/]
  getAllFailures[/"getAllFailures"/]
  getFailuresBySVL[/"getFailuresBySVL"/]
  getTopFailurePatterns[/"getTopFailurePatterns"/]
  getFailureGenome[/"getFailureGenome"/]
  getAllSessions[/"getAllSessions"/]
  getLearnedPatterns[/"getLearnedPatterns"/]
  queryAntibodies[/"queryAntibodies"/]
  getSemanticHeatmap[/"getSemanticHeatmap"/]
  getAntibodyStats[/"getAntibodyStats"/]
  generateCandidateRules[/"generateCandidateRules"/]
  main[/"main"/]
  loadFeedback[/"loadFeedback"/]
  saveFeedback[/"saveFeedback"/]
  getFunctionSuccessRate[/"getFunctionSuccessRate"/]
  getWeightedSuccessRate[/"getWeightedSuccessRate"/]
  getFailureAdjustedCredit[/"getFailureAdjustedCredit"/]
  recordRun[/"recordRun"/]
  withLock["withLock"]
  main["main"]
  main[/"main"/]
  generateMermaid[("generateMermaid")]
  generateDOT[("generateDOT")]
  generateChainViz[("generateChainViz")]
  generateGraphReport[("generateGraphReport")]
  computeHealthScore[/"computeHealthScore"/]
  formatHealthLevel[/"formatHealthLevel"/]
  countSessionLedgers[/"countSessionLedgers"/]
  main[/"main"/]
  computeImmuneMetrics[/"computeImmuneMetrics"/]
  auditDirectory -->|"AUDIT_RESULT"| formatAuditResult
  main -->|"BENCHMARK_TASKS"| benchmarkCount
  main -->|"BENCHMARK_TASKS"| benchmarkPassRate
  benchmarkPassRate -->|"PASS_RATE_DATA"| benchmarkReport
  benchmarkLoadLatest -->|"BENCHMARK_RESULT"| benchmarkSave
  main -->|"BENCHMARK_TASKS"| benchmarkCount
  main -->|"BENCHMARK_TASKS"| benchmarkPassRate
  flattenBranch -->|"TRANSITIONS"| createRootBranch
  flattenBranch -->|"TRANSITIONS"| wrapAsBranch
  flattenBranch -->|"TRANSITIONS"| replayWithDetail
  unwrapBranchTree -->|"TRANSITIONS"| createRootBranch
  unwrapBranchTree -->|"TRANSITIONS"| wrapAsBranch
  unwrapBranchTree -->|"TRANSITIONS"| replayWithDetail
  recordGeneration -->|"METRICS_DATA"| getExecutionMetrics
  loadFailures -->|"FAILURE_LIST"| failureStats
  loadFailures -->|"FAILURE_LIST"| getFailuresBySVL
  loadFailures -->|"FAILURE_LIST"| getTopFailurePatterns
  loadFailures -->|"FAILURE_LIST"| failureStats
  loadFailures -->|"FAILURE_LIST"| getFailuresBySVL
  loadFailures -->|"FAILURE_LIST"| getTopFailurePatterns
  loadFailures -->|"FAILURE_LIST"| failureStats
  loadFailures -->|"FAILURE_LIST"| getFailuresBySVL
  loadFailures -->|"FAILURE_LIST"| getTopFailurePatterns
  failureStats -->|"FAILURE_STATS"| formatFailureStats
  failureStats -->|"FAILURE_STATS"| formatFailureStats
  failureStats -->|"FAILURE_STATS"| formatFailureStats
  loadCheckpoint -->|"DATA"| saveCheckpoint
  loadCheckpoint -->|"DATA"| clearCheckpoint
  getAllFailures -->|"FAILURE_LIST"| failureStats
  getAllFailures -->|"FAILURE_LIST"| getFailuresBySVL
  getAllFailures -->|"FAILURE_LIST"| getTopFailurePatterns
  getFailureGenome -->|"FAILURE_GENOME"| computeHealthScore
  getFailureGenome -->|"FAILURE_GENOME"| computeHealthScore
  getAllSessions -->|"SESSION_LIST"| countSessionLedgers
  getAllSessions -->|"SESSION_LIST"| countSessionLedgers
  getAllSessions -->|"SESSION_LIST"| countSessionLedgers
  getAllSessions -->|"SESSION_LIST"| countSessionLedgers
  main -->|"FAILURE_LIST"| failureStats
  main -->|"FAILURE_LIST"| getFailuresBySVL
  main -->|"FAILURE_LIST"| getTopFailurePatterns
  main -->|"FAILURE_GENOME"| computeHealthScore
  computeHealthScore -->|"HEALTH_SCORE"| formatHealthLevel
```
