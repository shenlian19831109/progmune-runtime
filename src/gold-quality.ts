/**
 * P9.2d: Gold Case Quality Assessor
 *
 * Given a broken/expected pair, predicts whether the detector will
 * catch it and explains WHY. This guides human annotators toward
 * high-yield CVE cases — those with clear structural differences
 * that the detector can reliably identify.
 *
 * Quality score components:
 *   state_diff:    template states - broken states (>0 = detectable)
 *   edge_diff:     template edges - broken edges (>0 = detectable)
 *   illegal_edge:  broken edges not in template (>0 = detectable)
 *   role_change:   entry/exit/bridge role differences
 *
 * Cases with state_diff=0 AND edge_diff=0 are "ambiguous" —
 * the broken SM is structurally identical to the template.
 * These should be deprecated or manually fixed.
 */

import { inferStateMachine } from "./state-inference";

export interface QualityAssessment {
  /** Overall quality score (0-1). 1 = guaranteed detection, 0 = undetectable. */
  score: number;
  /** Will the detector catch this case? (score > 0.3) */
  detectable: boolean;
  /** Why the detector will/won't catch it. */
  explanation: string;
  /** Detailed diffs between template and broken state machines. */
  diffs: {
    stateCountDiff: number;
    edgeCountDiff: number;
    illegalEdges: number;
    templateRoles: { entry: number; bridge: number; exit: number };
    brokenRoles: { entry: number; bridge: number; exit: number };
    roleDiff: string;
  };
  /** Suggestion for human annotator. */
  suggestion: string;
}

/**
 * Assess the quality of a gold CVE case.
 *
 * High-quality cases have clear structural differences between
 * the expected (template) and broken state machines. If the
 * state counts are identical and the edges are identical,
 * the detector has no signal to work with.
 */
export function assessGoldQuality(
  broken: string[],
  expected: string[]
): QualityAssessment {
  const templateSM = inferStateMachine([expected]);
  const brokenSM = inferStateMachine([broken]);

  const stateCountDiff = templateSM.stateCount - brokenSM.stateCount;
  const edgeCountDiff =
    countEdges(templateSM) - countEdges(brokenSM);
  const illegalEdges = countIllegalEdges(brokenSM, templateSM);

  const tRoles = countRoles(templateSM);
  const bRoles = countRoles(brokenSM);

  // Score components (0-1 each)
  const stateScore = Math.min(1, Math.max(0, stateCountDiff / 3));
  const edgeScore = Math.min(1, Math.max(0, edgeCountDiff / 3));
  const illegalScore = Math.min(1, illegalEdges / 2);

  // Order check: do the same functions appear in a different order?
  // This catches use-after-free, double-free, and other reordering bugs
  // where the SM structure is identical but the CALL ORDER is wrong.
  const orderScore = computeOrderScore(broken, expected);

  // Weighted combination
  const score = stateScore * 0.35 + edgeScore * 0.25 + illegalScore * 0.25 + orderScore * 0.15;
  const detectable = score > 0.15;

  // Build explanation
  const reasons: string[] = [];
  if (stateCountDiff > 0) reasons.push(`template has ${stateCountDiff} more state(s) than broken`);
  if (stateCountDiff < 0) reasons.push(`broken has ${-stateCountDiff} more state(s) than template (illegal transition?)`);
  if (stateCountDiff === 0) reasons.push(`identical state count — no missing-state signal`);
  if (edgeCountDiff > 0) reasons.push(`${edgeCountDiff} missing edge(s)`);
  if (illegalEdges > 0) reasons.push(`${illegalEdges} illegal edge(s) detected`);

  // Check call order
  const orderMismatch = computeOrderScore(broken, expected);
  if (orderMismatch > 0.3 && stateCountDiff === 0) {
    reasons.push(`function call order differs (score=${orderMismatch.toFixed(2)}) — possible UAF, double-free, or reordering bug`);
  }

  let roleDiff = "";
  if (tRoles.exit > bRoles.exit) roleDiff = `template has ${tRoles.exit - bRoles.exit} more exit state(s)`;
  else if (tRoles.bridge > bRoles.bridge) roleDiff = `template has ${tRoles.bridge - bRoles.bridge} more bridge state(s)`;
  else roleDiff = "roles unchanged";

  let suggestion: string;
  if (detectable && stateCountDiff > 0) {
    suggestion = "✅ HIGH QUALITY — missing state detected. Ready for gold dataset.";
  } else if (detectable && illegalEdges > 0) {
    suggestion = "✅ GOOD — illegal transition detected. Verify the sequence is correct.";
  } else if (stateCountDiff === 0 && edgeCountDiff === 0) {
    suggestion = "❌ UNDETECTABLE — broken SM is structurally identical to template. Revise broken sequence or mark as non-lifecycle CVE.";
  } else {
    suggestion = "⚠️ MARGINAL — weak structural signal. Consider revising the broken/expected sequences.";
  }

  return {
    score: Math.round(score * 100) / 100,
    detectable,
    explanation: reasons.join("; ") || "no structural difference detected",
    diffs: {
      stateCountDiff,
      edgeCountDiff,
      illegalEdges,
      templateRoles: tRoles,
      brokenRoles: bRoles,
      roleDiff,
    },
    suggestion,
  };
}

