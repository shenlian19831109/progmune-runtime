/**
 * P5.5: Protocol Extraction Engine
 *
 * Auto-extracts protocol state machines from real code patterns.
 * No hand-written rules — the code IS the specification.
 *
 * Algorithm:
 *   1. Parse source code to extract function call sequences
 *   2. Build transition frequency matrix: count fnA→fnB pairs
 *   3. For frequent pairs, infer states and pre/post conditions
 *   4. Output ProtocolDefinition compatible with SSG validator
 *
 * This addresses the biggest remaining bottleneck:
 *   Knowledge Acquisition (57% missing_candidate)
 */

import * as fs from "fs";
import * as path from "path";
import type { StateAnnotation } from "./ssg-validator";
import type { ProtocolDefinition } from "./protocol-coverage";

// ═══════════════════════════════════════════════════════════════
// Call Sequence Extraction
// ═══════════════════════════════════════════════════════════════

export interface CallPair {
  from: string;
  to: string;
  file: string;
  line: number;
}

/**
 * Extract function call pairs from source code.
 *
 * Matches patterns like:
 *   obj.open(); ... obj.read(); ... obj.close();
 *   connect(); ... query(); ... disconnect();
 *
 * Uses a sliding window: any two function calls within
 * the same scope block are considered a potential pair.
 */
export function extractCallPairs(
  source: string,
  file: string = "<input>"
): CallPair[] {
  const pairs: CallPair[] = [];

  // Match function calls: identifier(args) OR obj.identifier(args)
  const callRegex = /\b([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)?)\s*\(/g;
  const lines = source.split("\n");

  // Track calls per scope block (delimited by { })
  let scopeDepth = 0;
  let scopeCalls: { name: string; line: number }[] = [];

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];

    // Track scope depth
    for (const ch of line) {
      if (ch === "{") scopeDepth++;
      if (ch === "}") {
        scopeDepth--;
        if (scopeDepth === 0) {
          // End of top-level scope: flush pairs
          for (let i = 0; i < scopeCalls.length - 1; i++) {
            for (let j = i + 1; j < scopeCalls.length; j++) {
              pairs.push({
                from: normalizeFn(scopeCalls[i].name),
                to: normalizeFn(scopeCalls[j].name),
                file,
                line: 0 + 1,
              });
            }
          }
          scopeCalls = [];
        }
      }
    }

    // Extract function calls on this line
    let match;
    callRegex.lastIndex = 0;
    while ((match = callRegex.exec(line)) !== null) {
      const fnName = match[1];
      // Filter out common language builtins and keywords
      if (!isBuiltin(fnName)) {
        scopeCalls.push({ name: fnName, line: 0 + 1 });
      }
    }
  }

  // Flush remaining calls
  for (let i = 0; i < scopeCalls.length - 1; i++) {
    for (let j = i + 1; j < scopeCalls.length; j++) {
      pairs.push({
        from: normalizeFn(scopeCalls[i].name),
        to: normalizeFn(scopeCalls[j].name),
        file,
        line: 0,
      });
    }
  }

  return pairs;
}

function normalizeFn(fn: string): string {
  // obj.method → method (strip object prefix)
  const parts = fn.split(".");
  return parts[parts.length - 1];
}

function isBuiltin(name: string): boolean {
  const builtins = new Set([
    "if", "for", "while", "switch", "return", "console", "log",
    "require", "import", "export", "print", "len", "push", "pop",
    "map", "filter", "reduce", "forEach", "toString", "valueOf",
    "assert", "expect", "test", "describe", "it",
    "main", "printf", "write_config", "sprintf", "fprintf",
    "setup", "teardown", "init", "destroy", "cleanup",
  ]);
  const normalized = normalizeFn(name);
  return builtins.has(normalized) || normalized.length <= 2;
}

// ═══════════════════════════════════════════════════════════════
// Transition Inference
// ═══════════════════════════════════════════════════════════════

