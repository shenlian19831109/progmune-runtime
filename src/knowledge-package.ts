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

import * as fs from "fs";
import { buildKnowledgeBase } from "./protocol-knowledge";
import type { KnowledgeUnit } from "./protocol-knowledge";

export interface KnowledgePackage {
  name: string;
  domain: string;
  version: string;
  exported: string;
  units: KnowledgeUnit[];
  summary: {
    totalUnits: number;
    stableUnits: number;
    totalConcepts: number;
    totalEvidence: number;
    validatedRepos: string[];
    rfcReferences: string[];
  };
}

export function packageDomain(domain: string): KnowledgePackage {
  const kb = buildKnowledgeBase();
  const units = kb.units.filter(u => u.domain === domain);
  if (units.length === 0) throw new Error(`Domain not found: ${domain}`);

  const stable = units.filter(u => u.maturity === "stable");
  const allConcepts = units.flatMap(u => u.concepts || []);
  const allEvidence = units.flatMap(u => u.evidence || []);
  const allRepos = [...new Set(units.flatMap(u => u.validatedRepos))];
  const allRFCs = [...new Set(units.map(u => u.rfcReference).filter(Boolean))] as string[];

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

export function packageAll(): KnowledgePackage[] {
  const kb = buildKnowledgeBase();
  const domains = [...new Set(kb.units.map(u => u.domain))];
  return domains.map(packageDomain);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes("--all")) {
    const pkgs = packageAll();
    for (const pkg of pkgs) {
      const path = `benchmarks/kb-package-${pkg.domain.toLowerCase()}.json`;
      if (!fs.existsSync("benchmarks")) fs.mkdirSync("benchmarks");
      fs.writeFileSync(path, JSON.stringify(pkg, null, 2));
      console.log(`✅ ${pkg.domain}: ${pkg.summary.totalUnits} units, ${pkg.summary.stableUnits} stable → ${path}`);
    }
  } else {
    const domain = args[0] || "TLS";
    const pkg = packageDomain(domain);
    console.log(JSON.stringify(pkg, null, 2));
  }
}
