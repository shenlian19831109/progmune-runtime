"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
// @progmune-generated session=sess_1780345171834_s7714 timestamp=2026-06-01T20:19:33.214Z ruleHash=9dec68bc2995e92a
// Generated with IR constraint: 382 functions, 17 protocol rules
const semantic_snapshot_1 = require("./semantic-snapshot");
function main(sessionId) {
    const snapshot = (0, semantic_snapshot_1.findSnapshotBySession)(sessionId);
    return snapshot;
}