export interface InferredRule {
  function: string;
  pre_states: string[];
  post_states: string[];
  invalidate?: string[];
  confidence: number;
  evidence: number;
}

/**
 * Infer protocol rules from call pairs.
 *
 * For each frequent pair fnA→fnB:
 *   1. Create a shared state connecting them
 *   2. fnA produces the state, fnB requires it
 *   3. Track invalidations: if a state producer is followed
 *      by a function with no downstream consumer, the last
 *      consumer invalidates it
 */
export function inferProtocolRules(
  pairs: CallPair[],
  minFrequency: number = 3
): InferredRule[] {
  // Count transition frequencies
  const transitions = new Map<string, number>();
  const fnSet = new Set<string>();

  for (const p of pairs) {
    const key = `${p.from}→${p.to}`;
    transitions.set(key, (transitions.get(key) || 0) + 1);
    fnSet.add(p.from);
    fnSet.add(p.to);
  }

  const maxFreq = Math.max(1, ...[...transitions.values()]);
  const rules: InferredRule[] = [];
  const fnStates = new Map<string, { produced: Set<string>; required: Set<string> }>();

  // For each frequent transition, infer a shared state
  for (const [key, freq] of transitions) {
    if (freq < minFrequency) continue;

    const [fnA, fnB] = key.split("→");
    const confidence = freq / maxFreq;

    // Create a shared state name from the function pair
    const stateName = inferStateName(fnA, fnB);

    // fnA produces this state
    const aStates = fnStates.get(fnA) || { produced: new Set(), required: new Set() };
    aStates.produced.add(stateName);
    fnStates.set(fnA, aStates);

    // fnB requires this state
    const bStates = fnStates.get(fnB) || { produced: new Set(), required: new Set() };
    bStates.required.add(stateName);
    fnStates.set(fnB, bStates);
  }

  // Infer invalidations: the "closing" function of a group invalidates
  // the state that the "opening" function produced
  const closingKeywords = ["close", "disconnect", "logout", "destroy", "free", "release", "stop", "end", "finish"];
  const openingKeywords = ["open", "connect", "login", "create", "alloc", "init", "start", "begin"];

  // Convert to rules
  for (const [fn, states] of fnStates) {
    const rule: InferredRule = {
      function: fn,
      pre_states: [...states.required],
      post_states: [...states.produced],
      confidence: 0.5,
      evidence: 1,
    };

    // Check if this is a "closing" function — it should invalidate opening states
    const isCloser = closingKeywords.some(kw => fn.includes(kw));
    const isOpener = openingKeywords.some(kw => fn.includes(kw));

    if (isCloser) {
      // Find what state this closes (the corresponding opener's produced state)
      for (const [otherFn, otherStates] of fnStates) {
        if (openingKeywords.some(kw => otherFn.includes(kw))) {
          const sharedState = [...otherStates.produced].find(s =>
            states.required.has(s)
          );
          if (sharedState) {
            rule.invalidate = [sharedState];
          }
        }
      }
    }

    // Estimate confidence from evidence count
    const prodCount = states.produced.size + states.required.size;
    rule.evidence = prodCount;
    rule.confidence = Math.min(1, prodCount / 5);

    rules.push(rule);
  }

  return rules.sort((a, b) => b.confidence - a.confidence);
}

function inferStateName(fnA: string, fnB: string): string {
  // Create a meaningful state name from the function pair
  const domain = fnA.includes("file") || fnB.includes("file") ? "FILE" :
    fnA.includes("auth") || fnB.includes("auth") || fnA.includes("login") || fnB.includes("login") ? "AUTH" :
    fnA.includes("db") || fnB.includes("db") || fnA.includes("connect") || fnB.includes("connect") ? "DB" :
    "STATE";

  const action = fnA.includes("open") || fnB.includes("open") ? "_OPEN" :
    fnA.includes("close") || fnB.includes("close") ? "_CLOSED" :
    fnA.includes("connect") || fnB.includes("connect") ? "_CONNECTED" :
    fnA.includes("create") || fnB.includes("create") ? "_CREATED" :
    fnA.includes("init") || fnB.includes("init") ? "_INITIALIZED" :
    "";

  return `${domain}${action}`.toUpperCase();
}

