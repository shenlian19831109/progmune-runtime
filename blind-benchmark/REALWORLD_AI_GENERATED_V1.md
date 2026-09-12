# REALWORLD_AI_GENERATED_V1 — AI 生成项目真实语料验证（TypeScript）

> 日期：2026-09-10 ｜ 语料：**every-app/open-seo**（⭐18.2k，真实生产 SaaS，AI 工程师工作流构建）
> 方法学：REALWORLD 系列（真实项目 + 生产管线扫描 + 逐条人工标注）
> 复现：`git clone --depth 50 https://github.com/every-app/open-seo.git`，commit `3632f40`

## 一、项目画像

| 维度 | 值 |
|---|---|
| 规模 | 619 .ts + 302 .tsx = **921 个 TypeScript 文件** |
| 形态 | 生产级 SEO SaaS：Stripe 计费、OAuth（Google/Cloudflare Access）、多租户组织、MCP server |
| AI 生成证据 | CLAUDE.md + AGENTS.md（AI agent 编码规范）+ .agents/skills（agent 技能库）；Every 公司公开故事（AI 工程师构建）；README 自述 "Fork and vibe code your own custom tool" |
| 提交形态 | 人类提交、AI 写码的 vibe-coding 标准形态（48 commits @bensenescu，正规 PR 流） |
| 协议相关性 | 认证（Cloudflare Access JWT / 自托管 Google OAuth / 多租户权限）+ 支付（Stripe checkout/billing）——**协议生命周期验证的理想靶场** |

## 二、扫描结果

```
Trust Score: 56 / Decision: BLOCKED / Confidence: HIGH
违规：10 条 medium（0 critical / 0 high）
Coverage: 0%（协议词汇 lookup 命中率 15%，LLM 语义映射兜底 1147 次）
```

## 三、逐条标注（10/10 全 FP + 1 个漏报的真相）

| # | 规则 | 报告位置 | 判定 | 人工核实依据 |
|---|---|---|---|---|
| 1 | PROTOCOL_CROSS_DOMAIN | alchemy.run.ts `resolveSelfHostAccess` | **FP** | Cloudflare Access/Workers 部署配置脚本，DNS/DoH 与 Auth 术语共现是配置语义，非协议违规 |
| 2 | JWT_UNSAFE_ALGORITHM | src/server.ts `authorizeChatAgent` | **FP** | 纯路由委派函数（switch → authorizeSamChat/OnboardingChat），无任何 JWT 代码 |
| 3 | JWT_UNSAFE_ALGORITHM | src/server.ts `handleFetch` | **FP** | 同上，无 JWT 内容 |
| 4 | JWT_UNSAFE_ALGORITHM | middleware/ensureUser.ts `ensureUserMiddleware` | **FP** | 该文件 grep 无 jwt/verify/algorithm 任何匹配 |
| 5 | PROTOCOL_CROSS_DOMAIN | ga4.ts `setGa4Property`（LDAP and HTTP） | **FP** | 文件内**不存在** "LDAP" 字符串——词段切分/LLM 映射伪影 |
| 6 | PLAINTEXT_AUTH_WITHOUT_TLS | ga4.ts `disconnectGa4` | **FP** | 权限中间件 + Google OAuth API（HTTPS），无明文凭据传输 |
| 7 | PROTOCOL_CROSS_DOMAIN | gsc.ts `setGscSite`（Authentication and FTP） | **FP** | 同上类伪影 |
| 8 | PLAINTEXT_AUTH_WITHOUT_TLS | gsc.ts `disconnectGsc` | **FP** | 同 #6 |
| 9 | JWT_UNSAFE_ALGORITHM | selfHostedOAuth.ts `handleSelfHostedGoogleOAuthCallbackRequest` | **FP** | 用的是 `crypto.subtle.verify`（OAuth state 校验），不是 JWT |
| 10 | PLAINTEXT_AUTH_WITHOUT_TLS | Ga4Service.ts `disconnect` | **FP** | 同 #6 |

