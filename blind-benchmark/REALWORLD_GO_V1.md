# Real-World Go Validation v1 — 三语料实验（3.7.13 评审后的裁决数据）

> 2026-09-02 — Go 语言支持上线后的第一次真实语料验证。
> 三语料设计（评审采纳版）：stdlib 测 FP 基线、govwa 测 B 路径 TP、
> 真实代码注解测 A 路径——对应 C 方法论的 V1 real-corpus + 盲测 + 金标。

## 实验 1：提取器恢复率（桥决策裁决——已完成）

词法（extractIRGo）vs go/parser（金标，同一文件集 + 只计有体函数）：

| 语料 | 恢复 | 率 |
|------|------|-----|
| net/http | 1176/1176 | 100.0% |
| crypto/tls | 340/340 | 100.0% |
| os | 780/780 | 100.0% |
| database/sql | 138/138 | 100.0% |

**裁决：维持纯词法，go/parser 桥推迟**（≥98% 阈值满分通过）。
过程中修复两处真实 bug：无体声明吞并（`//go:linkname` 声明把下一函数
吞进签名——Getuid/RoundTrip 漏检根因，与 C 3.7.4「# 行吞函数」同族）、
接收者方法 receiver 括号组误当参数组（returnType 取到整签名）。

## 实验 2：命名鸿沟（孵化器理论核心数据）

词段可桥接率（函数名能被 ≥2 规则词桥接到内置规则）：

| 语料 | 桥接率 |
|------|--------|
| net/http | 0.2% |
| crypto/tls | 0.0% |
| os | 1.9% |
| database/sql | 1.4% |

**Go stdlib 惯用命名无法桥接内置规则词汇——与 C 的命名鸿沟同构。**

## 实验 3：B 路径——未注解自动检测

| 语料 | 结果 |
|------|------|
| stdlib 四包（干净语料，FP 基线） | 4 flags 全 FP：`readColonFile` 词段桥接→read_file，open 与 read 分处不同函数窗口（跨函数窗口 FP 类，与 C 的 do_logout 同源；os/user/lookup_unix.go） |
| govwa（故意脆弱应用，TP 来源） | **0 flags**（SSG 静默——无注解无规则名命中，命名鸿沟的直接后果） |

**B 路径结论：Go 未注解自动检测 0 TP**——与 C 的历史数据同构。
孵化器理论再次被支持：未注解自动检测不是 Go 特有问题的解法；
注解驱动是普适路线。

## 实验 4：A 路径——注解驱动（demo-real-go-govwa）

govwa 真实代码（user.go / session.go / middleware.go 逐字）+ 3 注解：

| 真实函数 | 注解 | 语义 |
|---------|------|------|
| `loginAction` | pre=[UNAUTHENTICATED] → post=[PASSWORD_VERIFIED] | 凭证比对（checkUserQuery） |
| `SetSession`（接收者方法） | pre=[] → post=[AUTHENTICATED] | 登录完成（会话写入） |
| `AuthCheck`（接收者方法） | pre=[AUTHENTICATED] → post=[AUTHORIZED] | 路由鉴权中间件 |

结果：**真实代码 0 SSG FP；植入违规 `govwaNoAuthFlow`（未登录过守卫）
精确定位（AuthCheck 需 AUTHENTICATED）；合法流零违规；APPROVED 82**。

标注成本：**3 注解/认证协议**——与 C 的 ~2-3 收敛一致。

## 结论（Go 定位）

1. **Go = 注解驱动（Beta）维持**——B 路径 0 TP + 命名鸿沟 0-1.9% 双证据
2. **纯词法维持**——恢复率 100%，桥无提取精度依据
3. **孵化器路线适用 Go**：govwa 的 loginAction/AuthCheck 是真实库边界
   （httprouter 中间件模式）——Go 应用的别名/注解积累可以照搬 C 的机制
4. 待补（诚实）：真实 Go 项目的独立采纳案例（非演示非基准）——
   对应 C 的 uftpd 一步；govwa 是脆弱语料非采纳语料
