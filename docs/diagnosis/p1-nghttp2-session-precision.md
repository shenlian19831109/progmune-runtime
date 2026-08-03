# P1: nghttp2 Session Management Precision Check

> **日期**: 2026-08-03
> **目标**: 区分 nghttp2 session_mgmt 检测中的 TP 和 FP

## 检测结果

### nghttp2（库代码）

| 函数 | Session No Timeout | 判定 | 理由 |
|------|-------------------|------|------|
| `session_new` | ❌ 缺 timeout | 🟡 **Lib FP** | nghttp2 库构造函数，timeout 通过独立 API `nghttp2_session_callbacks_set_send_timeout_callback()` 配置，不在 `new()` 中设置 |
| `session_inbound_frame_reset` | ❌ 缺 timeout | 🔴 **FP** | 内部帧处理器，重新创建会话用于帧重置——非用户面向函数 |

### curl（使用 nghttp2 的应用代码）

| 函数 | 判定 | 说明 |
|------|------|------|
| `cf_h2_ctx_open` | 🟢 **潜在 TP** | 打开 HTTP/2 上下文，设置了 send/recv callback 但**未设置 send_timeout callback** |
| `cf_h2_proxy_ctx_init` | 🟢 **潜在 TP** | 初始化 HTTP/2 代理上下文，同样缺少 timeout callback |

### nginx / apache

0 个 session trigger — 这些项目使用不同的会话管理模式（非 nghttp2 session API）。

## 分类：Library vs Application

```
Library code (FP pattern):
  session_new(), session_init() — 库构造函数
  *_frame_*, *_callback_*, *_internal_* — 内部函数
  → timeout 通过独立 API 配置，不在构造函数中

Application code (TP pattern):
  cf_h2_ctx_open(), login_handler() — 应用级入口
  → 如果创建会话但未配置 timeout → 真违规
```

## 需要的修正

### 方案 A：添加库模式排除列表（低投入）

```typescript
// 在 Session No Timeout 规则中添加库函数排除
const LIB_SESSION_PATTERNS = [
  /^session_new$/,           // nghttp2 构造函数
  /_frame_/,                 // 帧处理
  /_internal_/,              // 内部函数
];
```

### 方案 B：使用 context classifier（中投入）

根据函数所在文件的类型判断：
- 文件在 `include/` 或导出头文件中 → library
- 文件名含 `session.c`, `frame.c` → 库内部
- 文件在 `src/` 且是项目入口 → application

### 推荐

**方案 A 先行**（本周可做），方案 B 在 Gold Benchmark 扩展到 nghttp2 时一起做。

## curl HTTP/2 timeout callback 缺口

`cf_h2_ctx_open` 和 `cf_h2_proxy_ctx_init` 值得进一步调查：
- curl 是否有全局的 timeout 配置？
- `nghttp2_session_callbacks_set_send_timeout_callback` 是否在其他地方被调用？
- 如果的确缺失，这可能是 curl 的一个真实问题：HTTP/2 会话没有 send timeout

这需要一个 **cross-function 数据流检查**（L3 能力），当前 Progmune 的逐函数检查无法做到。
