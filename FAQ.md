# Progmune Runtime 常见问题 (FAQ)

## 安装与配置

### 如何获取 LLM API 密钥？

Progmune 需要 LLM API 密钥来生成代码。目前支持 DeepSeek 和 OpenAI 兼容接口。

**DeepSeek:**
1. 访问 https://platform.deepseek.com/api_keys
2. 注册账号并创建 API 密钥
3. 密钥格式：`sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

**OpenAI:**
1. 访问 https://platform.openai.com/api-keys
2. 创建 API 密钥
3. 设置环境变量 `LLM_BASE_URL=https://api.openai.com/v1` 和 `LLM_MODEL=gpt-4`

### 如何配置 API 密钥？

**方式一：MCP 客户端配置（推荐）**
在 `~/.claude/settings.json` 中：
```json
{
  "mcpServers": {
    "progmune": {
      "command": "npx",
      "args": ["progmune-runtime"],
      "env": {
        "LLM_API_KEY": "你的密钥",
        "LLM_BASE_URL": "https://api.deepseek.com/v1"
      }
    }
  }
}
```

**方式二：环境变量**
```bash
export LLM_API_KEY="你的密钥"
npx progmune-runtime
```

**方式三：快速配置命令**
```bash
npx progmune-runtime setup 你的密钥
```

### 如何验证安装是否成功？

```bash
# 检查版本
npx progmune-runtime --version

# 检查 MCP 工具列表（需在 MCP 客户端中）
# 应看到 progmune_generate、progmune_trust_check、progmune_score 等 19 个工具

# 运行内置测试
npx progmune-runtime test
```

### 为什么浏览器打不开仪表板？

如果运行 `open http://localhost:8080/` 无效：

1. **确认 Hub 服务器正在运行：**
   ```bash
   curl http://localhost:8080/api/dashboard
   ```
   如果返回 JSON 数据，说明服务器运行正常。

2. **手动在浏览器打开：**
   - 在地址栏输入 `http://localhost:8080/`
   - 注意使用 `http://` 而非 `https://`（本地服务器不支持 HTTPS）

3. **端口冲突：**
   - 默认端口 8080，可通过 `PORT` 环境变量修改
   - 检查是否有其他程序占用：`lsof -i :8080`

## 使用问题

### MCP 配置失败怎么办？

**症状：** Claude Code 提示 "MCP server progmune not found"

**排查步骤：**
1. 确认 `~/.claude/settings.json` 中配置格式正确
2. 确认 Node.js >= 18 已安装：`node --version`
3. 尝试手动启动验证：`npx progmune-runtime`
4. 检查 Claude Code 日志中是否有错误信息

**症状：** 调用 `progmune_generate` 返回 "未设置 LLM_API_KEY"

即使已在终端 `export` 了密钥，MCP 子进程也可能无法继承。必须在 `settings.json` 的 `env` 字段中显式配置。

### 如何开启免疫网络上报？

```bash
# 开启（推荐）
npx progmune-runtime opt-in enable

# 关闭
npx progmune-runtime opt-in disable

# 查看状态
npx progmune-runtime opt-in status
```

开启后，每次代码生成的脱敏错误指纹会自动上报到中央免疫服务器。

### 如何部署中央免疫服务器？

```bash
# 启动本地 Hub
cd progmune-runtime
node server/hub.js

# 设置环境变量让 MCP 服务器自动上报
export PROGMUNE_HUB=http://localhost:8080/report
```

仪表板访问：`http://localhost:8080/`

## 错误与调试

### "无法生成满足约束的代码"

这意味着 LLM 生成的代码未能通过 Progmune 的约束校验（SVL-1~4）。常见原因：

1. **IR 为空：** 项目目录中没有提取到函数定义。确认 `projectPath` 指向包含 `.py` 文件的目录。
2. **LLM 输出不符合格式：** DeepSeek/OpenAI 返回了非预期的格式。重试通常可以解决。
3. **SSG 协议违规：** 生成的代码跳过了必要的业务步骤。错误信息会提示缺失的步骤。

### "函数 'xxx' 不存在"

这是 SVL-1 符号存在性校验的拦截。说明 LLM 幻觉调用了一个项目中不存在的函数。这是 Progmune 的正常保护行为。

### 如何查看运行状态？

通过 MCP 调用 `progmune_status` 工具，返回 JSON 格式的运行状态，包括：
- LLM 模型和调用次数
- 免疫网络状态（Failure Corpus 统计）
- 抗体效能统计
- Trust Engine 版本
- Ranker 状态

## 技术细节

### Progmune 支持哪些语言？

目前验证和代码生成以 **TypeScript/JavaScript** 为第一优先级（F1=85.2%）。**Python** IR 提取就绪，验证规则开发中（Phase 2 优先）。**C** 为研究阶段（F1=16.5%）。Go、Java 规划中。

### 数据隐私如何保障？

上报到中央免疫服务器的数据**只包含**：
- 函数名序列（如 `verify_password → generate_jwt`）
- SVL 违规级别
- 约束类型

**绝不包含**：
- 代码片段
- 变量值
- 文件内容
- 用户数据

### 如何贡献？

欢迎通过 GitHub Issues 提交"看似合法但实际危险"的生成案例，帮助我们完善语义状态图（SSG）协议。
