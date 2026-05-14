#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fs = require('fs');

// 加载编译后的 CommonJS 模块
const { plan } = require('./planner.js');
const { validateActionSequence } = require('./validator.js');
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
      
      // 1. 提取 IR
      const fns = extractIRPython(projectPath);
      fs.writeFileSync("ir.json", JSON.stringify(fns, null, 2));

      // 2. 规划动作
      let actions;
      try {
        actions = await plan(intent);
      } catch (e) {
        return { content: [{ type: "text", text: `规划失败: ${e.message}` }] };
      }

      if (!actions || actions.length === 0) {
        return { content: [{ type: "text", text: "Planner 返回空序列，可能是 LLM 输出异常或项目函数不足。" }] };
      }

      // 3. 校验动作序列
      const seqResult = validateActionSequence(actions);
      if (!seqResult.valid) {
        return { content: [{ type: "text", text: `校验失败: ${seqResult.errors.join("; ")}` }] };
      }

      // 4. 发射代码
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
