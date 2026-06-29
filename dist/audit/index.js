"use strict";
/**
 * Phase 9: Governance Audit Module
 *
 * Public API for AI Code Governance Reports.
 * Re-exports the builder, types, and formatters.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatAsMarkdown = exports.formatAsTerminal = exports.formatAsJSON = exports.buildGovernanceReport = void 0;
var report_builder_1 = require("./report-builder");
Object.defineProperty(exports, "buildGovernanceReport", { enumerable: true, get: function () { return report_builder_1.buildGovernanceReport; } });
var json_1 = require("./formatters/json");
Object.defineProperty(exports, "formatAsJSON", { enumerable: true, get: function () { return json_1.formatAsJSON; } });
var terminal_1 = require("./formatters/terminal");
Object.defineProperty(exports, "formatAsTerminal", { enumerable: true, get: function () { return terminal_1.formatAsTerminal; } });
var markdown_1 = require("./formatters/markdown");
Object.defineProperty(exports, "formatAsMarkdown", { enumerable: true, get: function () { return markdown_1.formatAsMarkdown; } });
