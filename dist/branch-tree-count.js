"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
// @progmune-generated session=sess_1780343627181_k5xw4 timestamp=2026-06-01T19:53:48.655Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 389 functions, 17 protocol rules
const failure_corpus_1 = require("./failure-corpus");
const branch_ledger_1 = require("./branch-ledger");
function main() {
    const sessions = (0, failure_corpus_1.getAllSessions)();
    const root = (0, branch_ledger_1.findRootBranch)(sessions);
    const children = (0, branch_ledger_1.findChildBranches)(root, {});
    return children;
}
main();
