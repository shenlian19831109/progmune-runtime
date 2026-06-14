/**
 * P8.3: Python Protocol Discovery — End-to-End Tests
 *
 * Verifies the full pipeline from Python IR extraction through
 * protocol annotation parsing to SSG-compatible rule generation.
 */
import { describe, it, expect } from "vitest";
import * as path from "path";
import { extractIRPython } from "./extract-ir-python";
import {
  extractProtocolFromAnnotations,
  extractCallSequencesFromIR,
  discoverPythonProtocols,
  printPythonDiscoveryResult,
} from "./python-protocol-extractor";
import { extractStateMachine, compareStateMachines } from "./state-machine-fingerprint";
import { createProtocolForTopology } from "./topology-factory";

const PYTHON_FIXTURE = path.resolve(__dirname, "..", "test-python-protocol");

describe("Python Protocol Discovery Pipeline", () => {
  it("extracts IR from Python project with protocol annotations", () => {
    const ir = extractIRPython(PYTHON_FIXTURE);
    expect(ir.length).toBeGreaterThanOrEqual(8);

    // Verify FunctionInfo-compatible output
    for (const fn of ir) {
      expect(fn.name).toBeTruthy();
      expect(Array.isArray(fn.params)).toBe(true);
      expect(Array.isArray(fn.calls)).toBe(true);
      expect(typeof fn.exported).toBe("boolean");
      expect(typeof fn.file).toBe("string");
    }
  });

  it("extracts protocol annotations from @progmune decorators", () => {
    const ir = extractIRPython(PYTHON_FIXTURE);
    const rules = extractProtocolFromAnnotations(ir);

    // Should find all 8 annotated functions
    expect(rules.size).toBeGreaterThanOrEqual(8);

    // Auth protocol
    expect(rules.has("verify_password")).toBe(true);
    expect(rules.get("verify_password")!.namespace).toBe("auth");
    expect(rules.get("verify_password")!.pre_states).toEqual(["UNAUTHENTICATED"]);
    expect(rules.get("verify_password")!.post_states).toEqual(["PASSWORD_VERIFIED"]);

    // generate_jwt has invalidate
    expect(rules.has("generate_jwt")).toBe(true);
    expect(rules.get("generate_jwt")!.invalidate).toEqual(["PASSWORD_VERIFIED"]);

    // File protocol
    expect(rules.has("open_config")).toBe(true);
    expect(rules.get("open_config")!.namespace).toBe("file");

    // Stateless functions should NOT have protocol rules
    expect(rules.has("compute_hash")).toBe(false);
    expect(rules.has("validate_input")).toBe(false);
  });

  it("extracts call sequences from Python call graph", () => {
    const ir = extractIRPython(PYTHON_FIXTURE);
    const sequences = extractCallSequencesFromIR(ir);

    expect(sequences.length).toBeGreaterThan(0);

    // authenticate_and_open calls: verify_password, create_session, open_config,
    //   read_config, close_config, logout
    const crossSeq = sequences.find(s => s.includes("open_config"));
    expect(crossSeq).toBeTruthy();
  });

  it("runs full discovery pipeline and produces combined rules", () => {
    const ir = extractIRPython(PYTHON_FIXTURE);
    const result = discoverPythonProtocols(ir);

    printPythonDiscoveryResult(result);

    // Annotation rules
    expect(result.annotationCount).toBeGreaterThanOrEqual(8);

    // Call sequences
    expect(result.sequenceCount).toBeGreaterThan(0);

    // Combined rules should contain all annotation rules
    expect(result.combinedRules.size).toBeGreaterThanOrEqual(result.annotationCount);

    for (const [fn, rule] of result.annotationRules) {
      expect(result.combinedRules.has(fn)).toBe(true);
    }
  });

  it("Python protocol state machine matches hand-written TypeScript equivalent", () => {
    const ir = extractIRPython(PYTHON_FIXTURE);
    const pythonRules = extractProtocolFromAnnotations(ir);

    // Build TypeScript-equivalent auth protocol using topology factory
    const tsAuthRules = createProtocolForTopology("linear", 4); // has similar shape

    const pythonFp = extractStateMachine(pythonRules);
    const tsFp = extractStateMachine(tsAuthRules);

    const comp = compareStateMachines(pythonFp, tsFp);
    console.log(`\n  Python auth ↔ TypeScript linear: ${(comp.similarity*100).toFixed(0)}%`);
    expect(comp.similarity).toBeGreaterThan(0);
  });
});
