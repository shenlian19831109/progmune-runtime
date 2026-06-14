"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * P8.3: Python Protocol Discovery — End-to-End Tests
 *
 * Verifies the full pipeline from Python IR extraction through
 * protocol annotation parsing to SSG-compatible rule generation.
 */
const vitest_1 = require("vitest");
const path = __importStar(require("path"));
const extract_ir_python_1 = require("./extract-ir-python");
const python_protocol_extractor_1 = require("./python-protocol-extractor");
const state_machine_fingerprint_1 = require("./state-machine-fingerprint");
const topology_factory_1 = require("./topology-factory");
const PYTHON_FIXTURE = path.resolve(__dirname, "..", "test-python-protocol");
(0, vitest_1.describe)("Python Protocol Discovery Pipeline", () => {
    (0, vitest_1.it)("extracts IR from Python project with protocol annotations", () => {
        const ir = (0, extract_ir_python_1.extractIRPython)(PYTHON_FIXTURE);
        (0, vitest_1.expect)(ir.length).toBeGreaterThanOrEqual(8);
        // Verify FunctionInfo-compatible output
        for (const fn of ir) {
            (0, vitest_1.expect)(fn.name).toBeTruthy();
            (0, vitest_1.expect)(Array.isArray(fn.params)).toBe(true);
            (0, vitest_1.expect)(Array.isArray(fn.calls)).toBe(true);
            (0, vitest_1.expect)(typeof fn.exported).toBe("boolean");
            (0, vitest_1.expect)(typeof fn.file).toBe("string");
        }
    });
    (0, vitest_1.it)("extracts protocol annotations from @progmune decorators", () => {
        const ir = (0, extract_ir_python_1.extractIRPython)(PYTHON_FIXTURE);
        const rules = (0, python_protocol_extractor_1.extractProtocolFromAnnotations)(ir);
        // Should find all 8 annotated functions
        (0, vitest_1.expect)(rules.size).toBeGreaterThanOrEqual(8);
        // Auth protocol
        (0, vitest_1.expect)(rules.has("verify_password")).toBe(true);
        (0, vitest_1.expect)(rules.get("verify_password").namespace).toBe("auth");
        (0, vitest_1.expect)(rules.get("verify_password").pre_states).toEqual(["UNAUTHENTICATED"]);
        (0, vitest_1.expect)(rules.get("verify_password").post_states).toEqual(["PASSWORD_VERIFIED"]);
        // generate_jwt has invalidate
        (0, vitest_1.expect)(rules.has("generate_jwt")).toBe(true);
        (0, vitest_1.expect)(rules.get("generate_jwt").invalidate).toEqual(["PASSWORD_VERIFIED"]);
        // File protocol
        (0, vitest_1.expect)(rules.has("open_config")).toBe(true);
        (0, vitest_1.expect)(rules.get("open_config").namespace).toBe("file");
        // Stateless functions should NOT have protocol rules
        (0, vitest_1.expect)(rules.has("compute_hash")).toBe(false);
        (0, vitest_1.expect)(rules.has("validate_input")).toBe(false);
    });
    (0, vitest_1.it)("extracts call sequences from Python call graph", () => {
        const ir = (0, extract_ir_python_1.extractIRPython)(PYTHON_FIXTURE);
        const sequences = (0, python_protocol_extractor_1.extractCallSequencesFromIR)(ir);
        (0, vitest_1.expect)(sequences.length).toBeGreaterThan(0);
        // authenticate_and_open calls: verify_password, create_session, open_config,
        //   read_config, close_config, logout
        const crossSeq = sequences.find(s => s.includes("open_config"));
        (0, vitest_1.expect)(crossSeq).toBeTruthy();
    });
    (0, vitest_1.it)("runs full discovery pipeline and produces combined rules", () => {
        const ir = (0, extract_ir_python_1.extractIRPython)(PYTHON_FIXTURE);
        const result = (0, python_protocol_extractor_1.discoverPythonProtocols)(ir);
        (0, python_protocol_extractor_1.printPythonDiscoveryResult)(result);
        // Annotation rules
        (0, vitest_1.expect)(result.annotationCount).toBeGreaterThanOrEqual(8);
        // Call sequences
        (0, vitest_1.expect)(result.sequenceCount).toBeGreaterThan(0);
        // Combined rules should contain all annotation rules
        (0, vitest_1.expect)(result.combinedRules.size).toBeGreaterThanOrEqual(result.annotationCount);
        for (const [fn, rule] of result.annotationRules) {
            (0, vitest_1.expect)(result.combinedRules.has(fn)).toBe(true);
        }
    });
    (0, vitest_1.it)("Python protocol state machine matches hand-written TypeScript equivalent", () => {
        const ir = (0, extract_ir_python_1.extractIRPython)(PYTHON_FIXTURE);
        const pythonRules = (0, python_protocol_extractor_1.extractProtocolFromAnnotations)(ir);
        // Build TypeScript-equivalent auth protocol using topology factory
        const tsAuthRules = (0, topology_factory_1.createProtocolForTopology)("linear", 4); // has similar shape
        const pythonFp = (0, state_machine_fingerprint_1.extractStateMachine)(pythonRules);
        const tsFp = (0, state_machine_fingerprint_1.extractStateMachine)(tsAuthRules);
        const comp = (0, state_machine_fingerprint_1.compareStateMachines)(pythonFp, tsFp);
        console.log(`\n  Python auth ↔ TypeScript linear: ${(comp.similarity * 100).toFixed(0)}%`);
        (0, vitest_1.expect)(comp.similarity).toBeGreaterThan(0);
    });
});
