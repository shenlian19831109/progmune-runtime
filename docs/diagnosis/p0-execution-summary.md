# P0 Rule Vocabulary Injection — Execution Summary

> **日期**: 2026-08-03
> **状态**: 完成 → 进入验证阶段

## 完成的工作

### 代码变更
| 文件 | 变更 |
|------|------|
| `protocols.json` | 109 → 140 rules (+31)， 全部 21 namespace 有规则 |
| `trajectory-corpus.ts` | 18 → 31 library domains (+13) |
| `protocol-detector.ts` | 9 → 22 detectors (+13), 15 → 26 safeguard rules (+11) |
| `.progmune_corpus/trajectories/` | +86 条合成轨迹 (R1:22 + R2:20 + R3:44) |

### 覆盖度变化
```
注入前: 16/21 namespaces 零词汇
注入后:  0/21 namespaces 零词汇  ← 自举死锁已打破
```

### 新增文件
| 文件 | 用途 |
|------|------|
| `docs/diagnosis/two-hump-diagnosis-c-coverage.md` | 双峰诊断报告 |
| `docs/diagnosis/p0-validation-gap-analysis.md` | 验证缺口分析 |
| `src/inject-p0-vocabulary.ts` | R1 注入脚本 (含状态机验证) |
| `scripts/inject-round2.js` | R2 注入脚本 |
| `scripts/inject-round3.js` | R3 注入脚本 |
| `scripts/verify-coverage-delta.ts` | 覆盖率测量工具 |
| `scripts/scan-c-repos-for-new-domains.js` | C repo 域触发扫描 |

### C 基准回归
- **无回归**: v6→v7 F1 稳定在 ~28%，新规则未引入噪声

---

## 当前状态与下一步

### 已验证
- ✅ 全部 21 个 namespace 有规则词汇 + 轨迹覆盖
- ✅ 7/11 新 domain 在真实 C 代码上有触发
- ✅ C 基准无回归

### 待验证 (gap)
- 🔴 4 个 domain (payment, registration, supplier, dev_pipeline) 在 7 个 C 仓库中无匹配函数
  - 原因: 网络库不含这些业务逻辑
  - 方案: 在 TypeScript 项目中验证 (TS 项目有 payment/registration 流程)
- 🟡 部分 domain (api_gateway, notification, file_upload) 触发模式噪声偏高
  - 原因: 通用词 (block, upload, message) 导致误匹配
  - 方案: 添加排除词表，提高 pattern 精确度
- 🟡 session_mgmt safeguard 在 nghttp2 上触发但可能是 FP
  - 原因: 库代码 vs 应用代码的 timeout 管理不同
  - 方案: 添加 context 区分 (library vs application)

### 推荐下一步
1. **本周**: 在 TypeScript 项目中验证 payment/registration 规则 (TS 是 Progmune 主要语言)
2. **本周**: 精查 nghttp2 session_mgmt 检测结果，区分 TP/FP
3. **下周**: 将 nghttp2 + openssl 加入 Gold Benchmark
4. **双峰报告**: 纳入验证发现，说明 coverage ≠ detection 的差异
