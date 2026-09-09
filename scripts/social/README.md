# Progmune Social —— 每天 2 条：X（英文科普线程）+ 微博（中文短贴）

内容在 `content/x/dayN.json`（N=1..7，每条含 3-4 推的线程）与
`content/weibo/dayN.json`（单条中文）。排期映射：
Day1 周四 09-10 … Day7 周三 09-16（2026 本周）。

## 快速开始

```bash
# 1. 填凭据
cp scripts/social/.env.example scripts/social/.env   # 填入 X / 微博 / Dev.to token（见下）

# 2. 预览当天内容（不发）
node scripts/social/publish.js x 1 --dry-run
node scripts/social/publish.js weibo 1 --dry-run

# 3. 发当天（幂等：已发会跳过，--force 强制重发）
node scripts/social/publish.js x 1
node scripts/social/publish.js weibo 1
node scripts/social/publish.js all 1        # A 级两平台一起

# 4. 排期（每天自动 2 条）——本机 cron
bash scripts/social/install-cron.sh          # 幂等安装；时间可用
#   X_HOUR/X_MIN、WEIBO_HOUR/WEIBO_MIN 环境变量覆盖（默认 X 00:10 UTC、
#   微博 12:40 UTC）。日志 /tmp/progmune-social.log。

# 5. 检查某天是否今天、以及当天内容：node scripts/social/publish.js x today --dry-run
```

## B 级渠道（半自动：机器起草 → 人确认 → 发布）

- **Dev.to（有官方 API）**：建**草稿**（不公开），网页确认发布：
  ```bash
  node scripts/social/publish.js devto 1 --dry-run   # 预览文章
  node scripts/social/publish.js devto 1             # 建草稿（published:false）
  ```
  需要 `DEV_API_KEY`（dev.to/settings → API Keys）。已发草稿幂等记录。
- **掘金 / V2EX（无公开写 API）**：本地生成粘贴稿：
  ```bash
  node scripts/social/gen-drafts.js    # → scripts/social/drafts/{devto,juejin,v2ex}/
  ```
  人工在网页粘贴发布。drafts/ 已 gitignore。

## 事件型公告（C 级：自动起草 → 人审 → --go 才发）

```bash
node scripts/social/announce.js release --dry-run   # 打印中英双语公告草稿
node scripts/social/announce.js release --go all    # 人审通过后发送
```

自动从 `git log`（上个 tag 到 HEAD）拉要点；每次版本发布后跑。
公告记录在 state，不会重发。

## 把关策略（本项目约定）

- **日历内容（A/B 级日常贴）**：文案经人审一轮后，cron/脚本按表直发。
- **事件型公告**：一律先 `--dry-run` 人审，`--go` 才发。
- 对外口径护栏：数字只引已验证证据；边界（纯静态 / Beta / TLS 缺口）在
  模板中自动带上，机器不会自己吹牛。

## 凭据获取与权限（务必先读）

- **X**：developer.x.com 建 App → User authentication settings 勾选
  **Read and Write** → 生成 Access Token。四个值填入 `.env`：
  X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_SECRET。
- **微博**：open.weibo.com 建应用。⚠️ **风险提示**：`statuses/update`
  从 2018 年起收紧，普遍要求**企业认证 + 微博内容权限**；个人应用
  token 大概率被拒（常见 error 20019「禁止访问」/ 10006）。
- **Dev.to**：dev.to/settings/account → API Keys（读+写）。

## 幂等与安全

- 已发记录存 `scripts/social/.state/state.json`（gitignored），不会重发。
- 全部本地、无 SaaS 中转；发帖内容即 `content/` 下 JSON，先 `--dry-run`。
- 线程发布逐条间隔 1.5s 限速；X 免费层限额低，连续多天请留意 429。

## 内容口径（与项目对外叙事一致）

- 外部叙事 = "protocol lifecycle verification"；不吹免疫隐喻。
- 边界如实：纯静态、C/Go/Java 核心协议行注解驱动 Beta、TLS 级缺口公开。
- 数字只引已验证：TS 795 金标 / Python 729 / 13 框架真实语料 0 协议级 FP。
- 每周内容续写：在 content/ 下加 day8…，或按周一文案模板起新周。
