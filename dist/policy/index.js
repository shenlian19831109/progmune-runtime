"use strict";
/**
 * Phase 11: Policy Engine Module
 *
 * Public API for deployment gating and policy enforcement.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_POLICY = exports.evaluatePolicy = void 0;
var engine_1 = require("./engine");
Object.defineProperty(exports, "evaluatePolicy", { enumerable: true, get: function () { return engine_1.evaluatePolicy; } });
var types_1 = require("./types");
Object.defineProperty(exports, "DEFAULT_POLICY", { enumerable: true, get: function () { return types_1.DEFAULT_POLICY; } });
