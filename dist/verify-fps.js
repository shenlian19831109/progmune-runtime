"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
// @progmune-generated session=sess_1780345747502_y4u91 timestamp=2026-06-01T20:29:08.854Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 388 functions, 17 protocol rules
const ledger_registry_1 = require("./ledger-registry");
function main() {
    const result = (0, ledger_registry_1.verifyAllFingerprints)("");
    return result;
}
main();
