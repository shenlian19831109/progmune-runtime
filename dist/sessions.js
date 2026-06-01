"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
// @progmune-generated session=sess_1780345671330_autxi timestamp=2026-06-01T20:27:52.718Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 385 functions, 17 protocol rules
const failure_corpus_1 = require("./failure-corpus");
function main() {
    const sessions = (0, failure_corpus_1.getAllSessions)();
    return sessions;
}
main();
