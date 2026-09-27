"use strict";
/**
 * Phase 1: Trust Report — JSON Formatter
 *
 * Machine-readable output for CI/CD pipelines.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatTrustJSON = formatTrustJSON;
function formatTrustJSON(decision, pretty) {
    return JSON.stringify(decision, null, pretty !== false ? 2 : 0);
}
