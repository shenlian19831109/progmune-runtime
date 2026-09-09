# Progmune Social —— 每天 2 条：X（英文科普线程）+ 微博（中文短贴）

内容在 `content/x/dayN.json`（N=1..7，每条含 3-4 推的线程）与
`content/weibo/dayN.json`（单条中文）。排期映射：
Day1 周四 09-10 … Day7 周三 09-16（2026 本周）。

## 快速开始

```bash
# 1. 填凭据
cp scripts/social/.env.example scripts/social/.env   # 填入 X / 微博 token（见下）

# 2. 预览当天内容（不发）
node scripts/social/publish.js x 1 --dry-run
node scripts/social/publish.js weibo 1 --dry-run

# 3. 发当天（幂等：已发会跳过，--force 强制重发）
node scripts/social/publish.js x 1
node scripts/social/publish.js weibo 1
node scripts/social/publish.js all 1        # 两个平台一起

# 4. 排期（每天自动 2 条）——见 schedule.cron.example
```

## 凭据获取与权限（务必先读）

- **X**：developer.x.com 建 App → User authentication settings 勾选
  **Read and Write** → 生成 Access Token。四个值填入 `.env`：
  X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_SECRET。
  验证：`node scripts/social/publish.js x 1 --dry-run` 只预览；
  首次真发前跑 `node -e "require('./scripts/social/lib/twitter.js').authCheck(process.env)"`
  （需先 export 或写 .env 后由 publish.js 的 auth check 完成）。
- **微博**：open.weibo.com 建应用。⚠️ **风险提示**：`statuses/update`
  从 2018 年起收紧，普遍要求**企业认证 + 微博内容权限**；个人应用
  token 大概率被拒（常见 error 20019「禁止访问」/ 10006）。拿到 token
  后先验证：
  `node -e "const e=require('fs').readFileSync('scripts/social/.env','utf8');const m={};e.split('\n').forEach(l=>{const q=l.match(/^([A-Z_]+)=(.*)$/);if(q)m[q[1]]=q[2]});require('./scripts/social/lib/weibo.js').authCheck(m).then(console.log).catch(e=>console.error('FAIL',e.message))"`
  失败即说明该 token 无发博权限——需企业应用或改用人工/第三方发布。

## 幂等与安全

- 已发记录存 `scripts/social/.state/state.json`（gitignored），不会重发。
- 全部本地、无 SaaS 中转；发帖内容即 `content/` 下 JSON，先 `--dry-run`。
- 线程发布逐条间隔 1.5s 限速；X 免费层限额低，连续多天请留意 429。

## 内容口径（与项目对外叙事一致）

- 外部叙事 = "protocol lifecycle verification"；不吹免疫隐喻。
- 边界如实：纯静态、C/Go/Java 核心协议行注解驱动 Beta、TLS 级缺口公开。
- 数字只引已验证：TS 795 金标 / Python 729 / 13 框架真实语料 0 协议级 FP。
- 每周内容续写：在 content/ 下加 day8…，或按周一文案模板起新周。
