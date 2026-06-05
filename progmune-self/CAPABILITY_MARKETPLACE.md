# Capability Marketplace

Auto-generated capability clusters from 549 functions.

## ledger (26 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| generateBranchId | Generate a unique branch ID. */ | BRANCH_ID | BRANCH_TREE |
| createRootBranch | Create the root branch of an execution t | ROOT_BRANCH | TRANSITIONS |
| createBranch | Create a child branch from a parent bran | CHILD_BRANCH | PARENT_BRANCH |
| forkBranch | Fork a branch at a split index creating  | FORKED_BRANCHES | BRANCH |
| mergeBranches | Merge multiple branches into one unified | MERGED_BRANCH | BRANCH_LIST |
| flattenBranch | Flatten a branch tree into a linear tran | TRANSITIONS | BRANCH_TREE |
| getBranchPath | Get the path from root to a target branc | BRANCH_PATH | BRANCH |
| replayBranch | Replay a branch tree verifying all trans | REPLAY_RESULT | BRANCH_TREE |
| buildBranchMap | Build a lookup map from a branch array.  | BRANCH_MAP | BRANCH_LIST |
| findRootBranch | Find the root branch of a tree. */ | ROOT_BRANCH | BRANCH_LIST |
| findChildBranches | Find all child branches of a given paren | CHILD_BRANCHES | PARENT_BRANCH |
| describeBranchTree | Format a branch tree as human-readable t | DESCRIPTION | BRANCH_TREE |
| evaluateBranches | Score all branches in a tree and return  | BRANCH_SCORES | BRANCH_TREE |
| wrapAsBranch | Wrap linear transitions as a single root | ROOT_BRANCH | TRANSITIONS |
| unwrapBranchTree | Unwrap a branch tree to a flat transitio | TRANSITIONS | BRANCH_LIST |
| countSessionLedgers | Validate a ledger and return pass/fail c | VALIDATION_COUNTS | SESSION_LIST |
| registerFingerprint | Register a ledger fingerprint as an exec | FINGERPRINT | LEDGER_DATA |
| getFingerprint | Get a stored ledger fingerprint by sessi | FINGERPRINT | SESSION_ID |
| getFingerprintRegistry | List all registered ledger fingerprints. | DATA |  |
| verifyFingerprint | Verify a single ledger fingerprint again | VALIDATION_RESULT | DATA |

## format (22 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| formatHealthLevel | Format a health score as a status level. | HEALTH_STATUS | HEALTH_SCORE |
| formatTransitionCount | Format a transition count as a summary s | FORMATTED_COUNT | TRANSITION_COUNT |
| formatSessionCounts | Get a summary of session counts as a for | FORMATTED_COUNT | RESOLVED_COUNT |
| truncate | truncate | TRUNCATED_STRING | STRING |
| camelToSnake | camel to snake | FORMATTED_STRING | STRING |
| capitalizeWords | capitalize words | FORMATTED_STRING | STRING |
| removeWhitespace | remove whitespace | CLEANED_STRING | STRING |
| roundTo | round to | ROUNDED_NUMBER | NUMBER |
| formatDuration | format duration | FORMATTED_STRING | NUMBER |
| formatFileSize | format file size | FORMATTED_STRING | NUMBER |
| toQueryString | to query string | QUERY_STRING | OBJECT |
| pad | pad |  |  |
| barChart | bar chart |  |  |
| aclBadge | acl badge |  |  |
| svlLabel | svl label |  |  |
| describeSVLLayer | describe s v l layer |  |  |
| G | g |  |  |
| R | r |  |  |
| Y | y |  |  |
| C_ | c |  |  |

