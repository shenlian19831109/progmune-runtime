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
  （`REALWORLD_SPRING_V1.md`，deprecated WebSecurityConfigurerAdapter 形态）
- **现代方言验证（2026-09-05，`REALWORLD_SPRING_V2.md`）**：ali-bouali/
  spring-boot-3-jwt-security（Boot 3 教程标杆）——SecurityFilterChain
  bean + HttpMethod 静态导入 matchers + **String[] 变量数组白名单展开**
  （原保守跳过致公开 mutation 漏报）+ auth 词段豁免修复（authenticate/
  refresh-token）——15 路由全见、0 issues、摘兜底反证 5 重现；V1 语料
  复扫 0 无回归

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

## 提取器恢复率裁决（2026-09-05，AST 基准）

tree-sitter-java AST 基准对 spring-realworld 全量 .java 裁决（178 有 body
方法/构造器 + 1174 调用边，对齐 8000 字符截断口径）：

| 指标 | 修复前 | 修复后 |
|------|--------|--------|
| 方法恢复率 | 78.1% | **100%** |
| 调用边恢复率（有效） | 56.0% | **100%** |
| 精度 | 100% | **100%** |

三根因实测分解并修复（39 漏检全覆盖）：参数注解实参括号 34
（`@PathVariable("slug")` 打断 `[^)]*` → 字符串感知平衡括号扫描）、
通配符泛型 3（`ResponseEntity<?>` → type-part 补 `?`）、构造器 2
（无返回类型 → 可见性 + Name( 分支）；调用侧补泛型构造调用可见 +
super/this 过滤。回归 +5。**裁决：词法提取器成立，不引入 JavaParser
依赖**（详见 `blind-benchmark/REALWORLD_JAVA_ANNOTATION_V1.md`）。

## 真实语料协议行标注闭环（2026-09-05，3 注解 + 1 别名）

trust CLI 端到端（`--language java`）：未注解基线 0 违规 APPROVED；
标注后 10 违规 BLOCKED；修复变异 9（updateUser 直接位消失）；
v1 反证 +1（doFilterInternal 精确报出）。详见
`blind-benchmark/REALWORLD_JAVA_ANNOTATION_V1.md`。

## 接收者限定名匹配（2026-09-06，名碰撞根因修复）

- 提取器：`className` 捕获（嵌套类感知类名栈）+ 调用输出完整点链
  （多行点链/泛型静态调用/注释噪声一并修复——限定语义下 AST 基准
  恢复率 1216/1216 保持 100%）
- 注册层：Java 注解函数总是注册 `Class.method` 限定键；裸名键仅
  项目内唯一时注册（碰撞名只留限定键）
- 匹配层：精确匹配大小写不敏感；带点调用只走限定精确匹配（跳过
  规范化/词段形态——末段回退重造碰撞）
- 变量名≠类名：`.progmune_aliases.json` 桥接（注解合并后重校验加载）
- P4.6 内联深度恢复：call-sequence 限定调用末段回退解析（同文件优先 +
  接收者-类名双向后缀偏好；规则保留集大小写不敏感前置）——违规归因
  上移到入口（updateProfile），与 TS/Python 入口 flow 语义对齐
- 重测：原文 **1 违规 = 真实 TP、0 误报**（9 名碰撞消失，归因入口
  updateProfile）；修复变异 0；摘 getTokenString 反证 doFilterInternal
  精确报出

## 待办（真实语料金标，逐行转真）——2026-09-06 更新

1. ✅ **token 生命周期行**（v1）：真实语料闭环完成——getTokenString→
   getSubFromToken 抽取→验证链合法流 0 违规，摘 getTokenString 反证
   精确报出（变量名经项目别名桥接）
2. ✅ **认证/注册行**（v2）：真实 TP 捕获（updateUser 密码明文入库
   ——1581★ 参考实现真实 bug，修复变异违规即消）；名碰撞 9 FP 经
   接收者限定名匹配消除（重测 1 TP / 0 FP）
3. ⚠️ **资源管理行**（v3）：spring-realworld 无手工资源管理（MyBatis
   托管连接）——本语料无锚点，维持合成金标；待 NIO/文件处理语料

## 风险与边界（如实）

- 词法提取为近似（正则，无 JavaParser）——调用图用于序列候选；
  注解驱动的权威性靠人工金标校准（同 C REALWORLD_C 流程）
- Spring 生态方言多（Spring Security 新式 SecurityFilterChain bean /
  requestMatchers DSL / @PreAuthorize 注解级）——spring-detector 当前
  覆盖 WebSecurityConfigurerAdapter + antMatchers 形态；其余待语料补充
- Java 生产标签需要企业 POC 或更大语料集（同其余语言门槛）
