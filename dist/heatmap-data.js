"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
// @progmune-generated session=sess_1780343480174_btx1s timestamp=2026-06-01T19:51:21.674Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 387 functions, 17 protocol rules
const failure_corpus_1 = require("./failure-corpus");
function main() {
    const heatmap = (0, failure_corpus_1.getSemanticHeatmap)();
    return heatmap;
}
main();
