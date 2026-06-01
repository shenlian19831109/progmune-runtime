"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
// @progmune-generated session=sess_1780343649325_e8j9k timestamp=2026-06-01T19:54:10.484Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 390 functions, 17 protocol rules
const failure_corpus_1 = require("./failure-corpus");
function main() {
    const stats = (0, failure_corpus_1.getAntibodyStats)();
    return stats;
}
main();
