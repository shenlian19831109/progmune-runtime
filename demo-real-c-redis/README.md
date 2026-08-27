# demo-real-c-redis — 注解驱动真实项目演示

真实 redis 7.x ACL 模块（`benchmarks/redis/src/acl.c` 逐字函数体）+ `@progmune` 注解，
验证「注解驱动」是 C 生产化的现实形态。详见 `blind-benchmark/REALWORLD_C_V2.md`。

## 文件

- `acl_auth.c` — 真实 redis 函数（authCommand / ACLAuthenticateUser / checkPasswordBasedAuth /
  ACLCheckUserCredentials / ACLCheckAllPerm）+ 3 条注解 + 合法演示入口
  `handle_authed_command`（authenticate → perm-check）
- `acl_auth_broken.c` — 同函数同注解 + 植入违规 `handle_monitor_no_auth`
  （未认证直接做权限检查，经典 missing-auth-check bug，CVE 类模式）

## 注解设计（3 条覆盖 auth 协议）

| 真实函数 | 注解 | 真实语义 |
|---------|------|---------|
| `ACLCheckUserCredentials` | `pre=["UNAUTHENTICATED"], post=["PASSWORD_VERIFIED"]` | 密码哈希比对（verify 原语） |
| `checkPasswordBasedAuth` | `pre=[], post=["AUTHENTICATED"]` | `c->authenticated = 1` 的真实位置（establish 原语） |
| `ACLCheckAllPerm` | `pre=["AUTHENTICATED"]` | 权限检查仅认证后可用 |

标注成本：**auth 协议 = 3 条注解**（authCommand 本身无需注解——它是入口，状态机验证其调用链）。

## 运行

```bash
# 依赖：npm run build（src/trust/engine.ts 含演示逼出的两处修复）
node -e "
const { evaluateTrust } = require('./dist/trust/engine.js');
const { extractProjectIR } = require('./dist/extract-project-ir.js');
// 对每个变体：extractProjectIR → 写 ir.json → evaluateTrust（见 REALWORLD_C_V2.md 复现脚本）
"
```

## 结果（引擎修复后）

| 变体 | 判定 | 分数 | 违规 |
|------|------|------|------|
| acl_auth.c（真实代码 + 注解） | **APPROVED** | 85 | 0 |
| acl_auth_broken.c（植入 missing-auth-check） | APPROVED + 1 medium 违规 | 82 | `ACLCheckAllPerm` cannot be called in `[UNAUTHENTICATED]`, required `[AUTHENTICATED]` |

> 如实记录：违规检出与归因正确，但单条 medium 违规在当前决策阈值下不翻转
> APPROVED——决策阈值层的独立议题（见 REALWORLD_C_V2.md），不在本演示范围。

## 演示逼出的两个引擎问题（已修，零漂移验证）

1. **CamelCase 注解规则不可触达**：真实 C 命名（`ACLCheckAllPerm`）注册的规则，任何匹配策略都
   够不到（normalize 只作用于调用名、词段匹配要求 ≥2 下划线词段）→ 注解合并时同步注册
   normalized 形态（加性，snake_case 注解无变化）。
2. **注解合并晚于序列构建**：有函数体的注解原语（`checkPasswordBasedAuth`）被内联掉、
   post 状态永不生效 → 合并移到 `extractCallSequencesFromProject` 之前
   （与盲测 harness `scan-protocol-python` 先合并后建序列的语义对齐）。

## 已知边界（如实记录）

- establish 原语内部（`ACLCheckUserCredentials` → `c->authenticated = 1`）的函数内顺序
  状态机不检查——注解定义的是**函数间**协议顺序；`c->authenticated = 1` 是赋值不是调用，
  状态机天然看不见（不修：L4 能力边界，见 REALWORLD_C_V2.md 摩擦记录）。
- ~~fixPath 输出规则名~~ 已修复：displayName 机制让修复建议直接输出真实函数名
  （`Insert before the violating call: checkPasswordBasedAuth`）。
