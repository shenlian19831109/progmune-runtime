# P0 Rule Vocabulary Injection — Validation Gap Analysis

> **日期**：2026-08-03
> **背景**：3 轮 P0 注入完成，全部 21 个 namespace 现已有规则词汇。需要回答：实际检测能力是否提升？

---

## 1. 真实 C 代码触发扫描结果

扫描了 7 个 C 仓库（curl, libssh, nginx, redis, openssl, apache, nghttp2）中共 4,054 个函数名，匹配新增的 11 个协议检测器和 11 个 safeguard 规则：

### 可以触发（7/11 domains）

| Domain | 触发仓库 | 匹配函数数 | 评估 |
|--------|---------|-----------|------|
| **tls** | curl, libssh, nginx, openssl, apache | 28 fn | ✅ 强匹配 — C 网络库天然使用 TLS |
| **session_mgmt** | nghttp2, nginx, apache | 10 fn | ✅ 自然匹配 — HTTP/2 和 HTTP 服务器有会话管理 |
| **api_gateway** (rate limiting) | 全部 7 仓库 | 14 fn | ⚠️ 噪声高 — `block`/`connBlock` 多是连接阻塞，非频率限制 |
| **notification** | curl | 9 fn | ⚠️ 噪声高 — `create_*_message` 是认证消息构建，非通知发送 |
| **file_upload** | curl, nginx, nghttp2 | 7 fn | ⚠️ 部分有效 — `file_upload` 是测试函数，`ngx_file_size` 是文件元数据 |
| **resource** (input validation) | nginx, redis, apache | 3 fn | ✅ 有效 — `checkType`(redis) 和 `input_filter`(nginx) 是真正的输入验证 |
| **data_integrity** | openssl, apache | 2 fn | ✅ 有效 — `lookup` 是引用完整性检查 |

### 无法触发（4/11 domains）

| Domain | 原因 |
|--------|------|
| **payment** | 网络库不处理支付逻辑 |
| **registration** | 网络库无用户注册 |
| **supplier** | 网络库无供应商管理 |
| **dev_pipeline** | Progmune 内部流水线，C 库不涉及 |

---

## 2. 匹配质量分类

### 高信号匹配（可直接产生有效违规检测）

```
session_mgmt → nghttp2:
  nghttp2_session_new          → 创建会话
  session_call_on_frame_send   → 会话回调
  SSL_get0_session             → TLS 会话获取
  → 可检测: 会话创建后无 destroy/timeout

tls → curl/libssh:
  Curl_ssl_cf_get_config       → TLS 配置获取
  mbedtls_ssl_config_init      → TLS 初始化
  mbedtls_ecp_group_init       → ECC 参数初始化
  → 可检测: TLS 配置后无证书验证/无释放

resource → redis:
  checkType                    → 类型校验
  → 可检测: 输入校验链不完整（缺少 sanitize 或 range 校验）
```

### 低信号匹配（模式匹配但语义不匹配 — 预期 FP）

```
rate limiting → 全仓库:
  block, connBlock, curlx_nonblock → 这些都是 socket/IO 阻塞操作，非 API 限流
  → 预期 FP

notification → curl:
  Curl_auth_create_*_message → 认证消息构建，非通知投递
  → 预期 FP

file_upload → curl:
  file_upload → curl 测试套件中的函数名，非文件上传处理
  → 预期 FP
```

---

## 3. 关键结论

### 3.1 检测能力是否提升？

**对当前 C 基准（curl/libssh/nginx/redis）：有限提升。** 因为：
- 4 个 C 基准项目是网络库，不包含 payment/registration/supplier 业务逻辑
- Phase 1 实验已验证：P1 词汇注入增加了覆盖率但 Recall 未变，因为 "injected namespaces don't appear in C benchmark sequences"
- 新增的 session_mgmt 和 tls 规则可能对 nghttp2/apache/openssl 产生新检测，但这两个不在当前 Gold Benchmark 中

### 3.2 但这不是失败

- **session_mgmt** 在 nghttp2（HTTP/2 库）上有明确信号
- **tls** 在 curl/libssh/openssl 上有强信号（这些库的核心功能就是 TLS）
- **resource** 在 redis 上有信号（`checkType` 等）
- **data_integrity** 在 openssl 上有信号（`lookup`）

### 3.3 需要什么才能验证？

| 验证层次 | 方法 | 预计工作量 |
|---------|------|-----------|
| **A. 信号验证** | 对 nghttp2 运行 session_mgmt 检测器，人工审核结果 | 2 小时 |
| **B. 新基准扩展** | 将 nghttp2 + openssl 加入 Gold Benchmark（目前只有 curl/libssh/nginx/redis） | 1 天 |
| **C. 外部项目验证** | 找含 payment/registration 的 C 项目（如 Stripe C SDK、Apache HTTP Server 模块） | 2-3 天 |
| **D. 噪声抑制** | 分析低信号匹配，添加排除规则 | 1 天 |

---

## 4. 建议的下一步

### 立即（本日）

**A. 信号验证 — nghttp2 session_mgmt 精查**

nghttp2 是当前最强信号：有 4 个 `session_*` 匹配函数，且 `nghttp2_session_new` 和 `session_new` 触发了 "Session No Timeout" safeguard 规则。精查：
1. 提取 nghttp2 中触发 session_mgmt 的函数
2. 人工检查是否存在 "创建会话但未设置超时" 的真违规
3. 计算 Precision（TP/检出数）

### 短期（本周内）

**B. 扩展 Gold Benchmark**

将 nghttp2（含 session）和 openssl（含 TLS + data_integrity）加入 C Gold Benchmark，并标注：
- nghttp2: 标注 session_create → session_destroy 的配对
- openssl: 标注 TLS config → cleanup 的配对

**C. 噪声规则添加排除模式**

对已知低信号匹配（rate limiting 中的 `block`、notification 中的 `create_*_message`）添加排除词表，降低 FPR。

### 中期（双峰报告后）

**D. 寻找 payment/registration 的验证目标**

4 个无法触发的 domain 在现有 C 仓库中不存在。两种方案：
- **找 C 项目**：Stripe C SDK（payment）、Apache HTTP Server 模块（registration）、ERP 系统（supplier）
- **换语言验证**：在 TypeScript 项目中验证 payment/registration 规则（TS 项目有完整的 payment flow）
- **接受为 "理论覆盖"**：像 printlab_order/printlab_print 一样，标记为 "domain not applicable to current benchmark"，但不影响对适用项目的信任评分

---

## 5. 与双峰报告的关系

```
Two-Hump Diagnosis:
  Trivial Hump    (L1, 82.7%)  →  Regex-friendly, 已覆盖
  Missing Middle   (L2+L3)      →  规则词汇注入 ← 我们刚完成的
  Impossible Hump  (L4)         →  需要 CFG/数据流

当前状态:
  ✅ Trivial Hump  = 覆盖完整
  ✅ Missing Middle = 词汇注入完成 (0 → 21/21 namespaces)
  ⏳ Missing Middle = 验证中 (本报告)
  ❌ Impossible Hump = 未开始

双峰报告应说明:
  1. 词汇注入打破了自举死锁
  2. 7/11 新 domain 在真实 C 代码上有触发
  3. 但当前基准未覆盖的 domain (payment/registration/supplier)
     的 Recall 提升需要在其他项目上验证
  4. 下一步验证方向: nghttp2 session_mgmt, openssl tls
```
