"use strict";
/**
 * Phase 11: Policy Engine Types
 *
 * Declarative rules that gate AI-generated code from deployment.
 * Transforms governance from "report" to "enforce".
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_POLICY = void 0;
/** Default policy — can be overridden by .progmune-policy.json */
exports.DEFAULT_POLICY = [
    {
        type: "confidence",
        severity: "block",
        description: "Certificate confidence must be medium or higher",
        threshold: 1, // 0=low, 1=medium, 2=high
    },
    {
        type: "provenance",
        severity: "block",
        description: "Provenance chain must be intact",
    },
    {
        type: "plsb_coverage",
        severity: "warn",
        description: "PLSB must cover at least 5/13 categories",
        threshold: 5,
    },
    {
        type: "human_review",
        severity: "block",
        description: "At least 1 human must be in the accountability chain",
        require: 1,
    },
    {
        type: "fingerprint",
        severity: "warn",
        description: "Fingerprint must exist and be verified",
    },
    {
        type: "violations",
        severity: "block",
        description: "No SSG ledger violations allowed",
        threshold: 0,
    },
    {
        type: "kb_coverage",
        severity: "warn",
        description: "Knowledge Base must have at least 3 stable protocol assets",
        threshold: 3,
    },
    {
        type: "risk",
        severity: "block",
        description: "Block Critical risks with ≥90% confidence. Warn on High risks with ≥70% confidence.",
        threshold: 2, // severity: 0=Low, 1=Medium, 2=High, 3=Critical → block if >= 2 with enough confidence
        require: 70, // minimum confidence %
    },
];
