"use strict";
/**
 * Phase 9: JSON Formatter
 *
 * Machine-readable governance report output.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatAsJSON = formatAsJSON;
function formatAsJSON(report, compress = false) {
    return JSON.stringify(report, null, compress ? 0 : 2);
}
