"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
// @progmune-generated session=sess_1780345916092_sn5tt timestamp=2026-06-01T20:31:57.612Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 390 functions, 17 protocol rules
const failure_corpus_1 = require("./failure-corpus");
function main() {
    const failures = (0, failure_corpus_1.getAllFailures)();
    return failures;
}
main();
