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

// ========== 处理 opt-in 子命令 ==========
const args = process.argv.slice(2);
const OPT_IN_FILE = path.resolve(__dirname, '../.progmune_memory/opt_in.json');

if (args[0] === 'opt-in') {
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
    // 显示当前状态
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

// ========== MCP 服务器部分 ==========
const { plan } = require('./planner.js');
const { extractIRPython } = require('./extract-ir-python.js');
const { emitPython } = require('./python-emitter.js');
const { recordRun } = require('./feedback.js');

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
    }]
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === "progmune_generate") {
      const { intent, projectPath } = request.params.arguments;

      // 前置检查 LLM_API_KEY
      if (!process.env.LLM_API_KEY) {
        return { content: [{ type: "text", text: "❌ 未设置 LLM_API_KEY。请在终端执行：\nexport LLM_API_KEY='你的密钥'\n然后重启客户端。" }] };
      }

      // 前置检查免疫网络配置
      if (!fs.existsSync(OPT_IN_FILE)) {
        return { content: [{ type: "text", text: "⚠️ 请先完成免疫网络配置。\n\n运行以下命令开启（推荐）：\n  npx progmune-runtime opt-in enable\n\n或运行以下命令以离线模式使用：\n  npx progmune-runtime opt-in disable\n\n配置完成后重启客户端即可使用。" }] };
      }

      // 执行规划
      const fns = extractIRPython(projectPath);
      fs.writeFileSync("ir.json", JSON.stringify(fns, null, 2));
      const actions = await plan(intent);
      if (!actions || actions.length === 0) {
        return { content: [{ type: "text", text: "无法生成满足约束的代码。" }] };
      }
      const code = emitPython(actions);
      recordRun(intent, actions, true);
      return { content: [{ type: "text", text: code }] };
    }
    throw new Error("未知工具");
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
