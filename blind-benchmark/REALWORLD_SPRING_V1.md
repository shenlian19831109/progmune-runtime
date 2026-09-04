# Real-World Spring v1 — Spring Boot 路由覆盖模型（真实语料 0 issues + 反证）

> 2026-09-02 — Java 语言支持里程碑 2。语料：gothinkster/spring-boot-
> realworld-example-app（vendored benchmarks/java-apps/spring-realworld，
> **1581★，Spring RealWorld 标准实现**：Spring Security + JWT filter +
> REST 控制器）。

## 真实认证架构（金标）

Spring 认证惯例 = **安全配置类集中声明**（非注解逐路由）：

```java
@Configuration @EnableWebSecurity
class WebSecurityConfig extends WebSecurityConfigurerAdapter {
  configure(HttpSecurity http) {
    http...authorizeRequests()
        .antMatchers(HttpMethod.OPTIONS).permitAll()
        .antMatchers("/graphiql", "/graphql").permitAll()
        .antMatchers(HttpMethod.GET, "/articles/feed").authenticated()
        .antMatchers(HttpMethod.POST, "/users", "/users/login").permitAll()   // register/login
        .antMatchers(HttpMethod.GET, "/articles/**", "/profiles/**", "/tags").permitAll()
        .anyRequest().authenticated();                                        // ← 兜底
  }
}
```

控制器：`@RestController` + 类级 `@RequestMapping(path)` + 方法级
`@*Mapping`/`@RequestMapping(path, method=POST)`（含静态导入 method=POST
形态）。**保护 = 规则序首个匹配者胜 + anyRequest 兜底。**

## 检测器结果（`src/frameworks/spring-detector.ts`）

| 项 | 值 |
|----|----|
| 文件 | 93 .java |
| 安全配置 | 1（规则 ×5 + catchAll authenticated） |
| 路由 | 19（12 mutation：9 受保护 + register/login 公开） |
| issues | **0**（0 协议级 FP；register/login 公开豁免 + 姊妹佐证） |

**反证**：把 `anyRequest().authenticated()` 翻成 `permitAll()` →
**10 issues 重现**（articles PUT/DELETE/POST/favorite/comments、PUT /user、
follow ×2 全浮现；register/login 仍豁免）——兜底翻转有反应，非空洞 0。

## 里程碑记录

- M1（commit `c97098a7`）：`extract-ir-java.ts` 纯 TS 提取器 +
  LANGUAGE_EXTRACTORS 注册 java + engine/evaluateTrust 语言分派
  （语料提取 92 方法）
- M2（本次）：spring-detector（安全规则序 + ant 模式匹配 + 控制器
  注解路由 + register/login 豁免）；回归测试 +5；接入 `audit:realworld`
  （`--framework spring` 一键考核：93f/19 路由/0）

## 状态与边界（如实）

- **Spring 路由覆盖适配器 → ✅ 真实语料验证**（证据档位，同 12/12）
- Java 核心 SSG（注解驱动协议行、JWT 生命周期等）尚在建设中——
  语言行标注「框架层验证、SSG 待建」不夸大
- ant 模式匹配覆盖 `*`/`**`；`requestMatchers`（新式 DSL）与
  SecurityFilterChain bean 形态待语料补充
