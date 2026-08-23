# Progmune WhatsApp 自动回复 Bot

零依赖 Node 服务（≥18，可直接部署）：WhatsApp Business Cloud API webhook + 关键词规则自动回复。

## 文件

- `server.mjs` — 全部逻辑（webhook 握手、关键词规则、Graph API 回复、签名校验）
- `Dockerfile` / `fly.toml` — Fly.io 部署模板
- 回复规则在 `server.mjs` 顶部 `RULES` 数组，按顺序首个命中生效（关键词小写包含匹配），改完重启即生效

## 一、Meta 侧注册（一次性，约 15 分钟）

1. **开发者账号**：https://developers.facebook.com/ 注册/登录 → 「My Apps」→「Create App」→ 类型选 **Business**（"Other" 里的 Business 类型），不关联业务账户也能继续
2. **开通 WhatsApp**：应用 Dashboard →「WhatsApp」→「API Setup」——得到：
   - **临时访问令牌**（Temporary access token，24h 有效，正式部署需换 System User 长期令牌，见下）
   - **Phone Number ID**（测试号码的 ID）
   - **测试号码**：把管理员的手机号加为测试号码，验证码加入——最多 5 个，测试模式下免费收发
3. **Webhook 配置**：应用 Dashboard →「WhatsApp」→「Configuration」：
   - Callback URL：`https://<你的域名>/webhook`
   - Verify token：自定义任意字符串（与服务端 `WHATSAPP_VERIFY_TOKEN` 一致）
   - 点「Verify and save」——服务端需已部署并响应握手
   - 「Webhook fields」订阅 **messages**
4. **（生产）长期令牌**：测试令牌 24h 过期。System User 路径：Business Settings → System Users → 创建 Admin 用户 → 添加资产（该 WhatsApp 应用）→ Generate Token（选 `whatsapp_business_messaging`、`whatsapp_business_management` 权限，永久有效）
5. **（生产）加群成员**：正式上线前任何用户都必须先在 Meta 后台加为接收方；**测试模式仅限 5 个测试号码**，够验证用

## 二、部署（Fly.io）

```bash
cd whatsapp-bot
fly launch        # 按提示；app 名随意（如 progmune-wa-bot）
fly secrets set \
  WHATSAPP_VERIFY_TOKEN=你的验证串 \
  WHATSAPP_ACCESS_TOKEN=你的令牌 \
  WHATSAPP_PHONE_NUMBER_ID=你的号码ID \
  WHATSAPP_APP_SECRET=应用密钥   # 可选：启用回调签名校验（App Dashboard → App secret）
fly deploy
```

部署后回 Meta 后台完成 webhook 验证，给测试号码发消息即可收到自动回复。

## 三、本地冒烟（不接真实 WhatsApp）

```bash
WHATSAPP_VERIFY_TOKEN=t WHATSAPP_ACCESS_TOKEN=x WHATSAPP_PHONE_NUMBER_ID=1 node server.mjs &

# 握手验证
curl "http://localhost:8080/webhook?hub.mode=subscribe&hub.verify_token=t&hub.challenge=abc123"
# → abc123

# 模拟收消息（回复会调 Graph API 失败——令牌是假的，日志可见规则命中）
curl -X POST http://localhost:8080/webhook -H 'Content-Type: application/json' \
  -d '{"entry":[{"changes":[{"value":{"messages":[{"type":"text","from":"8613800000000","text":{"body":"安装"}}]}}]}]}'
# 日志：[bot] replied to ... —— 规则命中即验证通过
```

## 注意

- WhatsApp 规则：用户发消息后 **24 小时内**才能回复（测试模式同样适用；本 bot 即时回复，天然满足）
- 免费层级有消息量限制（~250 条/天），正式商用需转正式号码
- 回复内容以仓库当前状态为准（版本号、覆盖率数字硬编码在 `RULES` 中，发版后记得同步）
