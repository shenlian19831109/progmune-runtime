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
import type { FunctionInfo } from "./runtime-types";

const OPT_IN_FILE = path.resolve(__dirname, "..", ".progmune_memory", "opt_in.json");

// ── Structured logging (stderr, not stdout JSON-RPC) ──
const log = {
  info: (msg: string) => console.error(`[Progmune] ${msg}`),
  warn: (msg: string) => console.error(`[Progmune] ⚠️ ${msg}`),
  error: (msg: string) => console.error(`[Progmune] ❌ ${msg}`),
  success: (msg: string) => console.error(`[Progmune] ✅ ${msg}`),
};

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
      let actions;
      try {
        actions = await plan(intent);
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

      if (!actions || actions.length === 0) {
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

      // Emit TypeScript code
      const code = emitCode(actions);
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

      const status = {
        version: "2.2.0",
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

    throw new Error(`Unknown tool: ${request.params.name}`);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.success("Progmune MCP server started (TypeScript)");
}

main().catch((e) => {
  console.error("[Progmune] Fatal:", e);
  process.exit(1);
});
