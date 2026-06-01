"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
// @progmune-generated session=sess_1780343418638_31zut timestamp=2026-06-01T19:50:19.661Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 384 functions, 17 protocol rules
const failure_corpus_1 = require("./failure-corpus");
function main() {
    const stats = (0, failure_corpus_1.getAntibodyStats)();
    return stats;
}
main();
