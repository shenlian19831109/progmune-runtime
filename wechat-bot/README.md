# Progmune 微信公众号自动回复 Bot

零依赖 Node 服务（≥18，可直接部署）：微信公众号开发者模式 webhook + 关键词规则自动回复。与 `whatsapp-bot/` 同架构、同规则（双端规则保持同步，改一端记得改另一端）。

## 文件

- `server.mjs` — 全部逻辑（微信签名校验、AES 加解密、关键词规则、被动回复、关注欢迎语、二维码图片素材）
- `Dockerfile` / `fly.toml` — Fly.io 部署模板
- 回复规则在 `server.mjs` 顶部 `RULES` 数组，按顺序首个命中生效（关键词小写包含匹配），改完重启即生效
- 「群」指令：配置 `WEIXIN_APP_SECRET` 后回复**社区二维码图片消息**（微信 + WhatsApp 群码合成图，见仓库 `assets/community-qr.png`）；未配置则回文字版指引

## 一、公众号侧配置（一次性，约 20 分钟）

1. **注册公众号**：https://mp.weixin.qq.com/ — 个人可注册**订阅号**（免认证即可用本 bot 的被动回复；客服消息等高级接口需认证服务号，本 bot 不依赖）
2. **开通开发者模式**：公众号后台 →「设置与开发」→「基本配置」→ 服务器配置 →「修改配置」：
   - **URL**：`https://<你的域名>/webhook`（微信要求公网可访问的 80/443 端口）
   - **Token**：自定义任意字符串（与服务端 `WEIXIN_TOKEN` 一致）
   - **EncodingAESKey**：点「随机生成」（43 位，保存好，与服务端 `WEIXIN_AES_KEY` 一致）
   - **消息加解密方式**：选**安全模式**（生产推荐，服务端已实现 AES 解密与加密回包）；本地冒烟或低风险场景可选**明文模式**（不配 `WEIXIN_AES_KEY`）
   - 提交前需先完成第二步部署（微信会立即发起 GET 校验，服务端需已上线并响应握手）
3. **启用**：校验通过后点「启用」——**启用后公众号后台的「自动回复」设置停用，由本服务接管**（删除/停用后台自动回复规则，避免语义冲突）
4. **（可选）IP 白名单**：公众号后台「基本配置」→「IP 白名单」加入服务器公网 IP（本 bot 仅被动回复、不主动调接口，一般不需要）

> 微信群二维码 **7 天过期**，公众号二维码 **永久有效**——建议把公众号二维码也放进仓库 README「社区与反馈」章节（扫码关注即触发欢迎语，输入「帮助」查看全部指令）。

## 二、部署（Fly.io）

```bash
cd wechat-bot
fly launch        # 按提示；app 名随意（如 progmune-mp-bot）
# WEIXIN_APP_ID 可选：安全模式校验/加密回包、图片素材上传需要（后台「基本配置」可见）
# WEIXIN_APP_SECRET 可选但推荐：「群」指令回二维码图片消息需要（后台「基本配置」→ 开发者密码，查看需管理员扫码）
fly secrets set \
  WEIXIN_TOKEN=你的验证串 \
  WEIXIN_AES_KEY=你的43位密钥 \
  WEIXIN_APP_ID=你的AppID \
  WEIXIN_APP_SECRET=你的开发者密码
fly deploy
```

> 若复制多行命令报 `could not parse secrets` 之类的错（反斜杠续行/行尾注释在粘贴时被打乱），改为**单行**执行：
> `fly secrets set WEIXIN_TOKEN=你的验证串 WEIXIN_AES_KEY=你的43位密钥 WEIXIN_APP_ID=你的AppID WEIXIN_APP_SECRET=你的开发者密码`

部署后回公众号后台完成服务器配置校验，用微信向公众号发消息即可收到自动回复。

**「群」指令图片消息说明**：bot 启动后自动从仓库拉取 `assets/community-qr.png`（合成双群二维码图，可用 `WEIXIN_QR_IMAGE_URL` 覆盖），上传为公众号**临时素材**（3 天有效，到期自动重传），用户发「群」即回图片。**微信群码 7 天过期**——更新仓库 `assets/wechat-group.png` 后重新生成合成图并推送 GitHub 即可自动换新图。

## 三、本地冒烟（不接真实微信）

```bash
WEIXIN_TOKEN=t PORT=8080 node server.mjs &

# 1) 服务器配置校验（signature=sha1(sort([token, timestamp, nonce]))）
TS=$(date +%s); NONCE=123456
SIG=$(node -e "const c=require('crypto');process.stdout.write(c.createHash('sha1').update(['t','$TS','$NONCE'].sort().join('')).digest('hex'))")
curl "http://localhost:8080/webhook?signature=$SIG&timestamp=$TS&nonce=$NONCE&echostr=abc123"
# → abc123

# 2) 模拟收文本消息（明文模式；回复为 XML，含规则命中内容）
curl -X POST http://localhost:8080/webhook \
  -H 'Content-Type: text/xml' \
  -d '<xml><ToUserName><![CDATA[gh_test]]></ToUserName><FromUserName><![CDATA[o_test_user]]></FromUserName><CreateTime>123</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[安装]]></Content><MsgId>1</MsgId></xml>'
# → <xml>...<Content><![CDATA[安装使用：...</Content>...</xml>

# 3) 模拟关注事件（欢迎语）
curl -X POST http://localhost:8080/webhook \
  -H 'Content-Type: text/xml' \
  -d '<xml><ToUserName><![CDATA[gh_test]]></ToUserName><FromUserName><![CDATA[o_test_user]]></FromUserName><CreateTime>123</CreateTime><MsgType><![CDATA[event]]></MsgType><Event><![CDATA[subscribe]]></Event></xml>'
# → 欢迎关注 Progmune ...
```

## 注意

- 微信被动回复须在 **5 秒窗口内**同步回包——本 bot 纯内存规则匹配，天然满足；超时用户会看到「该公众号暂时无法提供服务」
- **安全模式**回包同样需要加密（服务端已实现）；明文模式仅建议本地冒烟用
- 免费订阅号每日群发次数有限，但**被动回复/关注欢迎语不受群发限制**
- 回复内容以仓库当前状态为准（版本号、覆盖率数字硬编码在 `RULES` 中，发版后记得同步，并与 `whatsapp-bot/server.mjs` 保持一致）
