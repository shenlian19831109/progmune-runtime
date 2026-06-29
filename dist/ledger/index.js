"use strict";
/**
 * Phase 9-10: Ledger Module
 *
 * Public API for provenance tracking and accountability.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyAccountabilityChain = exports.buildAccountabilityChain = exports.buildProvenanceChain = void 0;
var chain_builder_1 = require("./chain-builder");
Object.defineProperty(exports, "buildProvenanceChain", { enumerable: true, get: function () { return chain_builder_1.buildProvenanceChain; } });
var accountability_1 = require("./accountability");
Object.defineProperty(exports, "buildAccountabilityChain", { enumerable: true, get: function () { return accountability_1.buildAccountabilityChain; } });
Object.defineProperty(exports, "verifyAccountabilityChain", { enumerable: true, get: function () { return accountability_1.verifyAccountabilityChain; } });
