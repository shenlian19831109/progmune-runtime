"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
// @progmune-generated session=sess_1780343460763_6iyf4 timestamp=2026-06-01T19:51:02.054Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 386 functions, 17 protocol rules
const ledger_registry_1 = require("./ledger-registry");
function main() {
    const summary = (0, ledger_registry_1.verifyAllFingerprints)("defaultStr");
    return summary;
}
main();
