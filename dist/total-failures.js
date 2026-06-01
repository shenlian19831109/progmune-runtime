"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
// @progmune-generated session=sess_1780346871759_o27rs timestamp=2026-06-01T20:47:53.355Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 393 functions, 17 protocol rules
const failure_corpus_1 = require("./failure-corpus");
function main() {
    const genome = (0, failure_corpus_1.getFailureGenome)();
    return "genome.totalFailures";
}
main();
