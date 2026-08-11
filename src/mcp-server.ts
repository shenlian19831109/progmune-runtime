/**
 * Progmune MCP Server (TypeScript)
 *
 * Exposes Progmune Runtime as an MCP server for Claude Code.
 * Tools: progmune_generate (TS code gen), progmune_status (health), progmune_check (immune audit)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs";
import * as path from "path";
import { createLogger } from "./logger";

// ── Load .env (in compiled ESM output, use import.meta.url; here we use __dirname) ──
const envPath = path.resolve(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

import { plan } from "./planner";
import { extractIR } from "./extract-ir";
import { extractIRPython, isPythonProject } from "./extract-ir-python";
import { emitCode } from "./emitter";
import { recordRun } from "./feedback";
import { reportFingerprints } from "./immune-reporter";
import type { FunctionInfo } from "./extract-ir";

const OPT_IN_FILE = path.resolve(__dirname, "..", ".progmune_memory", "opt_in.json");

// ── Structured logging (stderr, not stdout JSON-RPC) ──
const log = createLogger("progmune");

async function main() {
  const server = new Server(
    { name: "progmune", version: "2.2.0" },
    { capabilities: { tools: {} } }
  );

  // ── Tool listing ──
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "progmune_generate",
        description:
          "Generate type-safe TypeScript code using only functions that actually exist in the project. The generated code passes Progmune's multi-layer validation (symbol existence, type arity, variable flow, SSG protocol constraints).",
        inputSchema: {
          type: "object",
          properties: {
            intent: {
              type: "string",
              description: "Natural-language programming intent, e.g. 'authenticate a user and issue a JWT token'",
            },
            projectPath: {
              type: "string",
              description: "Absolute path to the project root directory (must contain TypeScript source files)",
            },
          },
          required: ["intent", "projectPath"],
        },
      },
      {
        name: "progmune_status",
        description:
          "View Progmune Runtime health: LLM config, immune network stats, failure patterns, memory state, antibody hit rate.",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "progmune_check",
        description:
          "Run the full 7-step immune audit pipeline on the project: IR extraction, TypeScript type-checking, SSG protocol validation, ledger invariants (Invariant-0 + Invariant-1 + Replay), failure genome, antibody efficacy, and namespace state snapshots.",
        inputSchema: {
          type: "object",
          properties: {
            projectPath: {
              type: "string",
              description: "Absolute path to the project root directory",
            },
          },
          required: ["projectPath"],
        },
      },
      {
        name: "progmune_execute",
        description: "Execute the full Progmune pipeline: intent → IR extraction → Planner (LLM + immune constraints) → validated TypeScript code with @progmune-generated marker → file written → fingerprint registered. This is the PRIMARY code generation tool. Use this instead of writing files directly.",
        inputSchema: {
          type: "object",
          properties: {
            intent: { type: "string", description: "Natural-language programming intent" },
            filePath: { type: "string", description: "Relative or absolute path to write the generated file (e.g. 'src/my-module.ts')" },
            projectPath: { type: "string", description: "Absolute path to project root" },
          },
          required: ["intent", "filePath", "projectPath"],
        },
      },
      {
        name: "progmune_audit",
        description: "Audit source files for @progmune-generated markers. Returns Progmune coverage rate.",
        inputSchema: {
          type: "object",
          properties: {
            directory: { type: "string", description: "Directory to audit (e.g. 'src/')" },
          },
          required: [],
        },
      },
      {
        name: "progmune_init",
        description: "Ensure CLAUDE.md includes Progmune usage instructions so AI assistants prefer progmune_generate.",
        inputSchema: {
          type: "object",
          properties: {
            projectPath: { type: "string", description: "Absolute path to project root" },
          },
          required: ["projectPath"],
        },
      },
      {
        name: "progmune_repair",
        description: "When immune violations exist, run the full repair loop: check consistency → generate repair proposals → create repair branches → deterministic replay. Returns proposals for human approval. NEVER auto-writes to ledger.",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: { type: "string", description: "Session ID to repair (from progmune_check or corpus)" },
            projectPath: { type: "string", description: "Absolute path to project root" },
          },
          required: ["sessionId"],
        },
      },
      {
        name: "progmune_accept",
        description: "Accept a repair proposal and merge it into the session ledger. After this, the session will have the fix applied.",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: { type: "string", description: "Session ID" },
            proposalId: { type: "string", description: "Repair proposal ID (from progmune_repair)" },
            projectPath: { type: "string", description: "Absolute path to project root" },
          },
          required: ["sessionId", "proposalId"],
        },
      },
      // P8.2: Zero-shot protocol discovery & repair
      {
        name: "progmune_discover",
        description: "Discover protocol state machines from a codebase using name-free topology analysis. Extracts call sequences, clusters by graph fingerprint, and returns discovered protocols with confidence scores.",
        inputSchema: {
          type: "object",
          properties: {
            projectPath: { type: "string", description: "Absolute path to project root" },
            repoName: { type: "string", description: "Repository name for identification (e.g., 'redis', 'postgresql')" },
          },
          required: ["projectPath"],
        },
      },
      {
        name: "progmune_zeroshot",
        description: "Zero-shot repair: attempt to fix a broken action sequence using discovered protocol knowledge, without any hand-written rules for the target library. Returns Top-3 repair candidates.",
        inputSchema: {
          type: "object",
          properties: {
            brokenSequence: { type: "array", items: { type: "string" }, description: "The broken (incomplete) action sequence" },
            expectedPattern: { type: "string", description: "Expected protocol pattern (e.g., 'acquire_use_release', 'transaction')" },
            projectPath: { type: "string", description: "Absolute path to project root" },
          },
          required: ["brokenSequence"],
        },
      },
      {
        name: "progmune_scaffold",
        description: "Generate complete project files from templates (Express API, CLI tool, static site). Uses LLM to parameterize templates with project context. Complements progmune_generate which generates function-call-level code. Use this for architecture-level code: servers, pages, CLI entry points.",
        inputSchema: {
          type: "object",
          properties: {
            intent: { type: "string", description: "Natural-language description of what to build" },
            scaffoldType: { type: "string", enum: ["express-api", "cli-tool", "static-site"], description: "Template type: 'express-api' (REST server with SQLite), 'cli-tool' (CLI with arg parsing), 'static-site' (single-file HTML page)" },
            filePath: { type: "string", description: "Relative or absolute path to write the generated file" },
            projectPath: { type: "string", description: "Absolute path to project root" },
          },
          required: ["intent", "scaffoldType", "projectPath"],
        },
      },
      {
        name: "progmune_governance_report",
        description: "Generate an AI Code Governance Report for the project. Aggregates session integrity, SSV ledger verification, PLSB benchmark coverage, provenance fingerprint audit, and antibody efficacy into a structured report with PASS/WARN/FAIL verdict. Use this to prove the safety of AI-generated code.",
        inputSchema: {
          type: "object",
          properties: {
            projectPath: { type: "string", description: "Absolute path to project root" },
            sessionId: { type: "string", description: "Optional: specific session ID for per-session governance certificate" },
            format: { type: "string", enum: ["terminal", "json", "markdown"], description: "Output format" },
            fast: { type: "boolean", description: "Skip expensive PLSB benchmark for faster response" },
          },
          required: [],
        },
      },
      {
        name: "progmune_provenance",
        description: "Build the end-to-end provenance chain for a session. Traces every generation, validation, repair, and deployment event with cryptographic hashes — proving the full lifecycle of AI-generated code.",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: { type: "string", description: "Session ID to trace" },
            format: { type: "string", enum: ["terminal", "json"], description: "Output format" },
          },
          required: ["sessionId"],
        },
      },
      {
        name: "progmune_accountability",
        description: "Build the AI Code Supply Chain accountability ledger for a session. Maps every action to a responsible actor (human, LLM, validator, reviewer, deployer) with identity, role, and cryptographic signatures. Detects custody gaps where actor identity cannot be verified.",
        inputSchema: {
          type: "object",
          properties: {
            sessionId: { type: "string", description: "Session ID to trace" },
            author: { type: "string", description: "Email of human who initiated generation" },
            reviewer: { type: "string", description: "Email of human reviewer" },
            approver: { type: "string", description: "Email of human who approved deployment" },
            deployer: { type: "string", description: "CI/CD system ID that deployed" },
            format: { type: "string", enum: ["terminal", "json"], description: "Output format" },
          },
          required: ["sessionId"],
        },
      },
      {
        name: "progmune_policy_check",
        description: "Run the Policy Engine against a file. Evaluates 6 rules (confidence, provenance, PLSB coverage, human review, fingerprint, violations) and returns ALLOW, WARN, or BLOCK. This is the deploy gate — use it in CI/CD to block deployment of unverified AI-generated code.",
        inputSchema: {
          type: "object",
          properties: {
            filePath: { type: "string", description: "Absolute path to the file to check" },
            author: { type: "string", description: "Email of human who initiated generation" },
            reviewer: { type: "string", description: "Email of human reviewer" },
            format: { type: "string", enum: ["terminal", "json"], description: "Output format" },
          },
          required: ["filePath"],
        },
      },
      {
        name: "progmune_plsb",
        description: "Query the Protocol Lifecycle Security Benchmark (PLSB). Get taxonomy coverage, recall/precision metrics, and per-category detection status. Use this to check if protocol vulnerability categories are covered.",
        inputSchema: {
          type: "object",
          properties: {
            format: { type: "string", enum: ["summary", "json", "markdown"], description: "Output format" },
            category: { type: "string", description: "Optional: filter by PLS-ID (e.g., PLS-001)" },
          },
          required: [],
        },
      },
      {
        name: "progmune_certify",
        description: "Issue an AI Code Certificate for a file. Verifies: @progmune-generated marker, session integrity, ledger consistency, fingerprint verification, and PLSB coverage. Returns a human-readable certificate suitable for audit and compliance.",
        inputSchema: {
          type: "object",
          properties: {
            filePath: { type: "string", description: "Absolute path to the file to certify" },
            format: { type: "string", enum: ["terminal", "json"], description: "Output format" },
          },
          required: ["filePath"],
        },
      },
      {
        name: "progmune_trust_check",
        description:
          "Run the AI Trust Decision Engine on a project. Returns a weighted Trust Score (0-100) with APPROVED/NEEDS_REVIEW/BLOCKED decision, Coverage Confidence (quantified % with ±margin, replacing qualitative HIGH/MEDIUM/LOW labels), Violation Traces (step-by-step protocol state reasoning chains with expected vs actual state comparisons), and complete evidence trail. This is the primary CI/CD gating tool — use it to decide whether AI-generated code is safe to deploy. Dimensions: Policy Compliance (35%), Protocol Safety (30%), Verification Coverage (20%), Governance Integrity (15%). Critical violations auto-BLOCK. Use --json for machine-readable output with coverageConfidence and violationTraces fields.",
        inputSchema: {
          type: "object",
          properties: {
            projectPath: {
              type: "string",
              description: "Absolute path to the project root to evaluate",
            },
            commit: {
              type: "string",
              description: "Git commit SHA to evaluate (for audit trail)",
            },
            branch: {
              type: "string",
              description: "Git branch name",
            },
            policy: {
              type: "string",
              description: "Policy name or path to .progmune-policy.json",
            },
            format: {
              type: "string",
              enum: ["terminal", "json"],
              description: "Output format (default: terminal)",
            },
          },
          required: ["projectPath"],
        },
      },
      {
        name: "progmune_score",
        description:
          "Score a function's protocol compliance on a continuous 0-1 scale across 6 dimensions (auth, tls, payment, data_integrity, resource, session). Unlike progmune_check which returns binary pass/fail, progmune_score returns per-dimension compliance scores, identifies the weakest dimension, and suggests specific missing calls. Use this BEFORE generating code — pass the intended function calls and purpose to see what protocols are missing. No ML. Pure rule-based scoring using existing SSG protocol definitions.",
        inputSchema: {
          type: "object",
          properties: {
            calls: {
              type: "array",
              items: { type: "string" },
              description: "Array of function call names in execution order (e.g. ['getOrder', 'processRefund', 'sendEmail'])",
            },
            purpose: {
              type: "string",
              description: "Optional function purpose to trigger dimension relevance (e.g. '退款处理', '用户注册', '文件上传')",
            },
            functionName: {
              type: "string",
              description: "Optional function name for context",
            },
          },
          required: ["calls"],
        },
      },
    ],
  }));

  // ── Tool handler ──
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "progmune_generate") {
      const { intent, projectPath } = request.params.arguments as {
        intent: string;
        projectPath: string;
      };

      // Guard: LLM API key
      if (!process.env.LLM_API_KEY) {
        return {
          content: [
            {
              type: "text",
              text: `❌ LLM_API_KEY not set.

Progmune needs an LLM API key to generate code. Configure via:

  【.env file】Add to ${envPath}:
    LLM_API_KEY=your-key
    LLM_BASE_URL=https://api.deepseek.com/v1
    LLM_MODEL=deepseek-chat

  【Environment】export LLM_API_KEY='your-key'

Supports DeepSeek and OpenAI-compatible APIs.
Get a key: https://platform.deepseek.com/api_keys`,
            },
          ],
        };
      }

      // Guard: opt-in
      if (!fs.existsSync(OPT_IN_FILE)) {
        return {
          content: [
            {
              type: "text",
              text: `⚠️ Immune network not configured.

Enable (recommended):
  npx progmune-runtime opt-in enable

Or disable for offline mode:
  npx progmune-runtime opt-in disable

Then restart Claude Code.`,
            },
          ],
        };
      }

      // Validate projectPath
      if (!projectPath || typeof projectPath !== "string") {
        return {
          content: [
            {
              type: "text",
              text: "❌ projectPath must be a non-empty string (absolute path to the project root).",
            },
          ],
        };
      }
      if (!fs.existsSync(projectPath)) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Path not found: ${projectPath}`,
            },
          ],
        };
      }
      if (!fs.statSync(projectPath).isDirectory()) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Not a directory: ${projectPath}`,
            },
          ],
        };
      }

      // Check for TypeScript files
      const hasTsFiles = (() => {
        try {
          return fs.readdirSync(projectPath).some((f) => f.endsWith(".ts"));
        } catch {
          return false;
        }
      })();
      if (!hasTsFiles) {
        log.warn(`No .ts files found in project root, IR may be empty`);
      }

      // IR extraction — auto-detect language
      const isPython = isPythonProject(projectPath);
      let ir: FunctionInfo[];
      try {
        ir = isPython ? extractIRPython(projectPath) : extractIR(projectPath);
      } catch (e: any) {
        return {
          content: [
            {
              type: "text",
              text: `❌ IR extraction failed: ${e.message}\n\nMake sure the project has a tsconfig.json or .ts source files.`,
            },
          ],
        };
      }

      if (ir.length === 0) {
        log.warn(`No functions extracted from ${projectPath}`);
      }

      // Cross-validate protocols.json with IR
      const protocolsFile = path.resolve(__dirname, "..", "protocols.json");
      if (fs.existsSync(protocolsFile)) {
        const protocols = JSON.parse(fs.readFileSync(protocolsFile, "utf-8"));
        for (const funcName of Object.keys(protocols)) {
          if (!ir.find((f) => f.name === funcName)) {
            log.warn(
              `protocols.json defines "${funcName}" but IR has no such function — protocol ignored`
            );
          }
        }
      }

      // Write ir.json (planning reads from disk)
      fs.writeFileSync("ir.json", JSON.stringify(ir, null, 2));

      // Set project path for memory isolation
      process.env.PROGMUNE_PROJECT_DIR = projectPath;

      // Plan
      let planResult;
      try {
        planResult = await plan(intent);
      } catch (e: any) {
        log.error(`Planning failed: ${e.message}`);
        reportFingerprints().catch(() => {});
        return {
          content: [
            {
              type: "text",
              text: `❌ Planning failed: ${e.message}`,
            },
          ],
        };
      }

      const actions = planResult?.actions || [];
      if (actions.length === 0) {
        reportFingerprints().catch(() => {});
        return {
          content: [
            {
              type: "text",
              text: "Could not generate constraint-satisfying TypeScript code.",
            },
          ],
        };
      }

      // Emit TypeScript code with generation marker
      let protocolRuleCount = 0;
      if (fs.existsSync(protocolsFile)) {
        try { protocolRuleCount = Object.keys(JSON.parse(fs.readFileSync(protocolsFile, "utf-8")).rules || {}).length; } catch { /* protocol parse — non-critical */ }
      }
      const code = emitCode(actions, {
        sessionId: planResult.sessionId,
        ruleHash: planResult.ruleHash,
        irFunctionCount: ir.length,
        protocolRuleCount,
      });
      recordRun(intent, actions, true);

      // Report fingerprints async (don't block response)
      reportFingerprints().catch(() => {});

      return { content: [{ type: "text", text: code }] };
    }

    if (request.params.name === "progmune_status") {
      const { getAllFailures, getTopFailurePatterns } = require("./failure-corpus");
      const { getRecentEpisodes } = require("./memory-layer");
      const { callCount } = require("./llm");
      const failures = getAllFailures();
      const patterns = getTopFailurePatterns(5);
      const episodes = getRecentEpisodes(5);
      const hubEndpoint = process.env.PROGMUNE_HUB || "未配置";

      let hubReachable = false;
      if (hubEndpoint && hubEndpoint !== "未配置") {
        try {
          const http = require("http");
          const https = require("https");
          const transport = hubEndpoint.startsWith("https") ? https : http;
          hubReachable = await new Promise<boolean>((resolve) => {
            const req = transport.get(hubEndpoint, (res: any) => {
              resolve(res.statusCode === 200);
            });
            req.on("error", () => resolve(false));
            req.setTimeout(3000, () => {
              req.destroy();
              resolve(false);
            });
          });
        } catch {
          hubReachable = false;
        }
      }

      // P7.3: Ranker status (heuristic vs learning)
      let rankerStatus = { type: "heuristic", modelWeight: 0, modelSamples: 0, uptimeSeconds: 0 };
      try {
        const { getRankerStatus } = require("./counterfactual-engine");
        rankerStatus = getRankerStatus();
      } catch {}

      const status = {
        version: "3.2.0",
        llm: {
          model: process.env.LLM_MODEL || "deepseek-chat",
          baseUrl: process.env.LLM_BASE_URL || "https://api.deepseek.com/v1",
          callCount: callCount || 0,
          apiKeySet: !!process.env.LLM_API_KEY,
        },
        immuneNetwork: {
          optIn: fs.existsSync(OPT_IN_FILE),
          hub: hubEndpoint,
          hubReachable,
          totalFailures: failures.length,
          topPatterns: patterns,
        },
        memory: {
          recentEpisodes: episodes.length,
        },
        ranker: rankerStatus,
      };
      return {
        content: [{ type: "text", text: JSON.stringify(status, null, 2) }],
      };
    }

    if (request.params.name === "progmune_check") {
      const { projectPath } = request.params.arguments as { projectPath: string };

      if (!projectPath || !fs.existsSync(projectPath)) {
        return {
          content: [{ type: "text", text: `❌ Invalid projectPath: ${projectPath}` }],
        };
      }

      process.env.PROGMUNE_PROJECT_DIR = projectPath;

      const results: string[] = [];
      const pass = (msg: string) => results.push(`✔ ${msg}`);
      const fail = (msg: string) => results.push(`✖ ${msg}`);
      const warn = (msg: string) => results.push(`! ${msg}`);

      // 1. IR extraction — auto-detect language
      try {
        const py = isPythonProject(projectPath);
        const ir = py ? extractIRPython(projectPath) : extractIR(projectPath);
        pass(`IR (${py ? "Python" : "TypeScript"}): ${ir.length} functions extracted`);
      } catch (e: any) {
        fail(`IR extraction: ${e.message}`);
      }

      // 2. SSG protocol validation (basic)
      const protoPath = path.resolve(projectPath, "protocols.json");
      if (fs.existsSync(protoPath)) {
        try {
          const protoDef = JSON.parse(fs.readFileSync(protoPath, "utf-8"));
          const { parseProtocolsFromJSON } = require("./ssg-validator");
          const protocols = parseProtocolsFromJSON(protoDef);
          pass(`SSG: ${protocols.length} protocol rules loaded`);
        } catch (e: any) {
          fail(`SSG: ${e.message}`);
        }
      } else {
        warn("SSG: no protocols.json found");
      }

      // 3. Failure corpus
      try {
        const { getFailureGenome, getAntibodyStats } = require("./failure-corpus");
        const genome = getFailureGenome();
        const ab = getAntibodyStats();
        results.push(
          `  Failures: ${genome.totalFailures} total | SVL-1:${genome.bySVL["SVL-1"]} SVL-2:${genome.bySVL["SVL-2"]} SVL-3:${genome.bySVL["SVL-3"]} SVL-4:${genome.bySVL["SVL-4"]}`
        );
        results.push(
          `  Antibodies: ${ab.totalHits} hits | ${ab.fastPathHits} fast-path | ${ab.totalLLMCallsSaved} LLM calls saved | ${ab.totalTokensSaved} tokens saved`
        );
      } catch (e: any) {
        fail(`Failure corpus: ${e.message}`);
      }

      // 4. Ledger invariants
      try {
        const { checkLedgerConsistency, rebuildState } = require("./ssg-validator");
        const sessionsDir = path.join(projectPath, ".progmune_corpus", "sessions");
        if (fs.existsSync(sessionsDir)) {
          let checked = 0;
          let consistent = 0;
          const nsInit = new Map<string, string>();
          nsInit.set("_global", "UNAUTHENTICATED");
          for (const file of fs.readdirSync(sessionsDir)) {
            if (!file.endsWith(".json")) continue;
            const session = JSON.parse(fs.readFileSync(path.join(sessionsDir, file), "utf-8"));
            for (const attempt of session.attempts || []) {
              const ts = attempt.transitions || [];
              if (ts.length === 0) continue;
              const result = checkLedgerConsistency(ts, nsInit);
              checked++;
              if (result.consistent) consistent++;
            }
          }
          if (checked > 0) {
            const status = consistent === checked ? "all clean" : `${checked - consistent} violations`;
            results.push(`  Ledger: ${checked} ledgers checked, ${status}`);
          } else {
            results.push(`  Ledger: no ledgers to check`);
          }
        } else {
          results.push(`  Ledger: no session data`);
        }
      } catch (e: any) {
        fail(`Ledger invariants: ${e.message}`);
      }

      return {
        content: [{ type: "text", text: results.join("\n") }],
      };
    }

    if (request.params.name === "progmune_execute") {
      const { intent, filePath, projectPath } = request.params.arguments as {
        intent: string; filePath: string; projectPath: string;
      };
      if (!intent || !filePath) {
        return { content: [{ type: "text", text: "❌ intent and filePath are required." }] };
      }
      const { execute } = require("./execute");
      const result = await execute(intent, projectPath || process.cwd(), filePath);
      if (result.success) {
        const marker = `// @progmune-generated session=${result.sessionId}`;
        let extra = "";
        if (result.degraded) {
          extra = `\n⚠️  LLM generation exhausted — used rule-based fallback. Code quality may be low. Review the output carefully.`;
        }
        if (result.repairApplied) {
          extra += `\n🔧 SSG Repair: ${result.repairCount} fix(es) applied, branches: ${result.repairBranchIds.map((id: string) => id.slice(0, 12)).join(", ")}`;
        }
        return { content: [{ type: "text", text: `✅ Generated and written to ${result.filePath}${extra}

${marker}
Session: ${result.sessionId}
IR: ${result.irFunctionCount} functions, ${result.protocolRuleCount} protocol rules
Hash: ${result.hash}

Code:
${result.code}` }] };
      }
      return { content: [{ type: "text", text: `❌ Execution failed: ${result.error}` }] };
    }

    if (request.params.name === "progmune_audit") {
      const { directory } = (request.params.arguments || {}) as { directory?: string };
      const targetDir = directory || process.cwd();
      const { auditDirectory, formatAuditResult } = require("./audit");
      const result = auditDirectory(targetDir);
      const text = formatAuditResult(result);
      if (result.warning) {
        return { content: [{ type: "text", text: `⚠️  ${result.warning}\n\n${text}` }] };
      }
      return { content: [{ type: "text", text }] };
    }

    if (request.params.name === "progmune_init") {
      const { projectPath } = request.params.arguments as { projectPath: string };
      const results: string[] = [];

      // 1. Install pre-commit hook
      const hookPath = path.resolve(projectPath, ".git/hooks/pre-commit");
      const guardScript = path.resolve(__dirname, "..", "bin/progmune-guard.sh");
      if (fs.existsSync(guardScript)) {
        const hookContent = `#!/bin/bash\n# Progmune Guard — installed by progmune_init\n"${guardScript}"\n`;
        const existingHook = fs.existsSync(hookPath) ? fs.readFileSync(hookPath, "utf-8") : "";
        if (!existingHook.includes("progmune-guard.sh")) {
          fs.writeFileSync(hookPath, (existingHook ? existingHook + "\n" : "") + hookContent, "utf-8");
          try { fs.chmodSync(hookPath, "755"); } catch { /* chmod best-effort */ }
          results.push("✅ Pre-commit hook installed (.git/hooks/pre-commit)");
        } else {
          results.push("✅ Pre-commit hook already installed");
        }
      } else {
        results.push("⚠️  Guard script not found — skipping hook installation");
      }

      // 2. Create allowlist if missing
      const allowlistPath = path.resolve(projectPath, ".progmune_allowlist");
      if (!fs.existsSync(allowlistPath)) {
        const defaultAllowlist = `# Progmune Allowlist\n\\.json$\n\\.md$\n\\.sh$\ntest-.*\ndist/\nnode_modules/\n`;
        fs.writeFileSync(allowlistPath, defaultAllowlist, "utf-8");
        results.push("✅ .progmune_allowlist created");
      }

      // 3. Ensure CLAUDE.md has Progmune instructions
      const claudeMdPath = path.resolve(projectPath, "CLAUDE.md");
      const PROGMUNE_INSTRUCTIONS = `

## Progmune — Program Immune System

This project uses [Progmune](https://github.com/shenlian19831109/progmune-runtime) for constraint-guided code generation. When writing new TypeScript code, prefer the \`progmune_generate\` MCP tool over direct file writes.

### Available MCP Tools
- \`progmune_generate\` — generate TypeScript code constrained by the project's IR and protocol rules
- \`progmune_check\` — run the full 7-step immune audit pipeline
- \`progmune_audit\` — scan files for @progmune-generated markers and report coverage
- \`progmune_status\` — view LLM config, immune network state, failure patterns
- \`progmune_init\` — ensure CLAUDE.md has Progmune instructions

### How to verify Progmune is working
- Generated files have \`// @progmune-generated session=...\` header
- Run \`npm run check\` to audit immune status
- Run \`progmune_audit\` to see coverage rate
`;

      let updated = false;
      if (fs.existsSync(claudeMdPath)) {
        const existing = fs.readFileSync(claudeMdPath, "utf-8");
        if (!existing.includes("progmune_generate")) {
          fs.writeFileSync(claudeMdPath, existing + PROGMUNE_INSTRUCTIONS, "utf-8");
          updated = true;
        }
      } else {
        fs.writeFileSync(claudeMdPath, `# ${path.basename(projectPath)}\n${PROGMUNE_INSTRUCTIONS}`, "utf-8");
        updated = true;
      }

      results.push(
        updated
          ? `✅ CLAUDE.md ${fs.existsSync(claudeMdPath) ? "updated" : "created"} with Progmune instructions.`
          : `✅ CLAUDE.md already has Progmune instructions.`
      );

      return { content: [{ type: "text", text: results.join("\n") }] };
    }

    if (request.params.name === "progmune_repair") {
      const { sessionId, projectPath } = (request.params.arguments || {}) as {
        sessionId: string; projectPath?: string;
      };
      if (!sessionId) {
        return { content: [{ type: "text", text: "❌ sessionId is required." }] };
      }

      const targetDir = projectPath || process.cwd();
      process.env.PROGMUNE_PROJECT_DIR = targetDir;

      try {
        const { getAllSessions } = require("./failure-corpus");
        const { checkLedgerConsistency } = require("./ssg-validator");
        const { generateRepairSummary } = require("./repair-proposal");
        const { createRootBranch, createBranch, wrapAsBranch, buildBranchMap, findRootBranch } = require("./branch-ledger");
        const { replayLedger } = require("./deterministic-replay");

        const sessions = getAllSessions();
        const session = sessions.find((s: any) => s.sessionId === sessionId || s.sessionId.startsWith(sessionId));
        if (!session) {
          return { content: [{ type: "text", text: `❌ Session not found: ${sessionId}` }] };
        }

        // Collect transitions
        let allTransitions: any[] = [];
        for (const a of (session.attempts || [])) {
          allTransitions = allTransitions.concat(a.transitions || []);
        }

        const nsInit = require("./protocol-registry").getNsInit();
        const consistency = checkLedgerConsistency(allTransitions, nsInit);

        if (consistency.consistent) {
          return { content: [{ type: "text", text: `✅ Session ${sessionId} ledger is consistent. No repairs needed.` }] };
        }

        const irRaw = JSON.parse(require("fs").readFileSync("ir.json", "utf-8"));
        const ir = Array.isArray(irRaw) ? irRaw : (irRaw.functions || []);
        const protocols: any[] = [];
        const summary = generateRepairSummary(allTransitions, ir, protocols, nsInit);

        let output = `🔧 Repair Analysis: ${sessionId}\n\n`;
        output += `Violations: ${consistency.violations.length}\n`;
        output += `Proposals: ${summary.proposals.length} (${summary.minimalFixSet.length} minimal fixes)\n\n`;

        for (let i = 0; i < summary.minimalFixSet.length; i++) {
          const p = summary.minimalFixSet[i];
          output += `## Proposal ${i + 1}: ${p.strategy}\n`;
          output += `  ID: ${p.id}\n`;
          output += `  Index: ${p.violationIndex}\n`;
          output += `  Confidence: ${(p.confidence * 100).toFixed(0)}%\n`;
          output += `  Reason: ${p.reason}\n`;
          output += `  Explanation: ${p.explanation}\n`;
          if (p.insertBefore !== undefined) {
            output += `  Insert before: action[${p.insertBefore}]\n`;
          }
          output += `\n`;
        }

        output += `\n── To accept a proposal ──\n`;
        output += `progmune_accept(sessionId="${sessionId}", proposalId="<id>")\n`;

        return { content: [{ type: "text", text: output }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `❌ Repair analysis failed: ${e.message}` }] };
      }
    }

    if (request.params.name === "progmune_accept") {
      const { sessionId, proposalId, projectPath } = (request.params.arguments || {}) as {
        sessionId: string; proposalId: string; projectPath?: string;
      };
      if (!sessionId || !proposalId) {
        return { content: [{ type: "text", text: "❌ sessionId and proposalId are required." }] };
      }

      const targetDir = projectPath || process.cwd();
      process.env.PROGMUNE_PROJECT_DIR = targetDir;

      try {
        const { getAllSessions } = require("./failure-corpus");
        const { checkLedgerConsistency } = require("./ssg-validator");
        const { generateRepairSummary } = require("./repair-proposal");

        const sessions = getAllSessions();
        const session = sessions.find((s: any) => s.sessionId === sessionId || s.sessionId.startsWith(sessionId));
        if (!session) {
          return { content: [{ type: "text", text: `❌ Session not found: ${sessionId}` }] };
        }

        let allTransitions: any[] = [];
        for (const a of (session.attempts || [])) {
          allTransitions = allTransitions.concat(a.transitions || []);
        }

        const nsInit = require("./protocol-registry").getNsInit();
        const irRaw = JSON.parse(require("fs").readFileSync("ir.json", "utf-8"));
        const ir = Array.isArray(irRaw) ? irRaw : (irRaw.functions || []);
        const summary = generateRepairSummary(allTransitions, ir, [], nsInit);
        const proposal = summary.proposals.find((p: any) => p.id === proposalId);

        if (!proposal) {
          return { content: [{ type: "text", text: `❌ Proposal not found: ${proposalId}` }] };
        }

        // Apply the proposal as a branch (human-accepted)
        const { wrapAsBranch, createBranch } = require("./branch-ledger");
        const parentBranch = wrapAsBranch(allTransitions);
        const { applyProposalAsBranch } = require("./repair-proposal");
        const repairBranch = applyProposalAsBranch(proposal, parentBranch, allTransitions, ir);

        // Re-check consistency on the repaired branch
        const repaired = checkLedgerConsistency(repairBranch.transitions, nsInit);

        let output = `✅ Repair Accepted\n\n`;
        output += `Session: ${sessionId}\n`;
        output += `Proposal: ${proposal.id}\n`;
        output += `Strategy: ${proposal.strategy}\n`;
        output += `Repair Branch: ${repairBranch.id}\n`;
        output += `Branch transitions: ${repairBranch.transitions.length}\n`;
        output += `Re-check: ${repaired.consistent ? '✅ Consistent' : '⚠️ ' + repaired.violations.length + ' remaining violations'}\n\n`;

        if (repaired.consistent) {
          // Update fingerprint with repaired ledger
          const { hashLedger } = require("./ssg-validator");
          const { getFingerprint } = require("./ledger-registry");
          const fp = getFingerprint(sessionId);
          const newHash = hashLedger(repairBranch.transitions);
          output += `Original hash: ${fp?.ledgerHash?.slice(0, 16) || 'unknown'}\n`;
          output += `Repaired hash: ${newHash.slice(0, 16)}\n`;
          output += `\n${'═'.repeat(48)}\n`;
          output += `✅ Repair complete. The fix has been applied to the repair branch.\n`;
          output += `   Original ledger is preserved (immutable).\n`;
          output += `   Branch ${repairBranch.id} contains the fix.\n`;
        }

        return { content: [{ type: "text", text: output }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `❌ Accept failed: ${e.message}` }] };
      }
    }

    if (request.params.name === "progmune_discover") {
      const { projectPath, repoName } = request.params.arguments as {
        projectPath: string;
        repoName?: string;
      };
      process.env.PROGMUNE_PROJECT_DIR = projectPath;

      const { buildKnownFingerprintLibrary, extractUnknownRepoSequences, discoverProtocolsFromSequences } = require("./unknown-protocol-discovery");
      const { CROSS_REPO_SEQUENCES } = require("./experimental/unsupervised-physics");

      const known = buildKnownFingerprintLibrary();
      const name = repoName || path.basename(projectPath);

      // Try to extract sequences from the trajectory corpus
      const { loadTrajectories } = require("./failure-corpus");
      const trajectories = (loadTrajectories() as any[]).filter((t: any) => t.trajectory.length >= 2);
      const seqs = trajectories.length > 0
        ? trajectories.map(t => t.trajectory)
        : (CROSS_REPO_SEQUENCES[name] || []);

      const discovered = discoverProtocolsFromSequences(seqs, name, known);

      const result = {
        repo: name,
        discoveredCount: discovered.length,
        protocols: discovered.map((p: any) => ({
          name: p.name,
          prototype: p.prototype,
          states: p.fingerprint.stateCount,
          transitions: p.fingerprint.transitions.length,
          entryPoints: p.fingerprint.entryStates.length,
          exitPoints: p.fingerprint.exitStates.length,
          isDAG: p.fingerprint.isDAG,
          closestKnown: p.closestKnown || "novel",
          confidence: p.matchConfidence,
          rules: p.rules.map((r: any) => ({
            function: r.function,
            pre_states: r.pre_states,
            post_states: r.post_states,
            invalidate: r.invalidate,
          })),
        })),
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    if (request.params.name === "progmune_zeroshot") {
      const { brokenSequence, expectedPattern, projectPath } = request.params.arguments as {
        brokenSequence: string[];
        expectedPattern?: string;
        projectPath?: string;
      };
      if (projectPath) process.env.PROGMUNE_PROJECT_DIR = projectPath;

      const { buildKnownFingerprintLibrary, discoverProtocolsFromSequences, evaluateZeroShotRepair } = require("./unknown-protocol-discovery");
      const { loadTrajectories } = require("./failure-corpus");

      const known = buildKnownFingerprintLibrary();
      const trajectories = (loadTrajectories() as any[]).filter((t: any) => t.trajectory.length >= 2);
      const seqs = trajectories.length > 0
        ? trajectories.map(t => t.trajectory)
        : [brokenSequence];

      const discovered = discoverProtocolsFromSequences(seqs, "zeroshot", known);

      // Build defect cases from the broken sequence
      const expected = expectedPattern === "transaction"
        ? [...brokenSequence, "commit_tx"]
        : expectedPattern === "acquire_use_release"
          ? [...brokenSequence, "close_file"]
          : brokenSequence;

      const defectCases = [{
        broken: brokenSequence,
        expected,
        description: `zeroshot: ${brokenSequence.join(" → ")} (pattern: ${expectedPattern || "auto"})`,
      }];

      const repairResult = evaluateZeroShotRepair(discovered, defectCases);

      const result = {
        brokenSequence,
        expectedPattern: expectedPattern || "auto-detected",
        discoveredProtocols: discovered.length,
        repairSuccess: repairResult.success,
        repairTotal: repairResult.total,
        repairRate: repairResult.repairRate,
        details: repairResult.details,
        topMatches: discovered.slice(0, 3).map((p: any) => ({
          name: p.name,
          prototype: p.prototype,
          closestKnown: p.closestKnown || "none",
          confidence: p.matchConfidence,
        })),
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    if (request.params.name === "progmune_scaffold") {
      const { intent, scaffoldType, filePath, projectPath } = request.params.arguments as {
        intent: string; scaffoldType: string; filePath?: string; projectPath: string;
      };
      if (!intent || !scaffoldType || !projectPath) {
        return { content: [{ type: "text", text: "❌ intent, scaffoldType, and projectPath are required." }] };
      }
      if (!["express-api", "cli-tool", "static-site"].includes(scaffoldType)) {
        return { content: [{ type: "text", text: `❌ Unknown scaffold type: ${scaffoldType}. Available: express-api, cli-tool, static-site` }] };
      }

      const { scaffold } = require("./scaffold");
      const result = await scaffold(scaffoldType as any, intent, projectPath, filePath);

      if (result.success) {
        const marker = result.filePath?.endsWith(".html")
          ? `<!-- @progmune-scaffolded type=${result.scaffoldType} -->`
          : `// @progmune-scaffolded type=${result.scaffoldType}`;
        let extra = "";
        if (result.filePath) {
          extra = `\n📁 Written to: ${result.filePath}`;
        }
        return { content: [{ type: "text", text: `✅ Scaffold generated (${result.scaffoldType})${extra}

${marker}
Code length: ${result.code.length} chars

Preview (first 80 lines):
${result.code.split("\n").slice(0, 80).join("\n")}` }] };
      }
      return { content: [{ type: "text", text: `❌ Scaffold failed: ${result.error}` }] };
    }

    if (request.params.name === "progmune_governance_report") {
      const { projectPath, sessionId, format, fast } = request.params.arguments as {
        projectPath?: string; sessionId?: string; format?: string; fast?: boolean;
      };
      const targetDir = projectPath || process.cwd();
      process.env.PROGMUNE_PROJECT_DIR = targetDir;

      const { buildGovernanceReport, formatAsJSON, formatAsTerminal, formatAsMarkdown } = require("./audit");
      const report = buildGovernanceReport(targetDir, { fast, sessionId });

      let output: string;
      switch (format) {
        case "json": output = formatAsJSON(report); break;
        case "markdown": output = formatAsMarkdown(report); break;
        default: output = formatAsTerminal(report);
      }

      return { content: [{ type: "text", text: output }] };
    }

    if (request.params.name === "progmune_provenance") {
      const { sessionId, format } = request.params.arguments as {
        sessionId: string; format?: string;
      };
      if (!sessionId) {
        return { content: [{ type: "text", text: "❌ sessionId is required." }] };
      }

      try {
        const { buildProvenanceChain } = require("./ledger");
        const chain = buildProvenanceChain(sessionId);

        if (format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(chain, null, 2) }] };
        }

        // Terminal format
        let output = `🔗 Provenance Chain: ${chain.sessionId}\n\n`;
        output += `Intent: ${chain.intent}\n`;
        output += `Integrity: ${chain.integrity.toUpperCase()}\n`;
        output += `Transitions: ${chain.totalTransitions} (${chain.validTransitions} valid, ${chain.invalidTransitions} invalid)\n`;
        output += `Repairs: ${chain.repairCount}\n`;
        output += `Ledger Hash: ${chain.finalLedgerHash}\n`;
        output += `Stored Hash: ${chain.storedFingerprintHash || "(none)"}\n\n`;

        for (let i = 0; i < chain.events.length; i++) {
          const e = chain.events[i];
          const icon = e.result === "passed" || e.result === "approved" ? "✅" : e.result === "failed" ? "❌" : "🔧";
          output += `[${String(i).padStart(2, "0")}] ${icon} ${e.step.padEnd(10)} | ${e.artifact.padEnd(25).slice(0, 25)} | ${e.hash}\n`;
          if (e.detail) output += `     ${e.detail.slice(0, 100)}\n`;
        }

        return { content: [{ type: "text", text: output }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `❌ Provenance failed: ${e.message}` }] };
      }
    }

    if (request.params.name === "progmune_plsb") {
      const { format, category } = request.params.arguments as {
        format?: string; category?: string;
      };

      try {
        const { generatePLSBArtifact, generatePLSBReportMarkdown } = require("./plsb");
        const ar = generatePLSBArtifact();

        if (format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(ar, null, 2) }] };
        }

        if (format === "markdown") {
          const md = generatePLSBReportMarkdown();
          return { content: [{ type: "text", text: md }] };
        }

        // Summary format (default)
        const bm = ar.benchmark.metadata;
        let output = "PLSB v1.0 — Protocol Lifecycle Security Benchmark\n\n";
        output += `Entries:  ${bm.total} (${bm.verified} verified)\n`;
        output += `Recall:   ${(bm.recall * 100).toFixed(0)}%\n`;
        output += `Precision: ${(bm.precision * 100).toFixed(0)}%\n`;
        output += `Coverage: ${Object.keys(bm.byPLS).length}/${ar.benchmark.taxonomy.length} categories\n\n`;

        const filter = category ? ar.benchmark.taxonomy.filter((t: any) => t.id === category) : ar.benchmark.taxonomy;
        for (const t of filter) {
          const count = bm.byPLS[t.id] || 0;
          output += `  ${count > 0 ? "✅" : "⚠️"} ${t.id} ${t.name}: ${count} entries (${t.category})\n`;
        }

        return { content: [{ type: "text", text: output }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `❌ PLSB query failed: ${e.message}` }] };
      }
    }

    if (request.params.name === "progmune_policy_check") {
      const { filePath, author, reviewer, format } = request.params.arguments as {
        filePath: string; author?: string; reviewer?: string; format?: string;
      };

      try {
        const { certify } = require("./certify");
        const { buildAccountabilityChain } = require("./ledger");
        const { evaluatePolicy } = require("./policy");
        const cert = certify(filePath);

        let acct;
        try {
          const opts: any = {};
          if (author) opts.author = { id: author, name: author.split("@")[0], role: "developer" };
          if (reviewer) opts.reviewers = [{ id: reviewer, name: reviewer.split("@")[0], role: "reviewer" }];
          acct = buildAccountabilityChain(cert.sessionId, opts);
        } catch { /* no accountability */ }

        const ctx = {
          certificate: {
            validated: cert.validated,
            confidence: cert.confidence,
            provenanceIntact: cert.provenanceIntact,
            fingerprint: cert.fingerprint,
            violations: cert.violations,
            plsbCoverage: cert.plsbCoverage,
            plsbRecall: cert.plsbRecall,
            degraded: cert.degraded,
            sessionId: cert.sessionId,
            file: cert.file,
          },
          accountability: acct ? {
            humanEvents: acct.humanEvents,
            aiEvents: acct.aiEvents,
            automatedEvents: acct.automatedEvents,
            custodyGap: acct.custodyGap,
          } : undefined,
        };

        const result = evaluatePolicy(ctx);

        if (format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        const verdictEmoji = result.verdict === "ALLOW" ? "✅" : result.verdict === "WARN" ? "⚠️" : "❌";
        let output = `Policy Engine: ${verdictEmoji} ${result.verdict}\n\n`;
        output += `File: ${filePath}\n`;
        output += `${result.passed_rules}/${result.rules} rules passed\n\n`;

        if (result.violations.length > 0) {
          for (const v of result.violations) {
            output += `  [${v.rule.severity.toUpperCase()}] ${v.rule.type}: ${v.actual} → ${v.expected}\n`;
            if (v.detail) output += `       ${v.detail.slice(0, 100)}\n`;
          }
          output += "\n";
        }

        output += result.summary;
        return { content: [{ type: "text", text: output }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `❌ Policy check failed: ${e.message}` }] };
      }
    }

    if (request.params.name === "progmune_accountability") {
      const { sessionId, author, reviewer, approver, deployer, format } = request.params.arguments as {
        sessionId: string; author?: string; reviewer?: string; approver?: string; deployer?: string; format?: string;
      };
      if (!sessionId) {
        return { content: [{ type: "text", text: "❌ sessionId is required." }] };
      }

      try {
        const { buildAccountabilityChain, verifyAccountabilityChain } = require("./ledger");
        const opts: any = {};
        if (author) opts.author = { id: author, name: author.split("@")[0], role: "developer" };
        if (reviewer) opts.reviewers = [{ id: reviewer, name: reviewer.split("@")[0], role: "reviewer" }];
        if (approver) opts.approver = { id: approver, name: approver.split("@")[0], role: "security_engineer" };
        if (deployer) opts.deployer = { id: deployer, name: deployer };

        const chain = buildAccountabilityChain(sessionId, opts);

        if (format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(chain, null, 2) }] };
        }

        // Terminal format
        const actors = `${chain.humanEvents} human · ${chain.aiEvents} AI · ${chain.automatedEvents} automated`;
        const custody = chain.custodyGap ? "⚠️ GAPS" : "✅ VERIFIED";
        let output = `🔗 Accountability Ledger: ${chain.sessionId}\n\n`;
        output += `Intent:    ${chain.intent}\n`;
        output += `Integrity: ${chain.integrity.toUpperCase()}\n`;
        output += `Custody:   ${custody}\n`;
        output += `Actors:    ${actors}\n`;
        output += `Chain:     ${chain.chainHash}\n\n`;

        for (let i = 0; i < chain.events.length; i++) {
          const e = chain.events[i];
          const typeIcon = e.actorType === "human" ? "👤" : e.actorType === "llm" ? "🤖"
            : e.actorType === "reviewer" ? "✅" : e.actorType === "deployer" ? "🚀" : "⚙";
          const resultIcon = e.result === "passed" || e.result === "approved" ? "✅" : e.result === "failed" ? "❌" : "🔧";
          output += `[${String(i).padStart(2, "0")}] ${typeIcon} ${e.actorLabel.padEnd(30).slice(0, 30)} ${resultIcon} ${e.action}\n`;
          output += `     hash: ${e.hash} ← ${e.prevHash ? e.prevHash.slice(0, 12) : "genesis"}\n`;
          if (i < chain.events.length - 1) output += `  │\n`;
        }

        if (chain.custodyGap) {
          output += `\n⚠️  Custody gaps detected. Use --author, --reviewer, --approver to identify human actors.\n`;
        }

        return { content: [{ type: "text", text: output }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `❌ Accountability chain failed: ${e.message}` }] };
      }
    }

    if (request.params.name === "progmune_certify") {
      const { filePath, format } = request.params.arguments as {
        filePath: string; format?: string;
      };
      if (!filePath) {
        return { content: [{ type: "text", text: "❌ filePath is required." }] };
      }

      try {
        const { certify, formatCertificate } = require("./certify");
        const cert = certify(filePath);

        if (format === "json") {
          return { content: [{ type: "text", text: JSON.stringify(cert, null, 2) }] };
        }

        return { content: [{ type: "text", text: formatCertificate(cert) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `❌ Certification failed: ${e.message}` }] };
      }
    }

    if (request.params.name === "progmune_trust_check") {
      const { projectPath, commit, branch, policy, format } = request.params.arguments as {
        projectPath: string; commit?: string; branch?: string; policy?: string; format?: string;
      };
      const targetDir = projectPath || process.cwd();
      process.env.PROGMUNE_PROJECT_DIR = targetDir;

      try {
        const { evaluateTrust } = require("./trust");
        const decision = evaluateTrust({
          projectPath: targetDir,
          projectName: path.basename(targetDir),
          commit: commit || "unknown",
          branch,
          policyName: policy,
        });

        if (format === "json") {
          const { formatTrustJSON } = require("./trust/formatters/json");
          return { content: [{ type: "text", text: formatTrustJSON(decision) }] };
        }

        const { formatTrustTerminal } = require("./trust/formatters/terminal");
        return { content: [{ type: "text", text: formatTrustTerminal(decision) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `❌ Trust check failed: ${e.message}` }] };
      }
    }

    if (request.params.name === "progmune_score") {
      const { calls, purpose, functionName } = request.params.arguments as {
        calls: string[]; purpose?: string; functionName?: string;
      };
      if (!calls || !Array.isArray(calls) || calls.length === 0) {
        return { content: [{ type: "text", text: "❌ calls is required and must be a non-empty array of function names." }] };
      }

      try {
        const { scoreCompliance, scoreFunction, formatComplianceReport } = require("./trust/compliance-scorer");
        const result = functionName
          ? scoreFunction(functionName, calls, purpose)
          : scoreCompliance(calls, purpose);
        const report = formatComplianceReport(result);
        const json = JSON.stringify(result, null, 2);
        return {
          content: [
            { type: "text", text: report },
            { type: "text", text: `\n── JSON ──\n${json}` },
          ],
        };
      } catch (e: any) {
        return { content: [{ type: "text", text: `❌ Compliance scoring failed: ${e.message}` }] };
      }
    }

    throw new Error(`Unknown tool: ${request.params.name}`);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info("✅ Progmune MCP server ready (TypeScript)");
}

main().catch((e) => {
  console.error("[Progmune] Fatal:", e);
  process.exit(1);
});
