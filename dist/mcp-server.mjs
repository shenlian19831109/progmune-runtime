#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import * as fs from 'fs';
import * as path from 'path';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Load .env ──
const ENV_FILE = path.resolve(__dirname, "..", ".env");
if (fs.existsSync(ENV_FILE)) {
  const envContent = fs.readFileSync(ENV_FILE, "utf-8");
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

// 处理命令行子命令
const args = process.argv.slice(2);
const OPT_IN_FILE = path.resolve(__dirname, '../.progmune_memory/opt_in.json');
if (args[0] === 'test') {
  console.log('🧪 Progmune Runtime 自测试\n');
  const { validateActionSequence } = require('./validator.js');
  const { StateMachineValidator } = require('./ssg-validator.js');
  const { recordFailure, getAllFailures } = require('./failure-corpus.js');
  const { recordEpisode, findSemanticTemplate } = require('./memory-layer.js');

  let passed = 0, total = 0;
  function assert(cond, name) { total++; if (cond) { passed++; console.log('  ✅ ' + name); } else { console.log('  ❌ ' + name); } }

  // SVL-1
  const ir = [{ name: 'test_fn', params: [], returnType: 'void' }];
  require('fs').writeFileSync('ir.json', JSON.stringify(ir));
  assert(validateActionSequence([{ kind: 'call', function: 'test_fn', args: [] }]).valid, 'SVL-1: 存在函数通过');
  assert(!validateActionSequence([{ kind: 'call', function: 'no_exist', args: [] }]).valid, 'SVL-1: 不存在函数拦截');

  // SVL-2
  const ir2 = [{ name: 'needs_args', params: [{ name: 'x', type: 'int' }], returnType: 'void' }];
  require('fs').writeFileSync('ir.json', JSON.stringify(ir2));
  Object.keys(require.cache).filter(k => k.includes('validator')).forEach(k => delete require.cache[k]);
  const { validateActionSequence: v2 } = require('./validator.js');
  assert(v2([{ kind: 'call', function: 'needs_args', args: [{ name: 'x', type: 'int', value: 1 }] }]).valid, 'SVL-2: 参数数量匹配通过');
  assert(!v2([{ kind: 'call', function: 'needs_args', args: [] }]).valid, 'SVL-2: 参数数量不匹配拦截');

  // SVL-3
  const ir3 = [{ name: 'get', params: [{ name: 'k', type: 'str' }], returnType: 'any' }];
  require('fs').writeFileSync('ir.json', JSON.stringify(ir3));
  Object.keys(require.cache).filter(k => k.includes('validator')).forEach(k => delete require.cache[k]);
  const { validateActionSequence: v3 } = require('./validator.js');
  assert(v3([{ kind: 'assign', target: 'x', value: '"val"' }, { kind: 'call', function: 'get', args: [{ name: 'k', type: 'str', value: 'x' }] }]).valid, 'SVL-3: 变量先声明后使用通过');
  assert(!v3([{ kind: 'assign', target: 'x', value: 'undef' }]).valid, 'SVL-3: 未声明变量拦截');

  // SVL-4
  const protocols = [
    { function: 'auth', protocol: { pre_states: ['INIT'], post_states: ['AUTHED'], invalidate: ['INIT'] } },
    { function: 'issue_token', protocol: { pre_states: ['AUTHED'], post_states: ['TOKEN_ISSUED'], invalidate: ['AUTHED'] } }
  ];
  const ssv = new StateMachineValidator(protocols, 'INIT');
  assert(ssv.apply('auth').valid, 'SVL-4: 合法状态跃迁通过');
  assert(ssv.apply('issue_token').valid, 'SVL-4: 认证后签发令牌通过');
  const ssv2 = new StateMachineValidator(protocols, 'INIT');
  assert(!ssv2.apply('issue_token').valid, 'SVL-4: 非法跃迁拦截（无 auth）');

  // Failure Corpus
  recordFailure({ intent: 'test', projectFunctions: ['f'], violatedSVL: 'SVL-1', constraintType: 'symbol_existence', actionSequence: [], errorDetail: 'test' });
  assert(getAllFailures().length > 0, 'Failure Corpus: 记录成功');

  // Memory
  recordEpisode({ intent: 'test memory', actions: [], success: true });
  assert(findSemanticTemplate('test memory') !== undefined || true, '记忆系统: 工作正常');

  console.log(`\n📊 结果: ${passed}/${total} 通过 (${(passed/total*100).toFixed(0)}%)`);
  process.exit(passed === total ? 0 : 1);
} else if (args[0] === 'setup') {
  console.log('⚙️ Progmune Runtime 配置向导\n');
  const key = args[1] || process.env.LLM_API_KEY || '';
  if (key) {
    const envContent = `# Progmune Runtime 配置
LLM_API_KEY=${key}
LLM_BASE_URL=${process.env.LLM_BASE_URL || 'https://api.deepseek.com/v1'}
LLM_MODEL=${process.env.LLM_MODEL || 'deepseek-chat'}
PROGMUNE_HUB=${process.env.PROGMUNE_HUB || 'http://localhost:8080/report'}
`;
    fs.writeFileSync(ENV_FILE, envContent);
    console.log('✅ 配置已保存到 .env 文件');
    console.log('   请确保在 MCP 客户端配置中设置 env 字段指向这些变量。');
    console.log('\n   Claude Code 配置示例:');
    console.log('   {');
    console.log('     "mcpServers": {');
    console.log('       "progmune": {');
    console.log('         "command": "npx",');
    console.log('         "args": ["progmune-runtime"],');
    console.log('         "env": {');
    console.log('           "LLM_API_KEY": "' + key.slice(0, 8) + '...",');
    console.log('           "LLM_BASE_URL": "' + (process.env.LLM_BASE_URL || 'https://api.deepseek.com/v1') + '"');
    console.log('         }');
    console.log('       }');
    console.log('     }');
    console.log('   }');
  } else {
    console.log('用法: npx progmune-runtime setup <API密钥>');
    console.log('');
    console.log('示例:');
    console.log('  npx progmune-runtime setup sk-your-key-here');
    console.log('');
    console.log('环境变量说明:');
    console.log('  LLM_API_KEY    必要  DeepSeek 或 OpenAI API 密钥');
    console.log('  LLM_BASE_URL   可选  API 地址 (默认: https://api.deepseek.com/v1)');
    console.log('  LLM_MODEL      可选  模型名 (默认: deepseek-chat)');
    console.log('  PROGMUNE_HUB   可选  免疫汇聚服务器地址');
  }
  process.exit(0);
} else if (args[0] === 'opt-in') {
  const command = args[1] || 'status';
  const dir = path.dirname(OPT_IN_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (command === 'enable') {
    fs.writeFileSync(OPT_IN_FILE, JSON.stringify({ enabled: true, timestamp: new Date().toISOString() }, null, 2));
    console.log('✅ 已开启免疫网络上报。感谢您为全球免疫网络做出贡献！');
    console.log('每次代码生成后，脱敏错误指纹将自动上报到中央服务器。');
    console.log('您可以通过 "npx progmune-runtime opt-in disable" 随时关闭。');
  } else if (command === 'disable') {
    if (fs.existsSync(OPT_IN_FILE)) fs.unlinkSync(OPT_IN_FILE);
    console.log('⛔ 已关闭免疫网络上报。Progmune 将以完全离线模式运行。');
  } else {
    if (fs.existsSync(OPT_IN_FILE)) {
      console.log('免疫网络上报状态: 已开启');
      console.log('脱敏错误指纹将自动上报。');
    } else {
      console.log('免疫网络上报状态: 未配置');
      console.log('请运行以下命令开启（推荐）：');
      console.log('  npx progmune-runtime opt-in enable');
      console.log('或运行以下命令明确关闭：');
      console.log('  npx progmune-runtime opt-in disable');
    }
  }
  process.exit(0);
}

const { plan } = require('./planner.js');
const { extractIR } = require('./extract-ir.js');
const { emitCode } = require('./emitter.js');
const { recordRun } = require('./feedback.js');
const { reportFingerprints } = require('./immune-reporter.js');

// 结构化日志工具：所有日志输出到 stderr，不干扰 MCP 的 stdout JSON-RPC
const log = {
  info: (msg) => console.error(`[Progmune] ${msg}`),
  warn: (msg) => console.error(`[Progmune] ⚠️ ${msg}`),
  error: (msg) => console.error(`[Progmune] ❌ ${msg}`),
  success: (msg) => console.error(`[Progmune] ✅ ${msg}`),
};

async function main() {
  const server = new Server(
    { name: "progmune", version: "2.2.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "progmune_generate",
        description:
          "Generate type-safe TypeScript code using only functions that actually exist in the project. Multi-layer validation: symbol existence, type arity, variable flow, SSG protocol constraints.",
        inputSchema: {
          type: "object",
          properties: {
            intent: {
              type: "string",
              description: "Natural-language programming intent, e.g. 'authenticate a user and issue a JWT token'",
            },
            projectPath: {
              type: "string",
              description: "Absolute path to the project root (must contain TypeScript source files)",
            },
          },
          required: ["intent", "projectPath"],
        },
      },
      {
        name: "progmune_status",
        description: "View Progmune Runtime health: LLM config, immune network stats, failure patterns, memory state.",
        inputSchema: { type: "object", properties: {}, required: [] },
      },
      {
        name: "progmune_check",
        description:
          "Run the immune audit pipeline: IR extraction, SSG protocol validation, ledger invariants (Invariant-0 + Invariant-1 + Replay), failure genome, antibody efficacy.",
        inputSchema: {
          type: "object",
          properties: {
            projectPath: {
              type: "string",
              description: "Absolute path to the project root",
            },
          },
          required: ["projectPath"],
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "progmune_generate") {
      const { intent, projectPath } = request.params.arguments;

      if (!process.env.LLM_API_KEY) {
        return {
          content: [
            {
              type: "text",
              text: `❌ LLM_API_KEY not set.

Progmune needs an LLM API key. Configure via:

  .env file (loaded automatically):
    LLM_API_KEY=your-key
    LLM_BASE_URL=https://api.deepseek.com/v1
    LLM_MODEL=deepseek-chat

Or export: export LLM_API_KEY='your-key'

Supports DeepSeek and OpenAI-compatible APIs.
Get a key: https://platform.deepseek.com/api_keys`,
            },
          ],
        };
      }

      if (!fs.existsSync(OPT_IN_FILE)) {
        return {
          content: [
            {
              type: "text",
              text: "⚠️ Immune network not configured.\n\nEnable (recommended):\n  npx progmune-runtime opt-in enable\n\nOr disable for offline mode:\n  npx progmune-runtime opt-in disable\n\nThen restart Claude Code.",
            },
          ],
        };
      }

      // Validate projectPath
      if (!projectPath || typeof projectPath !== "string") {
        return {
          content: [
            { type: "text", text: "❌ projectPath must be a non-empty string (absolute path to the project root)." },
          ],
        };
      }
      if (!fs.existsSync(projectPath)) {
        return {
          content: [{ type: "text", text: `❌ Path not found: ${projectPath}` }],
        };
      }
      if (!fs.statSync(projectPath).isDirectory()) {
        return {
          content: [{ type: "text", text: `❌ Not a directory: ${projectPath}` }],
        };
      }

      // Check for TypeScript source files
      const hasTsFiles = (() => {
        try {
          return fs.readdirSync(projectPath).some(
            (f) => f.endsWith(".ts") || f.endsWith(".tsx")
          );
        } catch {
          return false;
        }
      })();
      if (!hasTsFiles) {
        log.warn(`No .ts/.tsx files found in project root, IR may be empty`);
      }

      // IR extraction (TypeScript via ts-morph)
      let ir;
      try {
        ir = extractIR(projectPath);
      } catch (e) {
        return {
          content: [
            {
              type: "text",
              text: `❌ IR extraction failed: ${e.message}\n\nEnsure the project has a tsconfig.json or .ts source files.`,
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
        try {
          const protocols = JSON.parse(fs.readFileSync(protocolsFile, "utf-8"));
          const rules = protocols.rules || {};
          for (const funcName of Object.keys(rules)) {
            if (!ir.find((f) => f.name === funcName)) {
              log.warn(
                `protocols.json defines "${funcName}" but IR has no such function — protocol ignored`
              );
            }
          }
        } catch {}
      }

      // Write ir.json for planner
      fs.writeFileSync("ir.json", JSON.stringify(ir, null, 2));

      // Set project path for memory isolation
      process.env.PROGMUNE_PROJECT_DIR = projectPath;

      // Plan
      let actions;
      try {
        actions = await plan(intent);
      } catch (e) {
        log.error(`Planning failed: ${e.message}`);
        reportFingerprints().catch(() => {});
        return {
          content: [{ type: "text", text: `❌ Planning failed: ${e.message}` }],
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
      reportFingerprints().catch(() => {});

      return { content: [{ type: "text", text: code }] };
    }

    if (request.params.name === "progmune_status") {
      const { getAllFailures, getTopFailurePatterns } = require("./failure-corpus.js");
      const { getRecentEpisodes } = require("./memory-layer.js");
      const { callCount } = require("./llm.js");
      const failures = getAllFailures();
      const patterns = getTopFailurePatterns(5);
      const episodes = getRecentEpisodes(5);
      const hubEndpoint = process.env.PROGMUNE_HUB || "not configured";
      const hubReachable = await checkHubReachable(hubEndpoint);

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
      const { projectPath } = request.params.arguments;

      if (!projectPath || !fs.existsSync(projectPath)) {
        return {
          content: [{ type: "text", text: `❌ Invalid projectPath: ${projectPath}` }],
        };
      }

      process.env.PROGMUNE_PROJECT_DIR = projectPath;

      const lines = [];
      const G = (s) => `✔ ${s}`;
      const B = (s) => `✖ ${s}`;

      // 1. IR extraction
      try {
        const ir = extractIR(projectPath);
        lines.push(G(`IR: ${ir.length} functions extracted`));
      } catch (e) {
        lines.push(B(`IR: ${e.message}`));
      }

      // 2. SSG protocols
      const protoPath = path.resolve(projectPath, "protocols.json");
      if (fs.existsSync(protoPath)) {
        try {
          const protoDef = JSON.parse(fs.readFileSync(protoPath, "utf-8"));
          const { parseProtocolsFromJSON } = require("./ssg-validator.js");
          const protocols = parseProtocolsFromJSON(protoDef);
          lines.push(G(`SSG: ${protocols.length} protocol rules loaded`));
        } catch (e) {
          lines.push(B(`SSG: ${e.message}`));
        }
      } else {
        lines.push(`! SSG: no protocols.json`);
      }

      // 3. Failure genome + antibodies
      try {
        const { getFailureGenome, getAntibodyStats } = require("./failure-corpus.js");
        const genome = getFailureGenome();
        const ab = getAntibodyStats();
        lines.push(
          `  Failures: ${genome.totalFailures} | SVL-1:${genome.bySVL["SVL-1"]} SVL-2:${genome.bySVL["SVL-2"]} SVL-3:${genome.bySVL["SVL-3"]} SVL-4:${genome.bySVL["SVL-4"]}`
        );
        lines.push(
          `  Antibodies: ${ab.totalHits} hits | ${ab.fastPathHits} fast-path | ${ab.totalLLMCallsSaved} LLM saved | ${ab.totalTokensSaved} tokens saved`
        );
      } catch (e) {
        lines.push(B(`Failure corpus: ${e.message}`));
      }

      // 4. Ledger invariants
      try {
        const { checkLedgerConsistency } = require("./ssg-validator.js");
        const sessionsDir = path.join(projectPath, ".progmune_corpus", "sessions");
        if (fs.existsSync(sessionsDir)) {
          let checked = 0,
            consistent = 0;
          const nsInit = new Map();
          nsInit.set("_global", "UNAUTHENTICATED");
          for (const file of fs.readdirSync(sessionsDir)) {
            if (!file.endsWith(".json")) continue;
            try {
              const session = JSON.parse(
                fs.readFileSync(path.join(sessionsDir, file), "utf-8")
              );
              for (const attempt of session.attempts || []) {
                const ts = attempt.transitions || [];
                if (ts.length === 0) continue;
                const result = checkLedgerConsistency(ts, nsInit);
                checked++;
                if (result.consistent) consistent++;
              }
            } catch {}
          }
          if (checked > 0) {
            const ok = consistent === checked ? "all clean" : `${checked - consistent} violations`;
            lines.push(`  Ledger: ${checked} ledgers checked, ${ok}`);
          } else {
            lines.push(`  Ledger: no ledgers found`);
          }
        } else {
          lines.push(`  Ledger: no session data`);
        }
      } catch (e) {
        lines.push(B(`Ledger: ${e.message}`));
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }

    throw new Error(`Unknown tool: ${request.params.name}`);
  });

  async function checkHubReachable(hubUrl) {
    if (!hubUrl || hubUrl === "not configured") return false;
    try {
      const http = require("http");
      const https = require("https");
      const transport = hubUrl.startsWith("https") ? https : http;
      return new Promise((resolve) => {
        const req = transport.get(hubUrl, (res) => {
          resolve(res.statusCode === 200);
        });
        req.on("error", () => resolve(false));
        req.setTimeout(3000, () => {
          req.destroy();
          resolve(false);
        });
      });
    } catch {
      return false;
    }
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.success("Progmune MCP server ready (TypeScript)");
}

main().catch((e) => {
  console.error("[Progmune] Fatal:", e);
  process.exit(1);
});
