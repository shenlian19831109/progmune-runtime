"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
// @progmune-generated session=sess_1780345697005_lpif0 timestamp=2026-06-01T20:28:18.667Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 386 functions, 17 protocol rules
const failure_corpus_1 = require("./failure-corpus");
function main() {
    const genome = (0, failure_corpus_1.getFailureGenome)();
    return genome;
}
main();
