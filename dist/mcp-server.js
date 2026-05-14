import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fs = require('fs');

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
      name: "generate_verified_code",
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
    if (request.params.name === "generate_verified_code") {
      const { intent, projectPath } = request.params.arguments;
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
