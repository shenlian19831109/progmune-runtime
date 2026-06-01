"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
// @progmune-generated session=sess_1780343822181_r90g9 timestamp=2026-06-01T19:57:03.488Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 394 functions, 17 protocol rules
const failure_corpus_1 = require("./failure-corpus");
function main() {
    const genome = (0, failure_corpus_1.getFailureGenome)();
    return genome;
}
main();