## 四、关键发现（比 FP 计数重要得多）

### 发现 1：检测器「定位错位」——真缺口漏报，假位置误报

**真正的 JWT 加固缺口没被报出来**：`src/middleware/ensure-user/cloudflareAccess.ts:78`：

```ts
({ payload } = await jwtVerify(token, jwks, {
  issuer: teamDomain,
  audience: policyAud,
}));
```

jose 的 `jwtVerify` **没有指定 `algorithms` 白名单**（最佳实践应显式 `algorithms: ["RS256"]`）。实际风险低（Cloudflare Access JWKS 仅 RS256 密钥），但这是 JWT_UNSAFE_ALGORITHM 规则**语义上要抓的目标**——规则报了 4 个没有 JWT 代码的位置，却没报这个真有 JWT 验证的位置。**根因假设**：规则对 `jwtVerify` 的触发词依赖走了词段/LLM 映射层，而对真实调用点的函数归属（jwtVerify 在哪个函数里）发生了错位。

### 发现 2：Coverage 0% = 协议词汇对「现代 SaaS 认证形态」不匹配

open-seo 不用传统 username/password/verify_password 形态——用 Cloudflare Access JWT、自托管 Google OAuth、多租户权限中间件。引擎的协议词汇（auth 命名空间原语）**几乎全部靠 LLM 翻译兜底（1147 hits）命中**。这是「AI 生成项目的真实协议形态」与「我们规则词汇」之间的鸿沟证据——正对应「现代认证形态」的规则面缺口。

### 发现 3：AI 生成代码的质量信号（营销金矿）

921 个文件的 vibe-coded 生产代码，10 条违规全部是引擎的 FP——**没有发现真实协议违规**。这本身是个正向信号（AI 生成代码 + 严格的 agent 规范 = 协议纪律），但同时也是警示：我们的引擎在「高质量 AI 生成代码」上目前主要产出噪声。诚实的叙事素材：「我们扫了 18k star 的 AI 生成生产项目——发现引擎自己的 10 个误报和 1 个它没抓到的真实加固点」。

## 五、对引擎与产品的启示

1. **JWT 规则修复（P1 引擎工作）**：`jwtVerify` 调用点的精确定位——从「含 jwt 词汇的函数」改为「实际调用 jwtVerify 的函数」（IR 调用序列已有此信息）。修复后可预期 4 条 FP 消失 + 真实点被报。
2. **PROTOCOL_CROSS_DOMAIN 词汇伪影治理（P2）**："LDAP"/"FTP" 类伪域来自词段切分与 LLM 映射的组合误差——需要把「跨域共现」限定在已注册协议原语上，而非映射后的猜测标签。
3. **PLAINTEXT_AUTH_WITHOUT_TLS 对 OAuth 形态的豁免（P2）**：Google OAuth client 库的凭证处理（HTTPS API）不应触发「明文传输」——3 条 FP 同根因，加 OAuth 库边界豁免。
4. **现代认证形态的规则面缺口（P1 产品）**：Cloudflare Access / 自托管 OAuth / 多租户权限的协议原语词汇需要补充——否则对现代 SaaS 的覆盖率只能靠 LLM 兜底。
5. **营销素材**：本报告即是「真实语料 FP 数据点」方法学在 AI 生成项目上的首个数据点，可成为内容日历素材（诚实叙事：我们扫了 AI 生成的生产代码，如实报告我们的噪声）。

## 六、后续（用户指示：一个语言先一个项目）

- ✅ TypeScript：open-seo 已完成
- ⏭ Python：AI 生成 Python 项目（候选：stardustai 系列或搜 "AI agent" 标记的 FastAPI/Django 项目）
- ⏭ Go/C：AI 生成项目较稀少，可放宽为「AI 辅助」标记
