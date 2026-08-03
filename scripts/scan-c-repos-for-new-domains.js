#!/usr/bin/env node
/**
 * Scan 7 C repos for functions matching new P0 protocol detector patterns.
 * Answers: "Can our injected rules actually fire on real C code?"
 */
const fs = require("fs");
const path = require("path");

const REPOS = ["curl", "libssh", "nginx", "redis", "openssl", "apache", "nghttp2"];
const BENCH_DIR = path.resolve(process.cwd(), "benchmarks");

// ── New P0 Detector Patterns (from protocol-detector.ts) ──
const DETECTORS = {
  "Payment Processing": {
    domain: "payment",
    patterns: [
      /\b(\w*payment\w*intent|\w*payment\w*init|\w*pay\w*init|\w*pay\w*create|\w*create\w*payment|\w*create\w*order|\w*stripe\w*create|\w*paypal\w*create|\w*braintree\w*create|\w*checkout\w*create|\w*initiate\w*payment|\w*initiate\w*order)\b/i,
      /\b(\w*payment\w*callback|\w*webhook|\w*payment\w*confirm|\w*handle\w*webhook|\w*verify\w*signature|\w*validate\w*webhook|\w*stripe\w*webhook|\w*paypal\w*ipn|\w*callback\w*handler|\w*payment\w*success)\b/i,
      /\b(\w*payment\w*confirm|\w*capture\w*payment|\w*confirm\w*order|\w*payment\w*done|\w*payment\w*success|\w*order\w*complete|\w*payment\w*succeed)\b/i,
    ],
  },
  "Session Management": {
    domain: "session_mgmt",
    patterns: [
      /\b(\w*session\w*create|\w*create\w*session|\w*session\w*init|\w*session\w*new|\w*session\w*start|\w*login\w*session|\w*init\w*session)\b/i,
      /\b(\w*session\w*check|\w*session\w*valid|\w*validate\w*session|\w*verify\w*session|\w*authenticate\w*session|\w*session\w*auth|\w*check\w*session|\w*get\w*session)\b/i,
      /\b(\w*session\w*destroy|\w*session\w*delete|\w*session\w*revoke|\w*session\w*invalidate|\w*session\w*end|\w*session\w*logout|\w*session\w*signout|\w*session\w*expire|\w*session\w*timeout|\w*destroy\w*session|\w*cleanup\w*session|\w*purge\w*session)\b/i,
    ],
  },
  "User Registration": {
    domain: "registration",
    patterns: [
      /\b(\w*register\w*user|\w*user\w*register|\w*signup|\w*sign\w*up|\w*create\w*account|\w*account\w*create|\w*registration\w*init|\w*registration\w*start)\b/i,
      /\b(\w*send\w*(code|otp|token|verif|sms|email)|\w*(code|otp|token|verif|sms|email)\w*send|\w*verification\w*send|\w*send\w*verif)\b/i,
      /\b(\w*verify\w*(code|otp|token|email)|\w*(code|otp|token)\w*verify|\w*confirm\w*(code|registration|account)|\w*validate\w*(code|token|verif))\b/i,
    ],
  },
  "File Upload": {
    domain: "file_upload",
    patterns: [
      /\b(\w*upload|\w*receive\w*file|\w*handle\w*upload|\w*file\w*upload|\w*multipart|\w*form\w*data|\w*file\w*receive)\b/i,
      /\b(\w*validate\w*file|\w*file\w*valid|\w*check\w*file|\w*file\w*type|\w*mime\w*check|\w*file\w*size|\w*max\w*size|\w*allow\w*ext|\w*file\w*ext)\b/i,
      /\b(\w*file\w*store|\w*store\w*file|\w*file\w*save|\w*save\w*file|\w*upload\w*to|\w*write\w*file|\w*S3\w*upload|\w*cloud\w*upload|\w*file\w*write)\b/i,
    ],
  },
  "Input Validation Chain": {
    domain: "resource",
    patterns: [
      /\b(\w*sanitize|\w*escape|\w*clean|\w*strip\w*tags|\w*html\w*escape|\w*xss\w*clean|\w*filter\w*input|\w*input\w*filter)\b/i,
      /\b(\w*valid\w*type|\w*type\w*check|\w*check\w*type|\w*is_string|\w*is_number|\w*is_int|\w*is_bool|\w*type\w*of|\w*schema\w*valid|\w*valid\w*schema)\b/i,
    ],
  },
  "Rate Limiting": {
    domain: "api_gateway",
    patterns: [
      /\b(\w*rate\w*limit|\w*rate\w*check|\w*throttle|\w*check\w*rate|\w*limit\w*check|\w*quota\w*check|\w*concurrency\w*limit)\b/i,
      /\b(\w*rate\w*exceed|\w*throttl|\w*block|\w*reject|\w*deny\w*rate|\w*circuit\w*break|\w*circuit\w*open)\b/i,
    ],
  },
  "Notification Delivery": {
    domain: "notification",
    patterns: [
      /\b(\w*notif\w*compos|\w*compos\w*notif|\w*build\w*message|\w*create\w*message|\w*message\w*create|\w*notif\w*create|\w*email\w*compos|\w*sms\w*compos)\b/i,
      /\b(\w*send\w*notif|\w*notif\w*send|\w*deliver\w*message|\w*email\w*send|\w*sms\w*send|\w*push\w*send|\w*dispatch\w*notif|\w*notif\w*dispatch)\b/i,
    ],
  },
  "Supplier Lifecycle": {
    domain: "supplier",
    patterns: [
      /\b(\w*supplier\w*regist|\w*regist\w*supplier|\w*vendor\w*regist|\w*partner\w*onboard|\w*onboard\w*partner|\w*supplier\w*create)\b/i,
      /\b(\w*supplier\w*verif|\w*verif\w*supplier|\w*supplier\w*valid|\w*approve\w*supplier|\w*supplier\w*approve|\w*kyc\w*check)\b/i,
    ],
  },
  "TLS Server Setup": {
    domain: "tls",
    patterns: [
      /\b(\w*tls\w*config|\w*ssl\w*config|\w*cert\w*load|\w*load\w*cert|\w*key\w*load|\w*tls\w*setup|\w*tls\w*init|\w*SSL_CTX\w*config)\b/i,
      /\b(\w*create\w*server|\w*server\w*start|\w*listen\b|\w*bind\b|\w*server\w*init|\w*start\w*server|\w*http\w*listen)\b/i,
    ],
  },
  "Data Integrity Check": {
    domain: "data_integrity",
    patterns: [
      /\b(\w*check\w*exist|\w*exist\w*check|\w*lookup|\w*find\w*by\w*id|\w*get\w*entity|\w*valid\w*refer|\w*refer\w*valid)\b/i,
      /\b(\w*create\w*refer|\w*refer\w*create|\w*link\w*entity|\w*assoc\w*entity|\w*set\w*foreign|\w*foreign\w*key)\b/i,
    ],
  },
  "Dev Pipeline": {
    domain: "dev_pipeline",
    patterns: [
      /\b(\w*extract\w*ir|\w*ir\w*extract|\w*parse\w*source|\w*analyze\w*code|\w*ast\w*parse|\w*build\w*ast|\w*compile\w*ir)\b/i,
      /\b(\w*valid\w*action|\w*action\w*valid|\w*check\w*rule|\w*rule\w*check|\w*lint|\w*verify\w*rule|\w*enforce\w*rule)\b/i,
    ],
  },
};