function countEdges(sm: any): number {
  let count = 0;
  for (let i = 0; i < sm.stateTransitions.length; i++)
    for (let j = 0; j < (sm.stateTransitions[i] || []).length; j++)
      if (sm.stateTransitions[i][j] > 0) count++;
  return count;
}

function countIllegalEdges(testSM: any, templateSM: any): number {
  const tEdges = edgeSet(templateSM);
  const bEdges = edgeSet(testSM);
  let illegal = 0;
  for (const e of bEdges) if (!tEdges.has(e)) illegal++;
  return illegal;
}

function edgeSet(sm: any): Set<string> {
  const s = new Set<string>();
  for (let i = 0; i < sm.stateTransitions.length; i++)
    for (let j = 0; j < (sm.stateTransitions[i] || []).length; j++)
      if (sm.stateTransitions[i][j] > 0) s.add(`${i}→${j}`);
  return s;
}

/**
 * Check if the same functions appear in different order between
 * broken and expected. High score = significant reordering detected.
 * This catches UAF (free→use vs use→free) and double-free patterns.
 */
function computeOrderScore(broken: string[], expected: string[]): number {
  const bSet = new Set(broken);
  const eSet = new Set(expected);
  // Same functions must appear in both
  if (bSet.size !== eSet.size) return 0;
  for (const fn of bSet) if (!eSet.has(fn)) return 0;

  // Count position changes — how many functions changed position?
  let mismatches = 0;
  const minLen = Math.min(broken.length, expected.length);
  for (let i = 0; i < minLen; i++) {
    if (broken[i] !== expected[i]) mismatches++;
  }

  // Also check: are any functions that appear multiple times
  // in broken but different number of times in expected?
  const bFreq = new Map<string, number>();
  const eFreq = new Map<string, number>();
  for (const fn of broken) bFreq.set(fn, (bFreq.get(fn) || 0) + 1);
  for (const fn of expected) eFreq.set(fn, (eFreq.get(fn) || 0) + 1);

  let freqDiff = 0;
  for (const [fn, count] of bFreq) {
    freqDiff += Math.abs(count - (eFreq.get(fn) || 0));
  }

  // Reorder + frequency change = signal
  const reorderScore = Math.min(1, mismatches / Math.max(1, minLen));
  const freqScore = Math.min(1, freqDiff / 2);
  return Math.max(0, Math.min(1, reorderScore * 0.6 + freqScore * 0.4));
}

function countRoles(sm: any): { entry: number; bridge: number; exit: number } {
  let entry = 0, bridge = 0, exit = 0;
  for (const s of sm.states) {
    if (s.role === "entry") entry++;
    else if (s.role === "bridge") bridge++;
    else if (s.role === "exit") exit++;
  }
  return { entry, bridge, exit };
}

/**
 * Batch-assess a list of candidate gold cases.
 * Sorts by quality score descending — annotators should
 * prioritize high-score cases.
 */
export function rankGoldCandidates(
  candidates: { id: string; broken: string[]; expected: string[] }[]
): (QualityAssessment & { id: string })[] {
  return candidates
    .map(c => ({ id: c.id, ...assessGoldQuality(c.broken, c.expected) }))
    .sort((a, b) => b.score - a.score);
}

export function printQualityReport(
  results: (QualityAssessment & { id: string })[]
): void {
  console.log(`\n─── Gold Case Quality Ranking ───`);
  console.log(`  ${'ID'.padEnd(10)} ${'Score'.padEnd(8)} ${'Detectable'.padEnd(10)} ${'Signal'}`);
  console.log(`  ${'─'.repeat(50)}`);

  let highQ = 0, midQ = 0, lowQ = 0;
  for (const r of results) {
    const icon = r.score > 0.5 ? "🟢" : r.score > 0.2 ? "🟡" : "🔴";
    console.log(`  ${icon} ${r.id.padEnd(8)} ${r.score.toFixed(2).padStart(5)}  ${String(r.detectable).padEnd(10)} ${r.explanation.slice(0, 40)}`);
    if (r.score > 0.5) highQ++;
    else if (r.score > 0.2) midQ++;
    else lowQ++;
  }

  console.log(`\n  High quality: ${highQ}  Medium: ${midQ}  Low/undetectable: ${lowQ}`);
  console.log(`  Low-quality cases should be revised or excluded from gold dataset.\n`);
}