## validator (20 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| checkSemantic | check semantic | VALIDATION_RESULT | DATA |
| rebuildState | rebuild state | STATE_SNAPSHOT | LEDGER_DATA |
| applyTransitionDelta | apply transition delta | EXECUTED | CONFIG |
| findFixPathStatic | find fix path static | FIX_PATH | CURRENT_STATES |
| validateTransition | validate transition | VALIDATION_RESULT | TRANSITION_CONTEXT |
| checkLedgerConsistency | check ledger consistency | CONSISTENCY_RESULT | LEDGER_DATA |
| hashRules | hash rules | RULE_HASH | RULES |
| hashLedger | Compute a deterministic SHA256 hash of a | LEDGER_HASH | LEDGER_DATA |
| diffLedgers | Compare two ledgers and identify structu | LEDGER_DIFF | TWO_LEDGERS |
| findProducer | Find all transitions that acquire (produ | DATA |  |
| findConsumer | Find all transitions that have a given s | DATA |  |
| findViolations | Find all invalid transitions in a ledger | DATA |  |
| findTransition | Find a transition by its action index. * | DATA |  |
| listAllStates | List all unique states present across al | DATA |  |
| explainRejection | Format an SSG rejection as a human-reada | EXPLANATION | SSG_REJECTION |
| rejectionToJSON | Format an SSG rejection as a structured  |  |  |
| parseProtocolsFromJSON | parse protocols from j s o n | EXTRACTED |  |
| validateAction | 校验单个动作的合法性（函数存在、类型匹配、参数数量）。 | VALIDATION_RESULT | ACTION |
| validateActionSequence | 批量校验动作序列 + 变量流向分析。 | VALIDATION_RESULT | ACTIONS |
| validateActionResult | Result-typed variant of validateActionSe | VALIDATION_RESULT | DATA |

## failure (19 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| classifyError | Classify a compile error into a root cau | ROOT_CAUSE, ROOT_CAUSE | ERROR_STRING, ERROR_STRING |
| classifyPlanError | Classify a planning failure into a root  | ROOT_CAUSE, ROOT_CAUSE | ERROR_STRING, ERROR_STRING |
| recordFailure | Record a generation failure to the failu | FAILURE_ID | FAILURE_EVENT |
| loadFailures | Load all recorded failures from the fail | FAILURE_LIST, FAILURE_LIST, FAILURE_LIST | FAILURE_CORPUS, FAILURE_CORPUS, FAILURE_CORPUS |
| failureStats | Get failure statistics grouped by root c | FAILURE_STATS, FAILURE_STATS, FAILURE_STATS | FAILURE_LIST, FAILURE_LIST, FAILURE_LIST |
| formatFailureStats | Format failure statistics as a human-rea | FORMATTED_REPORT, FORMATTED_REPORT, FORMATTED_REPORT | FAILURE_STATS, FAILURE_STATS, FAILURE_STATS |
| saveCheckpoint | Save planner checkpoint for crash recove | SAVED | DATA |
| loadCheckpoint | Load a previously saved planner checkpoi | DATA |  |
| clearCheckpoint | Clear a saved planner checkpoint. */ | DELETED | DATA |
| recordFailure | Record a constraint violation to the fai |  |  |
| recordSession | 保存执行会话（含所有尝试、违规、状态转移）。 | SESSION_ID, SESSION_ID | EXECUTION_DATA, EXECUTION_DATA |
| getAllFailures | get all failures | FAILURE_LIST | FAILURE_CORPUS |
| getFailuresBySVL | get failures by s v l | FILTERED_FAILURES | FAILURE_LIST |
| getTopFailurePatterns | get top failure patterns | FAILURE_PATTERNS | FAILURE_LIST |
| getFailureGenome | Get failure genome statistics: total fai | FAILURE_GENOME, FAILURE_GENOME | FAILURE_DATA, FAILURE_DATA |
| getLearnedPatterns | Get antibody patterns learned from failu | LEARNED_PATTERNS | FAILURE_HISTORY |
| queryAntibodies | Query antibody registry for matching rep | ANTIBODY_MATCH | FAILURE_SIGNATURE |
| getSemanticHeatmap | Get semantic heatmap showing fragile pro | HEATMAP, HEATMAP_DATA | FAILURE_DATA, FAILURE_HEATMAP |
| generateCandidateRules | Generate candidate immune rules from fai | CREATED | FAILURE_DATA |

## ssg (16 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| rebuildState | rebuild state | STATE_SNAPSHOT | LEDGER_DATA |
| applyTransitionDelta | apply transition delta | EXECUTED | CONFIG |
| findFixPathStatic | find fix path static | FIX_PATH | CURRENT_STATES |
| validateTransition | validate transition | VALIDATION_RESULT | TRANSITION_CONTEXT |
| checkLedgerConsistency | check ledger consistency | CONSISTENCY_RESULT | LEDGER_DATA |
| hashRules | hash rules | RULE_HASH | RULES |
| hashLedger | Compute a deterministic SHA256 hash of a | LEDGER_HASH | LEDGER_DATA |
| diffLedgers | Compare two ledgers and identify structu | LEDGER_DIFF | TWO_LEDGERS |
| findProducer | Find all transitions that acquire (produ | DATA |  |
| findConsumer | Find all transitions that have a given s | DATA |  |
| findViolations | Find all invalid transitions in a ledger | DATA |  |
| findTransition | Find a transition by its action index. * | DATA |  |
| listAllStates | List all unique states present across al | DATA |  |
| explainRejection | Format an SSG rejection as a human-reada | EXPLANATION | SSG_REJECTION |
| rejectionToJSON | Format an SSG rejection as a structured  |  |  |
| parseProtocolsFromJSON | parse protocols from j s o n | EXTRACTED |  |

## branch (15 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| generateBranchId | Generate a unique branch ID. */ | BRANCH_ID | BRANCH_TREE |
| createRootBranch | Create the root branch of an execution t | ROOT_BRANCH | TRANSITIONS |
| createBranch | Create a child branch from a parent bran | CHILD_BRANCH | PARENT_BRANCH |
| forkBranch | Fork a branch at a split index creating  | FORKED_BRANCHES | BRANCH |
| mergeBranches | Merge multiple branches into one unified | MERGED_BRANCH | BRANCH_LIST |
| flattenBranch | Flatten a branch tree into a linear tran | TRANSITIONS | BRANCH_TREE |
| getBranchPath | Get the path from root to a target branc | BRANCH_PATH | BRANCH |
| replayBranch | Replay a branch tree verifying all trans | REPLAY_RESULT | BRANCH_TREE |
| buildBranchMap | Build a lookup map from a branch array.  | BRANCH_MAP | BRANCH_LIST |
| findRootBranch | Find the root branch of a tree. */ | ROOT_BRANCH | BRANCH_LIST |
| findChildBranches | Find all child branches of a given paren | CHILD_BRANCHES | PARENT_BRANCH |
| describeBranchTree | Format a branch tree as human-readable t | DESCRIPTION | BRANCH_TREE |
| evaluateBranches | Score all branches in a tree and return  | BRANCH_SCORES | BRANCH_TREE |
| wrapAsBranch | Wrap linear transitions as a single root | ROOT_BRANCH | TRANSITIONS |
| unwrapBranchTree | Unwrap a branch tree to a flat transitio | TRANSITIONS | BRANCH_LIST |

## corpus (13 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| saveCheckpoint | Save planner checkpoint for crash recove | SAVED | DATA |
| loadCheckpoint | Load a previously saved planner checkpoi | DATA |  |
| clearCheckpoint | Clear a saved planner checkpoint. */ | DELETED | DATA |
| recordFailure | Record a constraint violation to the fai |  |  |
| recordSession | 保存执行会话（含所有尝试、违规、状态转移）。 | SESSION_ID, SESSION_ID | EXECUTION_DATA, EXECUTION_DATA |
| getAllFailures | get all failures | FAILURE_LIST | FAILURE_CORPUS |
| getFailuresBySVL | get failures by s v l | FILTERED_FAILURES | FAILURE_LIST |
| getTopFailurePatterns | get top failure patterns | FAILURE_PATTERNS | FAILURE_LIST |
| getAllSessions | Load all execution sessions from the cor | SESSION_LIST, SESSION_LIST, SESSION_LIST, SESSION_LIST | SESSION_DATA, SESSION_CORPUS, SESSION_CORPUS, SESSION_CORPUS |
| getLearnedPatterns | Get antibody patterns learned from failu | LEARNED_PATTERNS | FAILURE_HISTORY |
| queryAntibodies | Query antibody registry for matching rep | ANTIBODY_MATCH | FAILURE_SIGNATURE |
| getSemanticHeatmap | Get semantic heatmap showing fragile pro | HEATMAP, HEATMAP_DATA | FAILURE_DATA, FAILURE_HEATMAP |
| generateCandidateRules | Generate candidate immune rules from fai | CREATED | FAILURE_DATA |

## planner (13 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| deriveConstraints | Derive planner constraints from mined ru |  |  |
| applyConstraints | Apply constraints to adjust a function's | EXECUTED | CONFIG |
| formatConstraints | Get a human-readable summary of active c | FORMATTED | DATA |
| getConstraints | get constraints | DATA |  |
| clearConstraintsCache | clear constraints cache | DELETED | DATA |
| buildCompactFuncList | Build a compact function list with capab | CREATED |  |
| semanticMatch | Semantic matching: check if two capabili |  |  |
| buildChainHints | Build capability chain hints: producer→c | CREATED |  |
| buildProtocolChainHint | Build protocol constraint hints for the  | CREATED |  |
| plan | plan | ACTION_PLAN | INTENT |
| searchPlan | search plan | ACTION_PLAN | INTENT |
| selectCapabilityChains | Select the best capability chain for an  | DATA | TEXT |
| formatChainHint | Format chains as a hint for the LLM prom | FORMATTED | DATA |

## runtime (12 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| executeActionCode | execute action code | ACTION_RESULT | ACTION_CODE |
| assertLedgerConsistency | Assert a ledger passes all invariant che | CONSISTENCY_CHECK | LEDGER_DATA |
| assertDeltaConsistency | Assert a single transition has consisten | DELTA_CHECK | TRANSITION |
| assertRuleHashMatch | Assert rule hashes match to detect rule  | HASH_MATCH_RESULT | EXPECTED_HASH |
| assertTransitionOrder | Assert transition indices are strictly m | VALIDATION_RESULT | DATA |
| assertLedgerInvariants | Run all invariant checks on a ledger. */ | INVARIANT_RESULT | LEDGER_DATA |
| ok | Create an Ok result. */ |  |  |
| err | Create an Err result. */ |  |  |
| generateAttemptId | generate attempt id | CREATED |  |
| generateSessionId | generate session id | CREATED |  |
| generatePlannerSeed | generate planner seed | CREATED |  |
| runAndCheck | run and check | EXECUTION_RESULT | COMMAND |

## immune (11 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| getAntibodyStats | Get antibody efficacy statistics: hits b | ANTIBODY_STATS, ANTIBODY_STATS | ANTIBODY_DATA, ANTIBODY_DATA |
| computeHealthScore | Compute overall immune health score from | HEALTH_SCORE | FAILURE_GENOME |
| computeImmuneMetrics | Compute live immune metrics from the cur | RESULT | ANTIBODY_DATA |
| formatImmuneMetrics | Format immune metrics as a human-readabl | FORMATTED | DATA |
| reportImmuneMetrics | Print current immune metrics to stderr.  |  |  |
| importFingerprints | Import external fingerprints into the lo |  |  |
| importFromFile | Import fingerprints from a JSON file (e. |  |  |
| getReceiverStats | Get import statistics: how many external | DATA |  |
| extractFingerprints | extract fingerprints | EXTRACTED |  |
| reportFingerprints | report fingerprints | FINGERPRINT_REPORT | CORPUS |
| previewFingerprints | preview fingerprints |  |  |

## terminal (11 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| pad | pad |  |  |
| barChart | bar chart |  |  |
| aclBadge | acl badge |  |  |
| svlLabel | svl label |  |  |
| describeSVLLayer | describe s v l layer |  |  |
| G | g |  |  |
| R | r |  |  |
| Y | y |  |  |
| C_ | c |  |  |
| D | d |  |  |
| B | b |  |  |

## statistics (10 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| benchmarkCount | benchmark count | TASK_COUNT | BENCHMARK_TASKS |
| benchmarkPassRate | Calculate pass rate from the latest benc | PASS_RATE_DATA | BENCHMARK_TASKS |
| getFailureGenome | Get failure genome statistics: total fai | FAILURE_GENOME, FAILURE_GENOME | FAILURE_DATA, FAILURE_DATA |
| getAntibodyStats | Get antibody efficacy statistics: hits b | ANTIBODY_STATS, ANTIBODY_STATS | ANTIBODY_DATA, ANTIBODY_DATA |
| countTotalTransitions | Count total transitions across all sessi | TRANSITION_COUNT | SESSION_LIST |
| countSessionsWithViolations | Count sessions that have violations. | VIOLATION_COUNT | SESSION_LIST |
| countResolved | Count resolved vs unresolved sessions in | RESOLVED_COUNT | SESSION_LIST |
| mostFrequent | most frequent | ELEMENT | ARRAY |
| average | average | AVERAGE | NUMBERS |
| median | median | MEDIAN | NUMBERS |

## registry (10 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| registerFingerprint | Register a ledger fingerprint as an exec | FINGERPRINT | LEDGER_DATA |
| getFingerprint | Get a stored ledger fingerprint by sessi | FINGERPRINT | SESSION_ID |
| getFingerprintRegistry | List all registered ledger fingerprints. | DATA |  |
| verifyFingerprint | Verify a single ledger fingerprint again | VALIDATION_RESULT | DATA |
| verifyAllFingerprints | Verify all registered ledger fingerprint | VERIFICATION_RESULT, VERIFICATION_RESULT | FINGERPRINT_DATA, FINGERPRINT_DATA |
| registerAllMissingFingerprints | Register fingerprints for all sessions t | FINGERPRINT_DATA | SESSION_DATA |
| invalidateProtocolCache | Invalidate cached protocol configuration |  |  |
| getProtocolConfig | Get the authoritative protocol configura | PROTOCOL_CONFIG | PROJECT_CONFIG |
| getNsInit | Get namespace initial states from protoc | NAMESPACE_STATES | PROJECT_CONFIG |
| getRuleHash | Get the current rule set hash. */ | RULE_HASH | PROTOCOL_CONFIG |

## semantic (10 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| createSnapshot | 从 IR 数据创建快照 */ | SNAPSHOT | IR_DATA |
| saveSnapshot | 持久化快照 */ | SNAPSHOT_ID | SNAPSHOT |
| loadSnapshot | 加载快照 */ | DATA |  |
| listSnapshots | 列出所有快照 */ | DATA |  |
| diffSnapshots | 计算两个快照之间的差异 */ |  | DATA |
| summarizeSnapshot | 生成快照摘要 */ |  |  |
| findSnapshotBySession | 按 sessionId 查找快照，返回最近的一个（或 undefined） */ | DATA |  |
| getTopology | get topology | DATA |  |
| rebuildTopology | rebuild topology |  |  |
| checkSemantic | check semantic | VALIDATION_RESULT | DATA |

## benchmark (8 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| benchmarkCount | benchmark count | TASK_COUNT | BENCHMARK_TASKS |
| main | main | BENCHMARK_TASKS | BENCH_DIR |
| benchmarkPassRate | Calculate pass rate from the latest benc | PASS_RATE_DATA | BENCHMARK_TASKS |
| benchmarkReport | Format benchmark results as a readable r | BENCHMARK_REPORT | PASS_RATE_DATA |
| benchmarkSave | benchmark save | SAVED_FILE_PATH | BENCHMARK_RESULT |
| benchmarkLoadLatest | benchmark load latest | BENCHMARK_RESULT | BENCH_DIR |
| main | main | BENCHMARK_TASKS | BENCH_DIR |
| loadBenchmarks | Load benchmark tasks from bench/tasks.js | BENCHMARK_TASKS | BENCH_DIR |

## validation (8 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| countSessionLedgers | Validate a ledger and return pass/fail c | VALIDATION_COUNTS | SESSION_LIST |
| hasViolations | Check if a session has any protocol viol | VIOLATION_CHECK | SESSION_DATA |
| countSessionsWithViolations | Count sessions that have violations. | VIOLATION_COUNT | SESSION_LIST |
| isValidEmail | Progmune Standard Library — general-purp | VALIDATION_RESULT | /@produces, for, Capability, Graph, integration., STRING |
| isPrime | is prime | PRIME_CHECK | NUMBER |
| hasRequiredFields | has required fields | VALIDATION_RESULT | OBJECT |
| isPlainObject | is plain object | VALIDATION_RESULT | ANY |
| parseSemver | parse semver | PARSED_VERSION | STRING |

## repair (7 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| suggestRepairs | Generate repair proposals for all detect | REPAIR_PROPOSALS | VIOLATIONS |
| suggestProtocolRepair | Generate repair proposals for SSG protoc |  |  |
| suggestInvariantRepair | Generate repair proposals for invariant  | DELTA_CHECK | TRANSITION |
| applyProposalAsBranch | Convert an accepted repair proposal into | EXECUTED | CONFIG |
| validateProposal | Validate whether a repair proposal fixes | VALIDATION_RESULT | DATA |
| generateRepairSummary | Generate a comprehensive repair summary  | REPAIR_SUMMARY | LEDGER_DATA |
| getMinimalFixSet | Get the minimal set of repair proposals  | MINIMAL_FIX_SET | REPAIR_PROPOSALS |

## proposal (7 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| suggestRepairs | Generate repair proposals for all detect | REPAIR_PROPOSALS | VIOLATIONS |
| suggestProtocolRepair | Generate repair proposals for SSG protoc |  |  |
| suggestInvariantRepair | Generate repair proposals for invariant  | DELTA_CHECK | TRANSITION |
| applyProposalAsBranch | Convert an accepted repair proposal into | EXECUTED | CONFIG |
| validateProposal | Validate whether a repair proposal fixes | VALIDATION_RESULT | DATA |
| generateRepairSummary | Generate a comprehensive repair summary  | REPAIR_SUMMARY | LEDGER_DATA |
| getMinimalFixSet | Get the minimal set of repair proposals  | MINIMAL_FIX_SET | REPAIR_PROPOSALS |

## snapshot (7 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| createSnapshot | 从 IR 数据创建快照 */ | SNAPSHOT | IR_DATA |
| saveSnapshot | 持久化快照 */ | SNAPSHOT_ID | SNAPSHOT |
| loadSnapshot | 加载快照 */ | DATA |  |
| listSnapshots | 列出所有快照 */ | DATA |  |
| diffSnapshots | 计算两个快照之间的差异 */ |  | DATA |
| summarizeSnapshot | 生成快照摘要 */ |  |  |
| findSnapshotBySession | 按 sessionId 查找快照，返回最近的一个（或 undefined） */ | DATA |  |

## collector (6 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| classifyError | Classify a compile error into a root cau | ROOT_CAUSE, ROOT_CAUSE | ERROR_STRING, ERROR_STRING |
| classifyPlanError | Classify a planning failure into a root  | ROOT_CAUSE, ROOT_CAUSE | ERROR_STRING, ERROR_STRING |
| recordFailure | Record a generation failure to the failu | FAILURE_ID | FAILURE_EVENT |
| loadFailures | Load all recorded failures from the fail | FAILURE_LIST, FAILURE_LIST, FAILURE_LIST | FAILURE_CORPUS, FAILURE_CORPUS, FAILURE_CORPUS |
| failureStats | Get failure statistics grouped by root c | FAILURE_STATS, FAILURE_STATS, FAILURE_STATS | FAILURE_LIST, FAILURE_LIST, FAILURE_LIST |
| formatFailureStats | Format failure statistics as a human-rea | FORMATTED_REPORT, FORMATTED_REPORT, FORMATTED_REPORT | FAILURE_STATS, FAILURE_STATS, FAILURE_STATS |

## feedback (6 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| loadFeedback | load feedback | FEEDBACK_DATA | CORPUS |
| saveFeedback | save feedback | FEEDBACK_ID | FEEDBACK_EVENT |
| getFunctionSuccessRate | get function success rate | SUCCESS_RATE, Flat, success, rate, (all, records, equal, weight). | FUNCTION_NAME |
| getWeightedSuccessRate | get weighted success rate | WEIGHTED_SUCCESS_RATE, Time-weighted, success, rate:, recent, results, matter, more., Decay:, weight, =, 0.5^(age_days). | FUNCTION_NAME |
| getFailureAdjustedCredit | get failure adjusted credit | FAILURE_ADJUSTED_CREDIT, Credit, score, adjusted, by, failure, severity, with, Laplace, smoothing., Laplace, (add-1), smoothing, eliminates, small-sample, bias:, -, 1/1, success, →, ~0.67, (not, 1.0, —, still, uncertain), -, 99/100, success, →, ~0.98, (approaches, empirical, rate), -, 0/1, failure, →, ~0.33, (not, 0.0, —, allows, redemption), -, Cold, start, →, 0.5, (neutral, prior), SVL-4, protocol, violations, are, penalized, 3×, more, than, SVL-1., Time-weighted, via, exponential, decay, (half-life, =, 1, day). | FUNCTION_NAME |
| recordRun | record run | RUN_ID | EXECUTION_DATA |

## memory (6 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| recordEpisode | record episode | MEMORY_ID | EXECUTION_DATA |
| getRecentEpisodes | get recent episodes | EPISODE_LIST | LIMIT |
| getSuccessfulEpisodes | get successful episodes | DATA |  |
| pruneEpisodicMemory | Prune episodic memory: keep high-value,  |  |  |
| consolidateSemantic | consolidate semantic |  |  |
| findSemanticTemplate | find semantic template | TEMPLATE, Uses, keyword, overlap, (replaces, prefix, matching), for, semantic, recall. | INTENT |

## layer (6 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| recordEpisode | record episode | MEMORY_ID | EXECUTION_DATA |
| getRecentEpisodes | get recent episodes | EPISODE_LIST | LIMIT |
| getSuccessfulEpisodes | get successful episodes | DATA |  |
| pruneEpisodicMemory | Prune episodic memory: keep high-value,  |  |  |
| consolidateSemantic | consolidate semantic |  |  |
| findSemanticTemplate | find semantic template | TEMPLATE, Uses, keyword, overlap, (replaces, prefix, matching), for, semantic, recall. | INTENT |

## string (6 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| isValidEmail | Progmune Standard Library — general-purp | VALIDATION_RESULT | /@produces, for, Capability, Graph, integration., STRING |
| truncate | truncate | TRUNCATED_STRING | STRING |
| camelToSnake | camel to snake | FORMATTED_STRING | STRING |
| capitalizeWords | capitalize words | FORMATTED_STRING | STRING |
| countSubstring | count substring | COUNT | STRING |
| removeWhitespace | remove whitespace | CLEANED_STRING | STRING |

## audit (5 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| auditDirectory | Audit a directory for | AUDIT_RESULT | DIRECTORY |
| formatAuditResult | Format audit result as human-readable te | FORMATTED_REPORT | AUDIT_RESULT |
| getFailureGenome | Get failure genome statistics: total fai | FAILURE_GENOME, FAILURE_GENOME | FAILURE_DATA, FAILURE_DATA |
| getAllSessions | Load all execution sessions from the cor | SESSION_LIST, SESSION_LIST, SESSION_LIST, SESSION_LIST | SESSION_DATA, SESSION_CORPUS, SESSION_CORPUS, SESSION_CORPUS |
| countSessionLedgers | Validate a ledger and return pass/fail c | VALIDATION_COUNTS | SESSION_LIST |

## count (5 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| benchmarkCount | benchmark count | TASK_COUNT | BENCHMARK_TASKS |
| countExported | Count exported functions in an IR functi | EXPORT_COUNT | IR_FUNCTIONS |
| countTotalTransitions | Count total transitions across all sessi | TRANSITION_COUNT | SESSION_LIST |
| countResolved | Count resolved vs unresolved sessions in | RESOLVED_COUNT | SESSION_LIST |
| countSubstring | count substring | COUNT | STRING |

## execute (5 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| recordGeneration | Record a generation event. Called automa | METRICS_DATA | GENERATION_EVENT |
| getExecutionMetrics | Get current execution metrics. */ | EXECUTION_METRICS, EXECUTION_METRICS | METRICS_DATA, METRICS_DATA |
| execute | Execute the full Progmune pipeline: inte | CODE, CODE | INTENT, INTENT |
| verifyCompiles | Verify a file compiles without errors. R | COMPILE_RESULT, COMPILE_RESULT, COMPILE_RESULT | FILE_PATH, FILE_PATH, FILE_PATH |
| verifyFileMarker | Quick audit: check whether a file has th | MARKER_STATUS | FILE_PATH |

## constraints (5 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| deriveConstraints | Derive planner constraints from mined ru |  |  |
| applyConstraints | Apply constraints to adjust a function's | EXECUTED | CONFIG |
| formatConstraints | Get a human-readable summary of active c | FORMATTED | DATA |
| getConstraints | get constraints | DATA |  |
| clearConstraintsCache | clear constraints cache | DELETED | DATA |

## invariants (5 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| assertLedgerConsistency | Assert a ledger passes all invariant che | CONSISTENCY_CHECK | LEDGER_DATA |
| assertDeltaConsistency | Assert a single transition has consisten | DELTA_CHECK | TRANSITION |
| assertRuleHashMatch | Assert rule hashes match to detect rule  | HASH_MATCH_RESULT | EXPECTED_HASH |
| assertTransitionOrder | Assert transition indices are strictly m | VALIDATION_RESULT | DATA |
| assertLedgerInvariants | Run all invariant checks on a ledger. */ | INVARIANT_RESULT | LEDGER_DATA |

## types (5 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| ok | Create an Ok result. */ |  |  |
| err | Create an Err result. */ |  |  |
| generateAttemptId | generate attempt id | CREATED |  |
| generateSessionId | generate session id | CREATED |  |
| generatePlannerSeed | generate planner seed | CREATED |  |

## math (5 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| average | average | AVERAGE | NUMBERS |
| median | median | MEDIAN | NUMBERS |
| roundTo | round to | ROUNDED_NUMBER | NUMBER |
| isPrime | is prime | PRIME_CHECK | NUMBER |
| randomInt | random int | RANDOM_INT | NUMBERS |

## session (4 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| getAllSessions | Load all execution sessions from the cor | SESSION_LIST, SESSION_LIST, SESSION_LIST, SESSION_LIST | SESSION_DATA, SESSION_CORPUS, SESSION_CORPUS, SESSION_CORPUS |
| main | main |  |  |
| countResolved | Count resolved vs unresolved sessions in | RESOLVED_COUNT | SESSION_LIST |
| formatSessionCounts | Get a summary of session counts as a for | FORMATTED_COUNT | RESOLVED_COUNT |

## graph (4 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| generateMermaid | Generate a Mermaid flowchart of the capa | CREATED |  |
| generateDOT | Generate a DOT graph for use with Graphv | CREATED |  |
| generateChainViz | Generate a focused visualization of a si | CREATED |  |
| generateGraphReport | Generate a summary report of the capabil | CREATED |  |

## viz (4 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| generateMermaid | Generate a Mermaid flowchart of the capa | CREATED |  |
| generateDOT | Generate a DOT graph for use with Graphv | CREATED |  |
| generateChainViz | Generate a focused visualization of a si | CREATED |  |
| generateGraphReport | Generate a summary report of the capabil | CREATED |  |

## metrics (4 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| computeImmuneMetrics | Compute live immune metrics from the cur | RESULT | ANTIBODY_DATA |
| formatImmuneMetrics | Format immune metrics as a human-readabl | FORMATTED | DATA |
| reportImmuneMetrics | Print current immune metrics to stderr.  |  |  |
| main | main | EXECUTION_METRICS | METRICS_DATA |

## llm (4 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| resetCallCount | reset call count |  |  |
| estimateTokens | 粗略 token 估算：CJK 字符 ~1.5 token/字，其余 ~0.4  | TOKEN_COUNT | TEXT |
| generate | generate | LLM_RESPONSE | PROMPT |
| chat | 带 system prompt 的调用：静态规则放 system，动态内容放 u | LLM_RESPONSE | SYSTEM_PROMPT |

## prompts (4 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| buildCompactFuncList | Build a compact function list with capab | CREATED |  |
| semanticMatch | Semantic matching: check if two capabili |  |  |
| buildChainHints | Build capability chain hints: producer→c | CREATED |  |
| buildProtocolChainHint | Build protocol constraint hints for the  | CREATED |  |

## protocol (4 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| invalidateProtocolCache | Invalidate cached protocol configuration |  |  |
| getProtocolConfig | Get the authoritative protocol configura | PROTOCOL_CONFIG | PROJECT_CONFIG |
| getNsInit | Get namespace initial states from protoc | NAMESPACE_STATES | PROJECT_CONFIG |
| getRuleHash | Get the current rule set hash. */ | RULE_HASH | PROTOCOL_CONFIG |

## array (4 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| mostFrequent | most frequent | ELEMENT | ARRAY |
| unique | unique | ARRAY | ARRAY |
| chunk | chunk | ARRAY | ARRAY |
| arrayDiff | array diff | ARRAY | ARRAY |

## deterministic (3 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| replaySession | Deterministically replay a session ledge | REPLAY_RESULT | SESSION_DATA |
| replayLedger | Replay a ledger of transitions against c | REPLAY_RESULT | LEDGER_DATA |
| replayWithDetail | Replay transitions with per-step detail  | DETAIL_RESULT | TRANSITIONS |

## replay (3 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| replaySession | Deterministically replay a session ledge | REPLAY_RESULT | SESSION_DATA |
| replayLedger | Replay a ledger of transitions against c | REPLAY_RESULT | LEDGER_DATA |
| replayWithDetail | Replay transitions with per-step detail  | DETAIL_RESULT | TRANSITIONS |

## extract (3 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| extractIRPython | extract i r python | EXTRACTED |  |
| extractIR | 从 TypeScript 项目提取 IR（函数签名、参数、返回值、协议注解）。 | IR_FUNCTIONS, IR_FUNCTIONS | PROJECT_PATH, PROJECT_PATH |
| extractIRWithTypes | Extract both functions and type→file map | IR_WITH_TYPES, IR_WITH_TYPES | PROJECT_PATH, PROJECT_PATH |

## receiver (3 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| importFingerprints | Import external fingerprints into the lo |  |  |
| importFromFile | Import fingerprints from a JSON file (e. |  |  |
| getReceiverStats | Get import statistics: how many external | DATA |  |

## reporter (3 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| extractFingerprints | extract fingerprints | EXTRACTED |  |
| reportFingerprints | report fingerprints | FINGERPRINT_REPORT | CORPUS |
| previewFingerprints | preview fingerprints |  |  |

## utils (3 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| loadIR | Load IR (Intermediate Representation) fr | DATA |  |
| jaccardSimilarity | jaccard similarity | SIMILARITY_SCORE | STRING_A |
| extractKeywords | extract keywords | KEYWORDS | TEXT |

## rule (3 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| mineRules | Mine protocol rules from failure pattern | FAILURE_GENOME | FAILURE_DATA |
| toProtocolEntries | Convert mined rules to FunctionProtocol  |  |  |
| applyMinedRules | Merge mined rules into protocols.json. D | EXECUTED | CONFIG |

## miner (3 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| mineRules | Mine protocol rules from failure pattern | FAILURE_GENOME | FAILURE_DATA |
| toProtocolEntries | Convert mined rules to FunctionProtocol  |  |  |
| applyMinedRules | Merge mined rules into protocols.json. D | EXECUTED | CONFIG |

## object (3 functions)

| Function | Purpose | Produces | Requires |
|----------|---------|----------|----------|
| deepClone | deep clone | CLONED_OBJECT | OBJECT |
| pick | pick | PICKED_OBJECT | OBJECT |
| deepMerge | deep merge | MERGED_OBJECT | OBJECTS |

