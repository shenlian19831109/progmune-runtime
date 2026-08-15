/**
 * Blind Benchmark Gold Expansion — Python (v1)
 *
 * Produces gold/annotations-python-v1.json for the snake_case Python style-variant
 * projects (generated-py/). Gold derivation mirrors expand-gold-v6.ts: generator
 * plant configuration (hashing / token / noAuthFns) + template review (ownership,
 * validation, TLS, rate limiting). Matching is strict-localization at rule-name
 * level; FP classification checks the code for contradictions.
 *
 * Usage: npx ts-node blind-benchmark/expand-gold-python.ts
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { TYPES } from "./generate-projects";

const REPORT_PATH = path.resolve(__dirname, "reports", "batch-scan-python-results.json");
const OUT_PATH = path.resolve(__dirname, "gold", "annotations-python-v1.json");
const GEN_DIR = path.resolve(__dirname, "generated-py");

// ═══════════════════════════════════════════════════════════
// Per-style Python naming (mirrors PY_STYLES in generate-projects-python.ts)
// ═══════════════════════════════════════════════════════════

interface PyStyleDef {
  id: string;
  authFn: string; register: string; login: string;
  hashingDesc: string;
  tokenDesc: string;
  noAuthFns: string[];
  listPrefix: string;   // "list" | "get_all"
  deleteVerb: string;   // "delete" | "remove"
}

const PY_STYLE_DEFS: PyStyleDef[] = [
  { id: "A", authFn: "get_user", register: "register", login: "login",
    hashingDesc: "Password stored as plaintext. No hashing.",
    tokenDesc: 'Token generated as "tok_" + random.random() — not cryptographically secure, predictable source.',
    noAuthFns: ["list_events", "get_metric"], listPrefix: "list", deleteVerb: "delete" },
  { id: "B", authFn: "validate_session", register: "create_account", login: "authenticate",
    hashingDesc: "Password hashed with SHA256 — a fast hash unsuitable for password storage.",
    tokenDesc: 'Token generated as "s_" + time.time() — predictable and forgeable.',
    noAuthFns: ["list_templates", "get_campaign"], listPrefix: "list", deleteVerb: "delete" },
  { id: "C", authFn: "verify_token", register: "signup", login: "signin",
    hashingDesc: "Password stored as plaintext. No hashing.",
    tokenDesc: 'Token generated as "sess_" + increment — trivially predictable and forgeable.',
    noAuthFns: ["get_all_items", "get_supplier", "list_channels", "get_alert"], listPrefix: "get_all", deleteVerb: "remove" },
  { id: "D", authFn: "get_current_user", register: "register_new_user", login: "do_login",
    hashingDesc: "Password hashed with MD5 — cryptographically broken.",
    tokenDesc: 'Token generated as "jwt_" + random.random() — not an actual JWT, predictable and forgeable.',
    noAuthFns: ["list_workflows", "get_step", "find_repos", "get_branch"], listPrefix: "list", deleteVerb: "delete" },
];

interface GoldFinding {
  id: string;
  file: string;
  function: string;
  category: string;
  severity: string;
  protocol: string;
  description: string;
  fix_suggestion?: string;
  progmune_detected: boolean;
  progmune_verdict: string;
  false_positive: boolean;
}

function listName(e: string, s: PyStyleDef): string {
  const plural = e.toLowerCase() + "s";
  return s.listPrefix === "get_all" ? `get_all_${plural}` : `list_${plural}`;
}

function generateGold(projId: string): { findings: GoldFinding[] } {
  const [typeId, styleId] = projId.split("_");
  const t = TYPES.find(x => x.id === typeId)!;
  const s = PY_STYLE_DEFS.find(x => x.id === styleId)!;
  const entities = t.entities.slice(0, 2);

  const findings: GoldFinding[] = [];
  let n = 0;
  const add = (f: Omit<GoldFinding, "id" | "progmune_detected" | "progmune_verdict" | "false_positive">) => {
    n++;
    findings.push({ ...f, id: `${projId.toUpperCase()}-${String(n).padStart(3, "0")}`,
      progmune_detected: false, progmune_verdict: "NOT_CHECKED", false_positive: false });
  };

  add({ file: "auth.py", function: s.register, category: "protocol_violation", severity: "medium",
    protocol: "Auth", description: s.hashingDesc, fix_suggestion: "Hash passwords with bcrypt/argon2" });
  add({ file: "auth.py", function: s.login, category: "protocol_violation", severity: "medium",
    protocol: "Auth", description: s.tokenDesc, fix_suggestion: "Use secrets.token_hex() or a real signed JWT" });

  const plantedNoAuth = s.noAuthFns.filter(fn =>
    entities.some(e => listName(e, s) === fn || `get_${e.toLowerCase()}` === fn));
  for (const fn of plantedNoAuth) {
    const e = entities.find(x => listName(x, s) === fn || `get_${x.toLowerCase()}` === fn)!;
    add({ file: `${e.toLowerCase()}.py`, function: fn, category: "auth_bypass", severity: "high",
      protocol: "Auth",
      description: `${fn}() has NO authentication check — returns data to unauthenticated callers. Planted by generator (noAuthFns).`,
      fix_suggestion: "Add token verification" });
  }

  for (const e of entities) {
    const lower = e.toLowerCase();
    add({ file: `${lower}.py`, function: `${s.deleteVerb}_${lower}`, category: "auth_bypass", severity: "medium",
      protocol: "Auth",
      description: `${s.deleteVerb}_${lower} verifies the caller's token but not that the item belongs to the caller (owner_id). Any authenticated user can delete others' data.`,
      fix_suggestion: "Check item[\"owner_id\"] == user[\"id\"] before delete" });
    add({ file: `${lower}.py`, function: `create_${lower}`, category: "protocol_violation", severity: "low",
      protocol: "Resource",
      description: `No input validation on title/body in create_${lower}.`,
      fix_suggestion: "Add content validation (length/format)" });
  }

  add({ file: "server.py", function: "handle_request", category: "resource_leak", severity: "low",
    protocol: "TLS",
    description: "No TLS configuration — API entry point serves plain HTTP routing without HTTPS enforcement.",
    fix_suggestion: "Serve over HTTPS with TLS certificates" });
  add({ file: "server.py", function: "handle_request", category: "resource_leak", severity: "low",
    protocol: "Resource",
    description: "No rate limiting on any endpoint — brute force and abuse possible.",
    fix_suggestion: "Add rate limiting middleware" });

  return { findings };
}

// ═══════════════════════════════════════════════════════════
// Matching (identical semantics to expand-gold-v6.ts)
// ═══════════════════════════════════════════════════════════

function rulePredicates(f: Pick<GoldFinding, "category" | "description">): Array<(rule: string) => boolean> {
  const d = f.description;
  if (/plaintext|SHA256|MD5|hashing/i.test(d)) return [r => r.startsWith("Password Hashing")];
  if (/Token generated/i.test(d)) return [r => r.startsWith("Token Security")];
  if (/belongs to|owner|ownership|owner_id/i.test(d)) return [r => r === "Authorization (Ownership Check)" || r === "Authorization (Resource Ownership)"];
  if (f.category === "auth_bypass" || /no authentication|authentication check/i.test(d))
    return [r => r === "Authorization (Unauthenticated Access)" || r === "Authorization (Ownership Check)" || r === "Authorization (Unauthenticated Mutation)"];
  if (/TLS/i.test(d)) return [r => r === "TLS Enforcement"];
  if (/rate limit/i.test(d)) return [r => r === "Rate Limiting" || r === "API Without Rate Limiting"];
  if (/validation/i.test(d)) return [r => r === "Input Validation"];
  return [r => r.startsWith("Authorization")];
}

function matchFinding(proj: any, f: GoldFinding): boolean {
  const own = proj.perFunction.find((x: any) =>
    x.name === f.function && path.basename(x.file) === f.file);
  if (own) {
    const rules = own.safeguardViolations.map((v: any) => v.rule as string);
    if (rules.some((rule: string) => rulePredicates(f).some(p => p(rule)))) return true;
    return false;
  }
  const hr = proj.perFunction.find((x: any) => x.name === "handle_request");
  if (hr) {
    const rules = hr.safeguardViolations.map((v: any) => v.rule as string);
    return rules.some((rule: string) => rulePredicates(f).some(p => p(rule)));
  }
  return false;
}

function verdictOf(f: GoldFinding): string {
  if (!f.progmune_detected) return "NOT_CHECKED";
  return f.severity === "critical" ? "BLOCK" : "WARN";
}

/** Python function body extraction: def name(...) up to the next top-level def/class. */
function readPyBody(filePath: string, name: string): string {
  let src = "";
  try { src = fs.readFileSync(filePath, "utf-8"); } catch { return ""; }
  const m = src.match(new RegExp(`def\\s+${name}\\s*\\([\\s\\S]*?(?=\\n(def |class )|\\Z)`));
  return m ? m[0] : "";
}

