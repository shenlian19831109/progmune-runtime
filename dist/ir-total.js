"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
// @progmune-generated session=sess_1780346660817_bcum7 timestamp=2026-06-01T20:44:22.826Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 392 functions, 17 protocol rules
const extract_ir_1 = require("./extract-ir");
const validator_1 = require("./validator");
function main() {
    const ir = (0, extract_ir_1.extractIR)("");
    const validated = (0, validator_1.validateAction)(ir, 0);
    return validated;
}
main();
