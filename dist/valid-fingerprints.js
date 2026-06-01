"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
// @progmune-generated session=sess_1780343878763_2tpv3 timestamp=2026-06-01T19:58:00.794Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 396 functions, 17 protocol rules
const immune_reporter_1 = require("./immune-reporter");
const ledger_registry_1 = require("./ledger-registry");
function main() {
    const fps = (0, immune_reporter_1.extractFingerprints)({});
    const summary = (0, ledger_registry_1.verifyAllFingerprints)("defaultStr");
    return summary;
}
main();