function factualFPs(proj: any, projectId: string): number {
  const projDir = path.join(GEN_DIR, projectId);
  let fps = 0;

  const fixationFlagged = proj.perFunction.filter((f: any) =>
    f.safeguardViolations.some((v: any) => v.category === "session_fixation"));
  const logoutFns = proj.perFunction.filter((f: any) => /logout|signout|sign_out|log_out|invalidate/i.test(f.name));
  const invalidates = logoutFns.some((f: any) => {
    const body = readPyBody(path.join(projDir, path.basename(f.file)), f.name);
    return /\.pop\(|\.clear\(\)|\.remove\(|\.destroy\(|invalidate/i.test(body);
  });
  if (invalidates) fps += fixationFlagged.length;

  for (const f of proj.perFunction) {
    const hasOwnership = f.safeguardViolations.some((v: any) => v.rule === "Authorization (Ownership Check)");
    if (!hasOwnership) continue;
    const body = readPyBody(path.join(projDir, path.basename(f.file)), f.name);
    if (/owner_id\s*[!=]==?|author_id\s*[!=]==?/i.test(body)) fps++;
  }
  return fps;
}

// ═══════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════

function main() {
  const scan = JSON.parse(fs.readFileSync(REPORT_PATH, "utf-8"));

  let detectorCommit = "";
  try { detectorCommit = execSync("git rev-parse HEAD", { cwd: path.resolve(__dirname, "..") }).toString().trim(); } catch {}

  const out: any = {
    $description: "Progmune blind-benchmark gold annotations — Python style-variants v1. " +
      "Gold from generator plant configuration + template review (same flaw structure as the TypeScript benchmark).",
    annotated_by: "plant-config + template review (Python transliteration)",
    annotated_at: "2026-08-15",
    version: "1.0",
    detector_scan_generated: scan.generated,
    detector_commit: detectorCommit,
    projects: [] as any[],
    aggregate: {},
  };

  let fpsTotal = 0;
  const projects = [];
  for (const p of scan.projects) {
    const { findings } = generateGold(p.project);
    for (const f of findings) {
      f.progmune_detected = matchFinding(p, f);
      f.progmune_verdict = verdictOf(f);
    }
    const fps = factualFPs(p, p.project);
    fpsTotal += fps;
    const detected = findings.filter(f => f.progmune_detected).length;
    const missed = findings.filter(f => !f.progmune_detected);
    projects.push({
      project_id: p.project,
      model: "generator",
      project_type: TYPES.find(t => t.id === p.project.split("_")[0])?.name || "",
      files: p.perFunction.length ? [...new Set(p.perFunction.map((f: any) => path.basename(f.file)))] : [],
      total_findings: findings.length,
      findings,
      progmune_summary: {
        total_findings: findings.length,
        detected,
        missed: missed.length,
        detection_rate: findings.length ? Math.round((detected / findings.length) * 1000) / 10 : 0,
        false_positives: fps,
        missed_findings: missed.map(f => `${f.id}: ${f.description.slice(0, 60)}`),
      },
    });
  }
  out.projects = projects;

  const all = projects.flatMap(p => p.findings);
  const detected = all.filter(f => f.progmune_detected).length;
  const precision = detected + fpsTotal > 0 ? Math.round((detected / (detected + fpsTotal)) * 1000) / 10 : 0;
  out.aggregate = {
    projects_annotated: projects.length,
    total_findings: all.length,
    progmune_detected: detected,
    progmune_missed: all.length - detected,
    overall_recall: Math.round((detected / all.length) * 1000) / 10,
    overall_precision: precision,
    false_positives_total: fpsTotal,
    note: "Python pilot — same planted-flaw structure as the TypeScript benchmark (90 style-variant projects). " +
      "Strict-localization matching at rule-name level; FP = detections contradicted by the code.",
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  console.log(`✅ ${OUT_PATH}`);
  console.log(`   ${projects.length} python projects | ${all.length} gold findings | detected ${detected}`);
  console.log(`   recall ${out.aggregate.overall_recall}% | precision ${precision}% | FPs ${fpsTotal}`);
}

main();
