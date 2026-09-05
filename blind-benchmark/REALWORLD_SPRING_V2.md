# Real-World Spring v2 — 现代方言验证（SecurityFilterChain bean + requestMatchers + 变量白名单）

> 2026-09-05 — Java 语言支持里程碑 3。语料：ali-bouali/spring-boot-3-jwt-security
> （vendored benchmarks/java-apps/spring-jwt-boot3，Boot 3 教程标杆，JWT +
> SecurityFilterChain bean 新式 DSL——与 V1 语料 gothinkster 的 deprecated
> `WebSecurityConfigurerAdapter` 形态互补）。

## 语料安全配置（现代方言三形态）

```java
private static final String[] WHITE_LIST_URL = {"/api/v1/auth/**", "/v3/api-docs", ...};  // ① 变量数组白名单

@Bean
public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
    http.csrf(AbstractHttpConfigurer::disable)
        .authorizeHttpRequests(req -> req
            .requestMatchers(WHITE_LIST_URL).permitAll()                          // ① 变量引用
            .requestMatchers("/api/v1/management/**").hasAnyRole(ADMIN.name(), MANAGER.name())
            .requestMatchers(GET, "/api/v1/management/**").hasAnyAuthority(...)   // ② HttpMethod 静态导入
            .anyRequest().authenticated());                                       // ③ 兜底
}
```

## 检测器结果（修复后）

| 项 | 值 |
|----|----|
| 文件 | 32 |
| 路由 | 15（与实际控制器映射逐一吻合） |
| issues | **0** |

## 修复轮（两缺口，各带回归测试 + 真实语料重测）

1. **String[] 变量数组白名单展开**：`requestMatchers(WHITE_LIST_URL)` 原被
   保守跳过（不豁免）——但跳过方向错误：路由落到兜底 authenticated 被
   建模为受保护，**白名单公开 mutation 被掩盖漏报**。修复：解析本文件
   `static final String[] NAME = {...}` 声明并展开变量引用（List.of/
   跨文件常量待语料补充）。反证：变量改名 → 公开 mutation 漏报复现
   （单元回归锁定）。
2. **auth 词段豁免缺口**：白名单展开后 `/api/v1/auth/authenticate`、
   `/api/v1/auth/refresh-token` 两个公开 mutation 被报（真实登录/刷新
   入口 = FP）——词表无 authenticate/token，且 `refresh(-token)` 连字符
   形态未覆盖。修复：词段前缀 + `[-/]` 边界（同 hapi AUTH_ENTRY_WORDS
   口径）。反证：兜底 permitAll 翻转仍触发 5 issues（books POST + admin
   POST/PUT/DELETE），0 非空洞。

## 反证汇总

| 变异 | issues |
|------|--------|
| 原文 | **0** |
| 摘 `anyRequest().authenticated()` 兜底 | 5（books POST + admin ×3 + 1）|
| 白名单变量改名（展开失明） | 公开 mutation 漏报（单元回归） |

## 里程碑记录

- M3（本次）：现代方言真实语料验证——SecurityFilterChain bean 解析、
  HttpMethod 静态导入 matchers、变量数组白名单展开、auth 词段豁免修复；
  回归 +3（spring-detector 11 green），全框架 165 green；
  V1 语料复扫 0 不变（无回归）
