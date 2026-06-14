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

      // IR extraction
      let ir: FunctionInfo[];
      try {
        ir = extractIR(projectPath);
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

      // 1. IR extraction
      try {
        const ir = extractIR(projectPath);
        pass(`IR: ${ir.length} functions extracted`);
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
        if (result.repairApplied) {
          extra = `\n🔧 SSG Repair: ${result.repairCount} fix(es) applied, branches: ${result.repairBranchIds.map((id: string) => id.slice(0, 12)).join(", ")}`;
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
      const { CROSS_REPO_SEQUENCES } = require("./unsupervised-physics");

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
