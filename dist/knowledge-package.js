"use strict";
/**
 * Knowledge Package — Standalone exportable protocol domain package
 *
 * Each domain (TLS, SSH, HTTP) can be exported as a self-contained
 * JSON package with all units, evidence, concepts, and version history.
 *
 * Usage:
 *   npx ts-node src/knowledge-package.ts TLS
 *   npx ts-node src/knowledge-package.ts --all
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.packageDomain = packageDomain;
exports.packageAll = packageAll;
const fs = __importStar(require("fs"));
const protocol_knowledge_1 = require("./protocol-knowledge");
function packageDomain(domain) {
    const kb = (0, protocol_knowledge_1.buildKnowledgeBase)();
    const units = kb.units.filter(u => u.domain === domain);
    if (units.length === 0)
        throw new Error(`Domain not found: ${domain}`);
    const stable = units.filter(u => u.maturity === "stable");
    const allConcepts = units.flatMap(u => u.concepts || []);
    const allEvidence = units.flatMap(u => u.evidence || []);
    const allRepos = [...new Set(units.flatMap(u => u.validatedRepos))];
    const allRFCs = [...new Set(units.map(u => u.rfcReference).filter(Boolean))];
    return {
        name: `${domain} Protocol Domain`,
        domain,
        version: kb.version,
        exported: new Date().toISOString(),
        units,
        summary: {
            totalUnits: units.length,
            stableUnits: stable.length,
            totalConcepts: allConcepts.length,
            totalEvidence: allEvidence.length,
            validatedRepos: allRepos,
            rfcReferences: allRFCs,
        },
    };
}
function packageAll() {
    const kb = (0, protocol_knowledge_1.buildKnowledgeBase)();
    const domains = [...new Set(kb.units.map(u => u.domain))];
    return domains.map(packageDomain);
}
if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.includes("--all")) {
        const pkgs = packageAll();
        for (const pkg of pkgs) {
            const path = `benchmarks/kb-package-${pkg.domain.toLowerCase()}.json`;
            if (!fs.existsSync("benchmarks"))
                fs.mkdirSync("benchmarks");
            fs.writeFileSync(path, JSON.stringify(pkg, null, 2));
            console.log(`✅ ${pkg.domain}: ${pkg.summary.totalUnits} units, ${pkg.summary.stableUnits} stable → ${path}`);
        }
    }
    else {
        const domain = args[0] || "TLS";
        const pkg = packageDomain(domain);
        console.log(JSON.stringify(pkg, null, 2));
    }
}
