/**
 * Large-IR Experiment: 1000+ functions
 *
 * Hypothesis: At 519 functions, LLM keyword matching is near-optimal.
 * At 1000+ functions, Graph routing should outperform because
 * keyword matching returns too many irrelevant candidates.
 *
 * Method: Generate synthetic noise functions + real IR → test ON/OFF
 */

import * as fs from "fs";

// Load real IR
const irRaw = JSON.parse(fs.readFileSync("ir.json", "utf-8"));
const realFuncs = irRaw.functions || [];
console.log(`Real functions: ${realFuncs.length}`);

// Generate synthetic noise functions to reach target size
const TARGET = 1200;
const noiseCount = TARGET - realFuncs.length;

const NOISE_PREFIXES = [
  "get", "set", "update", "delete", "create", "load", "save", "fetch",
  "compute", "format", "parse", "serialize", "validate", "check", "verify",
  "init", "cleanup", "migrate", "export", "import", "sync", "merge", "split",
  "encrypt", "decrypt", "hash", "sign", "verify", "encode", "decode",
  "connect", "disconnect", "send", "receive", "ping", "health",
  "readConfig", "writeConfig", "listFiles", "watchDir", "ensureDir",
];

const NOISE_SUFFIXES = [
  "Data", "Result", "Record", "Entry", "Item", "Config", "Options",
  "Request", "Response", "Event", "Message", "Task", "Job", "Worker",
  "Handler", "Processor", "Provider", "Factory", "Builder", "Adapter",
];

const NOISE_DOMAINS = [
  "payment", "shipping", "inventory", "notification", "analytics",
  "reporting", "billing", "subscription", "user management", "search",
  "indexing", "caching", "queueing", "scheduling", "monitoring",
  "rate limiting", "feature flags", "A/B testing", "localization",
  "access control",
];

const noiseFuncs: any[] = [];
for (let i = 0; i < noiseCount; i++) {
  const prefix = NOISE_PREFIXES[i % NOISE_PREFIXES.length];
  const suffix = NOISE_SUFFIXES[Math.floor(i / NOISE_PREFIXES.length) % NOISE_SUFFIXES.length];
  const domain = NOISE_DOMAINS[i % NOISE_DOMAINS.length];
  const name = `${prefix}${suffix}${i}`;

  noiseFuncs.push({
    name,
    params: [
      { name: "input", type: "any" },
      { name: "options", type: "any" },
    ],
    returnType: "any",
    returnTypeDetail: "object",
    file: `src/noise/${domain.replace(/\s/g, "_")}.ts`,
    calls: [],
    exported: true,
    purpose: `${prefix} ${suffix.toLowerCase()} for ${domain}`,
    tags: domain.split(/\s+/).concat(["noise"]),
    inputs: ["any"],
    outputs: ["any"],
    requires: i % 3 === 0 ? ["DATA"] : [],
    produces: i % 2 === 0 ? ["RESULT"] : [],
  });
}

const expandedIR = [...realFuncs, ...noiseFuncs];
const expandedIRJson = { functions: expandedIR, typeMap: irRaw.typeMap || {} };
fs.writeFileSync("ir_large.json", JSON.stringify(expandedIRJson, null, 2));

console.log(`Expanded IR: ${expandedIR.length} functions (${realFuncs.length} real + ${noiseCount} noise)`);
console.log(`Written to ir_large.json`);
