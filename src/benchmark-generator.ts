/**
 * P3.6: Benchmark Generator
 *
 * Auto-generates benchmark cases for uncovered protocol transitions.
 *
 * Data flow:
 *   Coverage Gaps → Transition Templates → Benchmark Cases → Expanded Suite
 *
 * This closes the second flywheel:
 *   Coverage → Gap Detection → Benchmark Gen → New Cases → More Trajectories → Better Coverage
 */

import * as fs from "fs";
import * as path from "path";
import {
  analyzeAllCoverage, loadDefaultProtocolDefinitions,
  CoverageReport, ProtocolDefinition,
} from "./protocol-coverage";
import type { TrajectoryRecord } from "./runtime-types";
import { loadTrajectories } from "./failure-corpus";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface GeneratedCase {
  goal: string;
  protocol: string;
  broken: string[];
  expected: string[];
  violationType: string;
  /** The specific transition this case tests. */
  targetsTransition: { from: string; to: string; rule: string };
}

export interface GeneratedSuite {
  protocol: string;
  generatedAt: string;
  cases: GeneratedCase[];
  source: "coverage-gap";
}

// ═══════════════════════════════════════════════════════════════
// Template Engine
// ═══════════════════════════════════════════════════════════════

/**
 * Generate a benchmark case for a specific missing transition.
 *
 * For an uncovered transition "A → B" via rule "R":
 *   - The "broken" path omits R (or places it out of order)
 *   - The "expected" path includes R in the correct position
 */
function generateCaseForTransition(
  protocol: ProtocolDefinition,
  transition: { from: string; to: string; rule: string },
  violationType: string
): GeneratedCase | null {
  const rules = protocol.rules;
  const rule = rules.get(transition.rule);
  if (!rule) return null;

  // Build the correct path: find prerequisite rules + this rule
  const expected: string[] = [];

  // For acquire transitions: find what prerequisites reach the "from" state
  if (transition.to !== "∅") {
    // Find a path to reach "from" state
    for (const [fn, r] of rules) {
      if (r.post_states.includes(transition.from) || (transition.from === "INIT" && r.pre_states.length === 0)) {
        if (!expected.includes(fn)) expected.push(fn);
      }
    }
    expected.push(transition.rule);
    // Add cleanup if needed
    for (const [fn, r] of rules) {
      if (r.invalidate?.includes(transition.to)) {
        if (!expected.includes(fn)) expected.push(fn);
      }
    }
  } else {
    // Invalidation transition: broken = omit the cleanup rule
    // expected = do the setup + then the cleanup
    for (const [fn, r] of rules) {
      if (r.post_states.includes(transition.from) || (transition.from === "INIT" && r.pre_states.length === 0)) {
        if (!expected.includes(fn)) expected.push(fn);
      }
    }
    if (!expected.includes(transition.rule)) expected.push(transition.rule);
  }

  if (expected.length === 0) return null;

  // Broken: omit the target rule
  const broken = expected.filter(fn => fn !== transition.rule);
  if (broken.length === expected.length || broken.length === 0) {
    // If removing the rule doesn't change the path, make broken = setup only (missing cleanup)
    const broken2 = expected.slice(0, Math.max(1, expected.length - 1));
    if (broken2.length === expected.length) return null;
    return {
      goal: `cover transition: ${transition.from} → ${transition.to} via ${transition.rule}`,
      protocol: "_global",
      broken: broken2,
      expected,
      violationType,
      targetsTransition: transition,
    };
  }

  return {
    goal: `cover transition: ${transition.from} → ${transition.to} via ${transition.rule}`,
    protocol: "_global",
    broken,
    expected,
    violationType,
    targetsTransition: transition,
  };
}

/**
 * Classify a missing transition into a violation type.
 */
function classifyViolation(transition: { from: string; to: string; rule: string }): string {
  if (transition.to === "∅") return "resource_leak";
  if (transition.from === "INIT") return "missing_prerequisite";
  // If the rule invalidates, it's a cleanup step → resource_leak
  return "missing_prerequisite";
}

// ═══════════════════════════════════════════════════════════════
// Generator
// ═══════════════════════════════════════════════════════════════

/**
 * Generate benchmark cases for all uncovered transitions.
 *
 * Returns a map of protocol → generated cases.
 */
export function generateMissingBenchmarks(
  trajectories?: TrajectoryRecord[]
): Record<string, GeneratedCase[]> {
  const trajs = trajectories || loadTrajectories();
  const protocols = loadDefaultProtocolDefinitions();
  const reports = analyzeAllCoverage(protocols, trajs);

  const generated: Record<string, GeneratedCase[]> = {};

  for (const report of reports) {
    const proto = protocols.find(p => p.name === report.protocol);
    if (!proto) continue;

    const cases: GeneratedCase[] = [];
    for (const mt of report.transitionCoverage.missingTransitions) {
      const c = generateCaseForTransition(proto, mt, classifyViolation(mt));
      if (c) cases.push(c);
    }

    if (cases.length > 0) {
      generated[report.protocol] = cases;
    }
  }

  return generated;
}

/**
 * Generate and write benchmark files for uncovered transitions.
 * Does NOT overwrite existing files — writes to benchmarks/generated/.
 */
export function writeGeneratedBenchmarks(
  generated: Record<string, GeneratedCase[]>,
  outputDir?: string
): string[] {
  const outDir = outputDir || path.resolve(__dirname, "..", "benchmarks", "generated");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const written: string[] = [];
  const timestamp = new Date().toISOString().slice(0, 10);

  for (const [protocol, cases] of Object.entries(generated)) {
    if (cases.length === 0) continue;

    const filename = `${protocol.toLowerCase()}_generated_${timestamp}.json`;
    const filepath = path.join(outDir, filename);

    const suite: GeneratedSuite = {
      protocol,
      generatedAt: new Date().toISOString(),
      cases,
      source: "coverage-gap",
    };

    fs.writeFileSync(filepath, JSON.stringify(suite, null, 2));
    written.push(filepath);
  }

  return written;
}

/**
 * Full pipeline: analyze → generate → write → report.
 */
export function runCoverageDrivenGeneration(): {
  existingCases: number;
  generatedCases: number;
  writtenFiles: string[];
  summary: string;
} {
  const trajs = loadTrajectories();
  const generated = generateMissingBenchmarks(trajs);

  const totalCases = Object.values(generated).reduce((s, c) => s + c.length, 0);
  const written = writeGeneratedBenchmarks(generated);

  const protocols = Object.keys(generated).join(", ");
  return {
    existingCases: trajs.length,
    generatedCases: totalCases,
    writtenFiles: written,
    summary: totalCases > 0
      ? `Generated ${totalCases} benchmark cases for ${Object.keys(generated).length} protocols: ${protocols}`
      : "All transitions covered. No new cases needed.",
  };
}