// ── Extract all function names from C repo sequence files ──
function extractFunctions(repo) {
  const seqFile = path.join(BENCH_DIR, `${repo}-sequences.json`);
  if (!fs.existsSync(seqFile)) return [];
  const data = JSON.parse(fs.readFileSync(seqFile, "utf-8"));
  const sequences = data.sequences || data;
  const fns = new Set();
  for (const seq of sequences) {
    if (seq.function) fns.add(seq.function);
    if (seq.calls) for (const c of seq.calls) fns.add(c);
  }
  return [...fns];
}

// ── Match functions against detector patterns ──
function matchDetectors(functions) {
  const results = {};
  for (const [name, detector] of Object.entries(DETECTORS)) {
    const matches = [];
    for (const fn of functions) {
      for (const pat of detector.patterns) {
        if (pat.test(fn)) { matches.push(fn); break; }
      }
    }
    if (matches.length > 0) {
      results[name] = { domain: detector.domain, count: matches.length, examples: matches.slice(0, 8) };
    }
  }
  return results;
}

// ── Main ──
console.log("\n═══ C Repo Function Scan: New P0 Domain Triggers ═══\n");
console.log("Question: Can injected protocol detectors fire on real C code?\n");

let totalReposWithHits = 0;
let totalDomainsTriggered = new Set();

