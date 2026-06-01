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
exports.benchmarkReport = benchmarkReport;
/** Format benchmark results as a readable report
 * @protocol pre_states=["BENCHMARKS_LOADED"] post_states=["REPORT_FORMATTED"]
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
function benchmarkReport() {
    const resultsDir = path.resolve(process.cwd(), "bench");
    if (!fs.existsSync(resultsDir))
        return "No benchmark results.";
    const files = fs.readdirSync(resultsDir)
        .filter(f => f.startsWith("results-") && f.endsWith(".json"))
        .sort().reverse();
    if (files.length === 0)
        return "No benchmark results.";
    const latest = files[0];
    const results = JSON.parse(fs.readFileSync(path.join(resultsDir, latest), "utf-8"));
    const passed = results.filter(r => r.compile_success).length;
    const repaired = results.filter(r => r.repair_applied).length;
    const lines = [
        `Benchmark: ${results.length} tasks`,
        `Compiled: ${passed}/${results.length} (${((passed / results.length) * 100).toFixed(1)}%)`,
        `Repaired: ${repaired}`,
        "",
    ];
    for (const r of results) {
        const icon = r.compile_success ? "✅" : "❌";
        const repair = r.repair_applied ? " 🔧" : "";
        lines.push(`${icon} ${r.id}: ${r.intent.slice(0, 60)}${repair}`);
    }
    return lines.join("\n");
}
