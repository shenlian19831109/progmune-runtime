# Progmune 治理报告 — PrintLab MVP

**项目：** PrintLab MVP（3D 打印电商平台）  
**日期：** 2026-08-12  
**引擎版本：** Progmune Runtime v3.2  
**治理结论：** **需要复审（NEEDS_REVIEW）** — Score 49/100

---

## 一、干了什么

Progmune 对 PrintLab MVP 的 **59 个源文件、4,568 次函数调用** 进行了三层验证：

| 验证层 | 检查了什么 | 结果 |
|--------|-----------|------|
| **SSG 状态机** | 144 条协议规则的 pre/post 状态转移是否被遵循 | 301 次调用匹配，43 条违规 |
| **Express 适配器** | 6 个 Express 应用、8 条路由的中间件链 | 1 个安全问题 |
| **协议安全检查** | JWT 算法白名单、跨域协议兼容性 | 2 条违规 |

---

## 二、发现了什么

### 得分卡

| 维度 | 得分 | 权重 | 说明 |
|------|------|------|------|
| 协议安全 | 78 | 30% | 43 条 SSG 状态机违规 |
| 治理完整性 | 70 | 15% | 账本注册表完整 |
| 验证覆盖 | 55 | 20% | 中等覆盖率 |
| 策略合规 | 12 | 35% | 检测到关键违规 |
| **总分** | **49** | — | **需要复审** |

### 违规分类

```
43 条 SSG 状态机违规:
  🔴 通知发送 (16): sendOrderStatusNotification 在 compose 之前被调用
  🔴 订单创建 (8):  createOrder 在 cost_estimate 之前被调用
  🟡 文件操作 (5):  fs.writeFileSync 在 open 之前被调用
  🟡 支付回调 (4):  verifyCallback 在 callback_received 之前被调用
  🟡 TLS 配置 (3):  server.listen 在 TLS 配置之前被调用
  🟡 文件上传 (3):  multer 上传在认证之前被调用
  🟢 其他     (4):  会话、注册相关

2 条协议安全检查:
  🔴 JWT 算法白名单 (2): jwtVerify 未指定允许的算法，存在 none 算法攻击风险

1 条 Express 安全问题:
  🟡 tRPC 认证模式 (1): Express 检测器未识别 tRPC 的 protectedProcedure
```

---

## 三、哪些可信、哪些需要注意

### ✅ 高可信发现

| 发现 | 为什么可信 |
|------|-----------|
| **通知发送顺序** | `sendOrderStatusNotification` 直接调用了 `nodemailer.sendMail`，但未先调用 `composeNotification` 来构建邮件内容。SSG 状态机要求 NOTIFICATION_COMPOSED → NOTIFICATION_SENT 的转移。 |
| **订单创建缺少成本估算** | 3D 打印涉及材料成本计算。`createOrder` 被调用时，`estimate_cost`（GCode 成本估算）未在流程中先执行。 |
| **支付回调签名验证** | 微信/支付宝回调中的 `verifyCallback` 要求 `PAYMENT_CALLBACK_RECEIVED` 状态。签名验证应该先于支付确认。 |
| **TLS 配置** | 开发服务器 `server.listen` 在 TCP 端口检查中未配置 TLS。在生产环境中通过反向代理解决。 |
| **JWT 算法白名单** | `jwtVerify` 调用未指定 `algorithms` 参数——这是真实的安全风险，攻击者可以通过 `none` 算法绕过签名验证。 |

### ⚠️ 需要人工确认

| 发现 | 为什么不确定 |
|------|------------|
| **文件操作顺序** | `fs.writeFileSync` 是 Node.js 便捷 API，它内部完成 open→write→close。SSG 状态机的 open_file→write_file→close_file 模式不适用于同步 API。**建议：排除同步 API 的别名。** |
| **tRPC 认证模式** | Express 检测器报告 `EXPRESS_NO_AUTH_MIDDLEWARE`，但实际上项目通过 tRPC 的 `protectedProcedure` 和 `adminProcedure` 进行认证。**这不是安全漏洞，是检测器对 tRPC 模式的未知。** |

---

## 四、推荐行动

| 优先级 | 行动 | 影响 |
|--------|------|------|
| 🔴 P0 | 在 `jwtVerify` 调用中添加 `algorithms: ['HS256']` 白名单 | 消除 JWT none 算法攻击风险 |
| 🟡 P1 | 确认订单创建流程中 cost_estimate 是否确实被跳过 | 3D 打印材料成本计算 |
| 🟡 P1 | 确认支付回调中 verifyCallback 的签名验证顺序 | 支付安全 |
| 🟢 P2 | 从别名表中移除 `fs.writeFileSync` 等同步 API | 减少 5 条误报 |
| 🟢 P2 | 为 tRPC 模式添加检测规则 | 消除 Express 检测器的 1 条误报 |

---

*本报告由 Progmune Runtime v3.2 自动生成。2026-08-12.*