for (const repo of REPOS) {
  const fns = extractFunctions(repo);
  const matches = matchDetectors(fns);
  const domainCount = Object.keys(matches).length;

  if (domainCount > 0) {
    totalReposWithHits++;
    console.log(`┌─ ${repo} (${fns.length} functions) — ${domainCount} domains triggered`);
    for (const [detName, m] of Object.entries(matches)) {
      totalDomainsTriggered.add(m.domain);
      console.log(`│  🟢 ${detName} (${m.domain}): ${m.count} fn matched`);
      console.log(`│     ${m.examples.slice(0, 5).join(", ")}`);
    }
    console.log(`└─`);
  } else {
    console.log(`┌─ ${repo} (${fns.length} functions) — 0 new domains triggered`);
    console.log(`└─`);
  }
}

console.log(`\n─── Summary ───`);
console.log(`  Repos with new-domain matches: ${totalReposWithHits}/${REPOS.length}`);
console.log(`  Unique domains triggered: ${totalDomainsTriggered.size}/${Object.keys(DETECTORS).length}`);
console.log(`  Domains triggered: ${[...totalDomainsTriggered].sort().join(", ")}`);

// Now show which domains have ZERO matches across all repos
const allFns = new Set();
for (const repo of REPOS) for (const fn of extractFunctions(repo)) allFns.add(fn);
const allMatches = matchDetectors([...allFns]);
const triggeredDomains = new Set(Object.values(allMatches).map(m => m.domain));
const allDomains = [...new Set(Object.values(DETECTORS).map(d => d.domain))];

console.log(`\n─── Domain Coverage in C Repos ───`);
for (const dom of allDomains.sort()) {
  const triggered = triggeredDomains.has(dom);
  console.log(`  ${triggered ? "🟢" : "🔴"} ${dom}: ${triggered ? "HAS real C code triggers" : "NO real C code triggers in any repo"}`);
}

// Fallback: check safeguard rule triggers too
const SAFEGUARD_TRIGGERS = {
  "Payment Webhook": /\b(\w*webhook|\w*payment\w*callback|\w*stripe\w*webhook|\w*paypal\w*ipn|\w*ipn\w*handler|\w*payment\w*notify)\b/i,
  "Payment Refund": /\b(refund|void|reverse|cancel\w*payment|\w*refund|\w*void\w*payment)\b/i,
  "Session No Timeout": /\b(\w*session\w*create|\w*create\w*session|\w*session\w*new|\w*session\w*start|\w*login\w*session|\w*session\w*init)\b/i,
  "No Token Rotation": /\b(\w*password\w*change|\w*password\w*reset|\w*change\w*password|\w*reset\w*password|\w*update\w*password)\b/i,
  "Reg Without Verify": /\b(register|signup|signUp|registerUser|createUser|createAccount)\b/i,
  "Upload Without Validate": /\b(upload|receive\w*file|handle\w*upload|file\w*upload|multipart|form\w*data)\b/i,
  "No Input Sanitize": /\b(render|display|write|output|append|insert|innerHTML|dangerouslySetInnerHTML|document\.write|echo|printf|sprintf)\b/i,
  "API No Rate Limit": /\b(createServer|listen|handleRequest|router|endpoint|api\w*handler|request\w*handler|handle\w*request)\b/i,
  "Notif No Retry": /\b(send\w*email|send\w*sms|send\w*push|send\w*notif|dispatch|deliver\w*message|post\w*message)\b/i,
  "TLS Cert No Renew": /\b(load\w*cert|load\w*ssl|ssl\w*config|tls\w*config|cert\w*load|ssl\w*ctx|certificate\w*load)\b/i,
  "Mutation No Audit": /\b(update|delete|modify|change|mutate|set\w*field|edit|remove|drop)\b/i,
};

console.log(`\n─── Safeguard Rule Trigger Coverage ───`);
for (const [name, pattern] of Object.entries(SAFEGUARD_TRIGGERS)) {
  const hits = [...allFns].filter(fn => pattern.test(fn));
  if (hits.length > 0) {
    console.log(`  🟢 ${name}: ${hits.length} fn — ${hits.slice(0, 4).join(", ")}`);
  } else {
    console.log(`  🔴 ${name}: 0 fn in any C repo`);
  }
}
console.log();
