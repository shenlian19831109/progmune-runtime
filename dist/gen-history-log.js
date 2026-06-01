"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
// @progmune-generated session=sess_1780343705506_4rpek timestamp=2026-06-01T19:55:07.332Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 392 functions, 17 protocol rules
const execute_1 = require("./execute");
const memory_layer_1 = require("./memory-layer");
function main() {
    const metrics = (0, execute_1.getExecutionMetrics)();
    const episodes = (0, memory_layer_1.getRecentEpisodes)(0);
    return episodes;
}
main();
