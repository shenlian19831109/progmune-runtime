"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
// @progmune-generated session=sess_1780343673382_7ucqe timestamp=2026-06-01T19:54:34.915Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 391 functions, 17 protocol rules
const ledger_registry_1 = require("./ledger-registry");
const failure_corpus_1 = require("./failure-corpus");
const ssg_validator_1 = require("./ssg-validator");
function main() {
    const summary = (0, ledger_registry_1.verifyAllFingerprints)("defaultStr");
    const sessions = (0, failure_corpus_1.getAllSessions)();
    const states = (0, ssg_validator_1.listAllStates)(sessions);
    return sessions;
}
main();
