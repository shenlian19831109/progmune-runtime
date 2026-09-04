# Java Language Status — 决策记录（注解驱动 Beta 方向）

> 2026-09-02（3.7.17-18）。镜像 C（docs/c-language-status.md）与 Go 的
> 决策结构。真实语料：gothinkster/spring-boot-realworld-example-app
> （1581★，vendored benchmarks/java-apps/spring-realworld）。

## 决策

**Java 核心 SSG = 注解驱动（Beta 方向，同 C/Go）；框架层（Spring 路由
覆盖）已完成真实语料验证（✅，REALWORLD_SPRING_V1.md）。** 待协议行
金标建立后再定生产标签。

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

## 待办（协议行金标，逐个建立）

1. **token 生命周期行**：verify/before-use（getSubFromToken 先于
   setAuthentication；SecurityContext 读取前必须已验）
2. **认证/注册行**：login 校验（BCrypt matches）成功才发 token；
   register 密码 hash 后才入库
3. **资源管理行**：Connection/Response 关闭（realworld 数据访问层）

## 风险与边界（如实）

- 词法提取为近似（正则，无 JavaParser）——调用图用于序列候选；
  注解驱动的权威性靠人工金标校准（同 C REALWORLD_C 流程）
- Spring 生态方言多（Spring Security 新式 SecurityFilterChain bean /
  requestMatchers DSL / @PreAuthorize 注解级）——spring-detector 当前
  覆盖 WebSecurityConfigurerAdapter + antMatchers 形态；其余待语料补充
- Java 生产标签需要企业 POC 或更大语料集（同其余语言门槛）
