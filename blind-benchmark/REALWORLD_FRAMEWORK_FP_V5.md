# Real-World Framework FP v5 — Next.js：webhook 签名认证词表缺口 FP

> 2026-09-02 — 启发式探测器第五个真实数据点。语料与 v4（tRPC）同源：
> sadmann7/netflx-web（vendored benchmarks/ts-apps/netflx-web）——
> 该应用以 tRPC 为主、Next route 面窄（2 个 route.ts），故本数据点
> 标注样本少但 FP 类别具代表性（见结论）。v5 是第 2 个 FP 侧数据点，
> 机制与 v1 Express 不同：**认证词表语义缺口**（非会话式认证不可见）。

## 扫描结果（与金标对照）

| route.ts | 导出 | 检测器判定 | 金标（人工核实） | 标注 |
|----------|------|-----------|------------------|------|
| `app/api/users/stripe/route.ts` | POST | authCall ✓（getServerSession）→ 无 flag | `getServerSession(authOptions)` + 403 守卫 | ✅ 正确放过 |
| `app/api/webhooks/stripe/route.ts` | POST | **authCall ✗ → NEXT_ROUTE_NO_AUTH** | **Stripe 签名校验**（`stripe.webhooks.constructEvent(body, signature, STRIPE_WEBHOOK_SECRET)`）——webhook 的正确保护方式 | **FP** |

| 项 | 值 |
|----|----|
| middleware.ts | 无（该应用认证在 tRPC procedure + 路由内） |
| issues | **1**（webhook 路由） |
| 协议级 TP | **0/1** |

## 反证实验（临时骨架，不动语料）

| 输入 | issues |
|------|--------|
| E1 原文 | webhook 1 条 |
| E2 摘 `users/stripe` 的 getServerSession 守卫 | **session 路由也被报**（2 条）→ 对会话认证缺失有真敏感性 ✓ |
| E3 项目根加 `middleware.ts`（next-auth） | 0 条 → middleware 全局认证路径工作正常 ✓ |

## FP 根因：认证词表只认「会话式」检查

`AUTH_CALL_RE` 词表 = getServerSession/requireAuth/verifyToken/getToken/
withAuth/authenticate 等——全是**会话/中间件式登录态检查**。而 webhook
端点的标准保护是**载荷签名校验**（Stripe `constructEvent`、GitHub
`verify`、Twilio 等），语义上等价于认证但形态完全不同 → 词表不可见 →
**NEXT_ROUTE_NO_AUTH 系统性 FP**。

类别广度：**任何接 Stripe 支付的真实 Next.js 应用**（netflx/dub/cal.com
等）都带 `api/webhooks/stripe/route.ts` 这类文件——本 FP 不是孤例，
是该检测器在真实支付应用上的必然误报。

## 结论

- **Next.js 维持「启发式 ⚠️」有据（FP 侧，第 2 例）**：1 flag / 1 FP，
  协议级 TP 0/1。规则内核行为正确（E2 敏感性 ✓、E3 middleware 路径 ✓、
  session 路由正确放过 ✓）——缺口在认证形态词表
- 语料方法论第 5 次产出可修缺陷：**认证词表需扩展非会话式认证**
  （webhook 签名校验 constructEvent/verifySignature/webhookSecret、
  API-key/bearer 校验、clerk/next-auth v5 裸 `auth()` 形态——后者同样
  不在词表）
- 修复方向（增量，非重写）：AUTH_CALL_RE 补 webhook 签名类调用 +
  裸 auth() + clerk；AUTH_ENTRY 豁免补 `/webhooks/`、`/api/webhooks` 段
- 谱系：v1 Express FP 形态失配 / v2 Fastify 全盲 / v3 Koa 分类器串扰 /
  v4 tRPC 嵌套括号失明（首个 0 FP）/ **v5 Next.js webhook 词表缺口 FP**
