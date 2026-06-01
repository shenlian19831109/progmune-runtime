"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
// @progmune-generated session=sess_1780343799715_z6pcw timestamp=2026-06-01T19:56:41.675Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 393 functions, 17 protocol rules
const failure_corpus_1 = require("./failure-corpus");
function main() {
    const sessions = (0, failure_corpus_1.getAllSessions)();
    const failures = (0, failure_corpus_1.getAllFailures)();
    return failures;
}
main();
