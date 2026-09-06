# Real-World Java Annotation v1 — 真实语料协议行标注闭环（spring-realworld）

> 2026-09-05 — Java 注解驱动协议行的第一个真实语料闭环。语料：
> gothinkster/spring-boot-realworld-example-app（1581★，vendored
> benchmarks/java-apps/spring-realworld）。方法：真实代码打 `// @protocol`
> 注解 → `trust CLI --language java` 端到端 → 合法流 0 违规 + 反证 +
> 真实 TP。**同时收录提取器恢复率裁决（AST 基准 100%/100%）与
> 名碰撞边界（Java 注解模型待办方向）。**

## 一、提取器恢复率裁决（tree-sitter-java AST 基准）

| 指标 | 修复前 | 修复后 |
|------|--------|--------|
| 方法（有 body 的方法/构造器） | 78.1%（139/178） | **100%（178/178）** |
| 调用边（去重集合，8000 字符截断内） | 56.0%（有效） | **100%（1174/1174）** |
| 精度 | 100% | **100%** |

三根因（实测归类，39 漏检全部分解）：

1. **参数注解实参括号（34/39）**：`@PathVariable("slug")` 内层 `)` 打断
   扁平 `[^)]*` 参数匹配 → 参数区改字符串感知平衡括号扫描
2. **通配符泛型返回类型（3/39）**：`ResponseEntity<?>` 的 `?` 不在
   type-part 字符类 → 字符类补 `?`
3. **构造器（2/39）**：正则要求返回类型，构造器无类型 → 新增
   可见性 + Name( 分支；同行 `@Autowired` 旧 @ 行守卫误杀一并移除

调用侧两处：`new HashMap<String, Object>()` 泛型构造调用不可见 →
callRe 补可选 `<…>` 类型实参组；`super(`/`this(` 构造调用 → 过滤。
回归 +5（`extract-ir-java.test.ts` 10 green），引擎 Java v1-v3 19 green
无回归，全框架 153 green。**裁决：词法提取器在真实语料上成立，无需
引入 JavaParser 依赖（与 C 恢复率 100% 裁决同级别）。**

## 二、协议行标注闭环（3 条注解 + 1 个别名文件）

| 注解 | 位置 | 语义 |
|------|------|------|
| `getTokenString` → post `[TOKEN_EXTRACTED]` | JwtTokenFilter（真实方法） | v1 抽取 |
| `getSubFromToken` → pre `[TOKEN_EXTRACTED]` post `[AUTHENTICATED]` | DefaultJwtService（真实方法） | v1 验证（verify_token 语义） |
| `User.update` → pre `[PASSWORD_HASHED]` post `[PASSWORD_UPDATED]` | User（真实方法） | v2 入库前哈希 |
| `.progmune_aliases.json`: `encode → hash_password` | 项目别名 | 库调用桥接（全语料唯一 `.encode(` 点） |

### 结果

| 运行 | SSG 违规 | 判定 |
|------|----------|------|
| 未注解基线 | 0 | APPROVED（85）——注解驱动静默，符合设计 |
| 标注后原文 | 10 | BLOCKED（51） |
| 修复变异（updateUser 内先哈希） | 9 | updateUser 直接位 **2→1 消失** ✓ |
| v1 反证（摘 getTokenString） | 11 | **doFilterInternal 新增违规** ✓ |

### 三、真实 TP：updateUser 密码明文入库（1581★ 参考实现的真实 bug）

`UserService.updateUser` 把请求原文密码直接传给 `user.update(...)`，
`User.update` 内 `this.password = password` **无哈希**；REST 与 GraphQL
登录路径均 `passwordEncoder.matches(raw, stored)`（BCrypt 格式校验）——
**用户改完密码后明文入库、且无法再登录**（matches 对明文必然失败）。

标注后引擎在 updateUser 上精确报出（`"update" requires states
[PASSWORD_HASHED] but current registration state is [UNAUTHENTICATED]`），
修复变异（`passwordEncoder.encode(...)` 前置于 update）后该违规消失——
**真实 TP + 修复即消，敏感性双向验证**。

### 四、名碰撞边界 → 已解决（2026-09-06，接收者限定名匹配）

规则名按函数名注册 + 调用名取末段时：`User.update` 的规则名 `update`
命中语料内**全部** `.update(` 调用点（article.update ×2、userMapper.update、
articleMapper.update 及传播放大）→ 10 违规中 **1 为真实 TP，9 为名碰撞
误报**（文章内容更新不涉密码）。根因：Java 服务层惯用通用名
（save/update/encode），末段名匹配 + 按名注册规则在 Java 上系统性碰撞
（TS/C/Go 语料的协议函数名均有区分度，未暴露此边界）。

**已修复**（接收者限定名匹配，三处共享路径改动 + 恢复率复测 100%）：
1. 提取器捕获 `className`（嵌套类感知的类名栈）+ 调用输出完整点链
   （`user.update`/`article.update` 分流；多行点链、泛型静态调用、
   注释噪声一并修复——AST 基准恢复率 1216/1216 保持 100%）
2. 注册层：Java 注解函数总是注册 `Class.method` 限定键；裸名键仅项目内
   唯一时注册（碰撞名只留限定键）
3. 匹配层：精确规则名匹配大小写不敏感；带点调用只走限定精确匹配
   （跳过规范化/词段形态——末段回退会重造碰撞）
4. 变量名≠类名（`jwtService.` vs `DefaultJwtService`）：项目别名文件
   桥接（`.progmune_aliases.json`，注解合并后重校验加载）

**重测**（trust CLI 三态）：原文 **1 违规 = updateUser 真实 TP、0 误报**；
修复变异 0（违规即消）；摘 getTokenString 反证 doFilterInternal 精确报出
（`jwtService.getSubFromToken` → `DefaultJwtService.getSubFromToken`）。
回归：engine 21 green（新增两类碰撞测试）、ssg-bridge 32、extract-ir-java
16、全框架 165。

### 五、v3 resource 行：语料无手工资源管理

spring-realworld 数据访问为 MyBatis + Spring 托管连接，源码中无
open/use/close 形态（grep Connection/InputStream/.close() 无命中）——
**v3 资源行在本语料无真实锚点**，维持合成金标验证（引擎回归锁定），
真实语料标注待有手工资源管理的 Java 项目（如 NIO/文件处理服务）。

### 六、结论

- v1 token 行：**真实闭环完成**（合法 0 + 反证精确定位，变量名经
  项目别名桥接）✅
- v2 register 行：**真实 TP 捕获 + 修复敏感性验证 + 名碰撞消除**
  （接收者限定名匹配后 1 TP / 0 FP）✅
- v3 resource 行：本语料无锚点，维持合成验证 ⚠️
- 提取器：恢复率/精度 100%/100%（限定语义下 AST 基准复测）✅