// ═══════════════════════════════════════════════════════════════
// Full Extraction Pipeline
// ═══════════════════════════════════════════════════════════════

export interface ExtractionResult {
  protocol: string;
  rules: InferredRule[];
  inferredStates: string[];
  sourceFiles: string[];
  totalPairs: number;
  confidence: number;
}

/**
 * Extract protocol rules from one or more source files.
 */
export function extractProtocol(
  sources: { code: string; file: string }[],
  protocolName: string = "ExtractedProtocol",
  minFrequency: number = 3
): ExtractionResult {
  const allPairs: CallPair[] = [];
  const sourceFiles: string[] = [];

  for (const src of sources) {
    const pairs = extractCallPairs(src.code, src.file);
    allPairs.push(...pairs);
    sourceFiles.push(src.file);
  }

  const rules = inferProtocolRules(allPairs, minFrequency);
  const states = new Set<string>();
  for (const r of rules) {
    for (const s of r.pre_states) states.add(s);
    for (const s of r.post_states) states.add(s);
  }

  const avgConfidence = rules.length > 0
    ? rules.reduce((s, r) => s + r.confidence, 0) / rules.length
    : 0;

  return {
    protocol: protocolName,
    rules,
    inferredStates: [...states],
    sourceFiles,
    totalPairs: allPairs.length,
    confidence: avgConfidence,
  };
}

/**
 * Extract from file paths (reads files from disk).
 */
export function extractProtocolFromFiles(
  filePaths: string[],
  protocolName: string = "ExtractedProtocol",
  minFrequency: number = 3
): ExtractionResult {
  const sources = filePaths.map(fp => ({
    code: fs.readFileSync(fp, "utf-8"),
    file: fp,
  }));
  return extractProtocol(sources, protocolName, minFrequency);
}

/**
 * Convert extracted rules to SSG-compatible StateAnnotation map.
 */
export function rulesToAnnotationMap(
  rules: InferredRule[]
): Map<string, StateAnnotation> {
  const map = new Map<string, StateAnnotation>();
  for (const r of rules) {
    map.set(r.function, {
      pre_states: r.pre_states,
      post_states: r.post_states,
      invalidate: r.invalidate,
    });
  }
  return map;
}

export function printExtractionReport(result: ExtractionResult): void {
  console.log("\n╔════════════════════════════════════════════════════╗");
  console.log("║   P5.5 Protocol Extraction Report                  ║");
  console.log("╚════════════════════════════════════════════════════╝\n");

  console.log(`Protocol:       ${result.protocol}`);
  console.log(`Source Files:   ${result.sourceFiles.length}`);
  console.log(`Call Pairs:     ${result.totalPairs}`);
  console.log(`Rules Inferred: ${result.rules.length}`);
  console.log(`States Inferred: ${result.inferredStates.length}`);
  console.log(`Avg Confidence: ${(result.confidence * 100).toFixed(0)}%`);
  console.log();

  if (result.rules.length > 0) {
    console.log("─── Inferred Rules ───");
    console.log("Conf    Function              Pre → Post               Invalidate");
    console.log("──────────────────────────────────────────────────────────────────");

    for (const r of result.rules.slice(0, 20)) {
      const conf = (r.confidence * 100).toFixed(0).padStart(4);
      const fn = r.function.padEnd(22);
      const pre = `[${r.pre_states.join(",") || "none"}]`.padEnd(22);
      const post = `[${r.post_states.join(",") || "none"}]`.padEnd(22);
      const inv = r.invalidate ? `[${r.invalidate.join(",")}]` : "—";
      console.log(`  ${conf}%  ${fn} ${pre} → ${post} ${inv}`);
    }
    console.log();
  }
}
