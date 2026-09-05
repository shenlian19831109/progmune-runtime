# Java Language Status — 决策记录（注解驱动 Beta 方向）

> 2026-09-02（3.7.17-18）。镜像 C（docs/c-language-status.md）与 Go 的
> 决策结构。真实语料：gothinkster/spring-boot-realworld-example-app
> （1581★，vendored benchmarks/java-apps/spring-realworld）。

## 决策

**Java 核心 SSG = 注解驱动（Beta 方向，同 C/Go）；框架层（Spring 路由
覆盖）已完成真实语料验证（✅，REALWORLD_SPRING_V1.md）；核心协议行
（token/auth/register/resource）已引擎化并经引擎回归锁定（v1-v3，
3.7.21）。** 生产标签需企业 POC 或更大语料集（同其余语言门槛）。

## 证据

### 框架层（已完成 ✅）
- `spring-detector.ts`：安全配置规则序 + ant 模式 + 控制器注解路由——
  19 路由/12 mutation 全解析、0 issues、anyRequest 兜底翻转反证 10 重现

### 核心层（本记录依据）
1. **提取器 + 调用图已通**（3.7.17-18）：`extract-ir-java.ts` 纯 TS
   词法（零依赖）——139 方法 / 664 调用边（spring-realworld）；JWT
   认证链可提取为序列：
   `doFilterInternal → getTokenString → jwtService.getSubFromToken →
   SecurityContextHolder.getContext().getAuthentication →
   … → setAuthentication`
2. **无注解自动检测不适用**（同 C/Go 首测 0-TP 的机理）：Java 无
   命名级协议信号；Spring Security 的授权在配置类/过滤器链，annotation
   与 controller 分离——纯名字/正则检测无可靠锚点。镜像 C/Go 决策：
   **未注解代码不做核心协议行检测**（避免空谈检出率）
3. 注解约定：沿用 C 注释式（`// @requires: …` / `/* @produces … */`
   等），由注解合并通道（P4.5/别名孵化器）读取——跨语言同一机制

## 协议行引擎化（2026-09-02，evaluateTrust 全自动跑）

提取器现输出 FunctionInfo.protocol（`// @protocol namespace=… pre_states
=[…] post_states=[…]`，方法前注释行级收集）+ 调用边（calls，零宽后视），
引擎 java 语言分派 → 注解合并 → SSG 序列验证**全自动**（同 C 路径）：

- **v1 token 生命周期**：`authenticate`(→AUTHENTICATED) 先于
  `performAdminAction`(需 AUTHENTICATED)——违规流（未认证直接 use）被
  SSG_ 精确定位（engine 回归锁定）
- **v2 auth/register**：`hashPassword`(→PASSWORD_HASHED) 先于
  `storeUser`(需 PASSWORD_HASHED)——registerBad（未 hash 入库）被定位
- **v3 resource 管理**（3.7.21）：`openFile`(→RESOURCE_OPEN) /
  `writeData`(需 RESOURCE_OPEN) / `closeFile`(需 RESOURCE_OPEN +
  `invalidate=["RESOURCE_OPEN"]`，命名空间 resource 命中
  RESOURCE_NAMESPACE_RE 泄漏端检查)——三个违规方向全部定位：
  ① 未 open 直接 write（缺前置态）② **use-after-close**（invalidate
  摘除后复用的形态验证）③ open 不 close（end-state 泄漏，fix 给出
  释放调用 closeFile）
- 提取器顽疾修复链（本次）：注释内正则开吃/重叠吞头/@Override 误滤/
  嵌套实参调用序——现规则：注释行级收集 + `(` 行起点守卫 + lookbehind；
  嵌套实参（storeUser(u, hashPassword(p))）词法序≠求值序——金标夹具
  用顺序语句规避（如实记录）
- 引擎回归 +8（token v1 ×2 + auth v2 ×2 + resource v3 ×4）

## Spring 方言扩展（2026-09-02）

- matcher 名扩展：antMatchers → 兼容 **requestMatchers**（SecurityFilterChain
  bean + authorizeHttpRequests 新式 DSL）
- **类级 @PreAuthorize/@Secured**：类声明头命中 → 该类全部方法受保护
- 回归 +3（spring-detector 8 green）；语料复扫 0 不变

## 待办（真实语料金标，逐行转真）

1. ✅ **token 生命周期行**（合成金标已引擎化，v1）——真实语料行待标注
2. ✅ **认证/注册行**（合成金标已引擎化，v2）——真实语料行待标注
3. ✅ **资源管理行**（合成金标已引擎化，v3，含 invalidate/泄漏端）——
   真实语料行待标注（spring-realworld 数据访问层 Connection 关闭）

## 风险与边界（如实）

- 词法提取为近似（正则，无 JavaParser）——调用图用于序列候选；
  注解驱动的权威性靠人工金标校准（同 C REALWORLD_C 流程）
- Spring 生态方言多（Spring Security 新式 SecurityFilterChain bean /
  requestMatchers DSL / @PreAuthorize 注解级）——spring-detector 当前
  覆盖 WebSecurityConfigurerAdapter + antMatchers 形态；其余待语料补充
- Java 生产标签需要企业 POC 或更大语料集（同其余语言门槛）
