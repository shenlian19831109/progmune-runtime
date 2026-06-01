"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
// @progmune-generated session=sess_1780343925827_zga2j timestamp=2026-06-01T19:58:47.097Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 398 functions, 17 protocol rules
const failure_corpus_1 = require("./failure-corpus");
function main() {
    const sessions = (0, failure_corpus_1.getAllSessions)();
    const idx = findIndex();
    return sessions;
}
main();
