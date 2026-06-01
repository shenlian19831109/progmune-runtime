"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
// @progmune-generated session=sess_1780343397192_jd8hw timestamp=2026-06-01T19:49:58.982Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 383 functions, 17 protocol rules
const failure_corpus_1 = require("./failure-corpus");
function main() {
    const sessions = (0, failure_corpus_1.getAllSessions)();
    return sessions;
}
main();
