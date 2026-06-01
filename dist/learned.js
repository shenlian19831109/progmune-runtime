"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
// @progmune-generated session=sess_1780345941461_pofm6 timestamp=2026-06-01T20:32:23.160Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 391 functions, 17 protocol rules
const failure_corpus_1 = require("./failure-corpus");
function main() {
    const patterns = (0, failure_corpus_1.getLearnedPatterns)();
    return patterns;
}
main();
