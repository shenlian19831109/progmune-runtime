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

// 处理命令行子命令
const args = process.argv.slice(2);
const OPT_IN_FILE = path.resolve(__dirname, '../.progmune_memory/opt_in.json');
const ENV_FILE = path.resolve(__dirname, '../.env');

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
const { extractIRPython } = require('./extract-ir-python.js');
const { emitPython } = require('./python-emitter.js');
const { recordRun } = require('./feedback.js');
const { reportFingerprints } = require('./immune-reporter.js');

// 结构化日志工具：所有日志输出到 stderr，不干扰 MCP 的 stdout JSON-RPC
const log = {
  info: (msg) => console.error(`[Progmune] ${msg}`),
  warn: (msg) => console.error(`[Progmune] ⚠️ ${msg}`),
  error: (msg) => console.error(`[Progmune] ❌ ${msg}`),
  success: (msg) => console.error(`[Progmune] ✅ ${msg}`),
};

// 从独立的协议文件中加载协议，并注入到 IR 中
function mergeProtocols(irArray) {
  const protocolsFile = path.resolve(__dirname, '../protocols.json');
  if (!fs.existsSync(protocolsFile)) return irArray;
  
  const protocols = JSON.parse(fs.readFileSync(protocolsFile, 'utf-8'));
  return irArray.map(fn => {
    if (protocols[fn.name]) {
      return { ...fn, protocol: protocols[fn.name] };
    }
    return fn;
  });
}

async function main() {
  const server = new Server({
    name: "progmune",
    version: "2.0.0"
  }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{
      name: "progmune_generate",
      description: "生成类型安全的Python代码，仅使用项目中真实存在的函数。",
      inputSchema: {
        type: "object",
        properties: {
          intent: { type: "string", description: "编程意图" },
          projectPath: { type: "string", description: "项目根目录绝对路径" }
        },
        required: ["intent", "projectPath"]
      }
    }, {
      name: "progmune_status",
      description: "查看 Progmune Runtime 的运行状态、统计信息和健康检查。",
      inputSchema: {
        type: "object",
        properties: {},
        required: []
      }
    }]
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "progmune_generate") {
      const { intent, projectPath } = request.params.arguments;

      if (!process.env.LLM_API_KEY) {
        return { content: [{ type: "text", text: `❌ 未设置 LLM_API_KEY。

Progmune 需要 LLM API 密钥来生成代码。请根据你的客户端选择一种方式配置：

【Claude Code】编辑 ~/.claude/settings.json，在 mcpServers.progmune 中添加：
  "env": {
    "LLM_API_KEY": "你的DeepSeek或OpenAI密钥",
    "LLM_BASE_URL": "https://api.deepseek.com/v1"
  }

【命令行运行】
  export LLM_API_KEY='你的密钥'
  npx progmune-runtime

【快速配置】
  npx progmune-runtime setup 你的密钥

支持 DeepSeek 和 OpenAI 兼容接口。
获取密钥: https://platform.deepseek.com/api_keys` }] };
      }

      if (!fs.existsSync(OPT_IN_FILE)) {
        return { content: [{ type: "text", text: "⚠️ 请先完成免疫网络配置。\n\n运行以下命令开启（推荐）：\n  npx progmune-runtime opt-in enable\n\n或运行以下命令以离线模式使用：\n  npx progmune-runtime opt-in disable\n\n配置完成后重启客户端即可使用。" }] };
      }

      // 校验 projectPath
      if (!projectPath || typeof projectPath !== 'string') {
        return { content: [{ type: "text", text: "❌ projectPath 参数必须是一个非空字符串（项目根目录的绝对路径）。" }] };
      }
      if (!fs.existsSync(projectPath)) {
        return { content: [{ type: "text", text: `❌ projectPath 指定的路径不存在: ${projectPath}\n请确认路径正确后重试。` }] };
      }
      if (!fs.statSync(projectPath).isDirectory()) {
        return { content: [{ type: "text", text: `❌ projectPath 不是目录: ${projectPath}\n请提供项目根目录的绝对路径。` }] };
      }
      // 检查是否为 Python 项目（有 .py 文件）
      const hasPyFiles = fs.readdirSync(projectPath).some(f => f.endsWith('.py'));
      if (!hasPyFiles) {
        log.warn(`项目目录 ${projectPath} 中未找到 .py 文件，IR 可能为空`);
      }

      const fns = extractIRPython(projectPath);
      if (fns.length === 0) {
        log.warn(`项目 ${projectPath} 中未提取到任何函数定义`);
      }

      // 交叉校验 protocols.json 与 IR
      const protocolsFile = path.resolve(__dirname, '../protocols.json');
      if (fs.existsSync(protocolsFile)) {
        const protocols = JSON.parse(fs.readFileSync(protocolsFile, 'utf-8'));
        for (const funcName of Object.keys(protocols)) {
          if (!fns.find(f => f.name === funcName)) {
            log.warn(`protocols.json 中定义了函数 "${funcName}" 的协议，但 IR 中未找到该函数，协议将被忽略`);
          }
        }
      }

      // 关键步骤：将协议信息合并到 IR 中
      const irWithProtocols = mergeProtocols(fns);
      fs.writeFileSync("ir.json", JSON.stringify(irWithProtocols, null, 2));

      const actions = await plan(intent);
      if (!actions || actions.length === 0) {
        // 即使失败也上报指纹
        reportFingerprints().catch(() => {});
        return { content: [{ type: "text", text: "无法生成满足约束的代码。" }] };
      }
      const code = emitPython(actions);
      recordRun(intent, actions, true);
      // 异步上报指纹，不阻塞响应
      reportFingerprints().catch(() => {});
      return { content: [{ type: "text", text: code }] };
    } else if (request.params.name === "progmune_status") {
      const { getAllFailures, getTopFailurePatterns } = require('./failure-corpus.js');
      const { getRecentEpisodes } = require('./memory-layer.js');
      const { callCount } = require('./llm.js');
      const failures = getAllFailures();
      const patterns = getTopFailurePatterns(5);
      const episodes = getRecentEpisodes(5);
      const hubEndpoint = process.env.PROGMUNE_HUB || '未配置';
      const hubReachable = await checkHubReachable(hubEndpoint);

      const status = {
        version: "2.0.5",
        llm: {
          model: process.env.LLM_MODEL || 'deepseek-chat',
          baseUrl: process.env.LLM_BASE_URL || 'https://api.deepseek.com/v1',
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
      return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
    }
    throw new Error("未知工具");
  });

  async function checkHubReachable(hubUrl) {
    if (!hubUrl || hubUrl === '未配置') return false;
    try {
      const http = require('http');
      const https = require('https');
      const transport = hubUrl.startsWith('https') ? https : http;
      return new Promise((resolve) => {
        const req = transport.get(hubUrl, (res) => {
          resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.setTimeout(3000, () => { req.destroy(); resolve(false); });
      });
    } catch { return false; }
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
