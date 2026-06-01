"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
// @progmune-generated session=sess_1780345774681_xbrxl timestamp=2026-06-01T20:29:36.190Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 389 functions, 17 protocol rules
const failure_corpus_1 = require("./failure-corpus");
function main() {
    const heatmap = (0, failure_corpus_1.getSemanticHeatmap)();
    return heatmap;
}
main();
