# Changelog

## [3.7.13] — 2026-09-02

### Go 语言支持 + Gin/Fiber 框架适配——12/13

- **Go IR 提取器**（`src/extract-ir-go.ts`，纯 TS 词法——与 C 提取器同哲学：零外部工具链，npm 安装态可用，不重蹈 Python 桥的安装态覆辙）：func 签名（多行/接收者方法）、调用提取（obj.Method() 取 Method）、注释注解 `// @progmune(...)` + 文档标签、exported=首字母大写、vendor/testdata/*_test.go 表面过滤、Go 关键字排除、反引号 raw string 掩码；8 个单测
- **注册表接入**：LANGUAGE_EXTRACTORS 第 4 语言（detect .go → extractIRGo）→ extractProjectIR/evaluateTrust 全链路自动生效；**引擎 autoExtractor 补 go**（修复 Go 项目静默走正则回退的同类陷阱——首轮金标全错暴露）
- **Go 协议盲测 v1**（`scan-protocol-golang.ts`，自包含生成+扫描）：3 干净（直连/方法/helper）× 3 植入违规（missing_auth/read_without_open/leak）——**TP 5 / FP 0 / FN 0 → P=100% / R=100%**
- **Gin（第 11 个）**：`gin-detector.ts`——GIN_ROUTE_NO_AUTH（r.POST 中间件链 + Use/Group 组级认证）；Go 方法名大写（r.POST）正则 i 标志修复；"middleware" 词误撞修复（loggerMiddleware 类工具中间件≠认证）
- **Fiber（第 12 个）**：`fiber-detector.ts`——FIBER_ROUTE_NO_AUTH（app.Post 中间件链 + Use）；同款修复
- **引擎**：collectGinViolations/collectFiberViolations（Go 目录结构特殊：cmd/internal/pkg + 根目录 main.go）+ ginCoverage/fiberCoverage
- **文档**：Go 语言行 ❌→✅ 注解驱动（Beta）（README 双语/矩阵双语/CLAUDE.md/落地页 + i18n）；框架 **12/13** 口径（剩余 Spring Boot 需 Java 支持先行）
- **验证**：23 个新单测（Go 提取器 8 + Gin 8 + Fiber 7）；全套件 **204/204**；Python 盲测 v1.2 64 零漂移；C 演示不变；check 免疫正常

## [3.7.12] — 2026-09-01

### Koa + Hapi 框架结构适配——10/13

- **Koa（第 9 个）**：`src/frameworks/koa-detector.ts`（代码串级，镜像 express/koa 中间件模式）——`KOA_ROUTE_NO_AUTH`：mutation 路由注册中间件链无认证名中间件，且文件内无认证 `app.use` 全局中间件；认证名按词表分类（auth/login/permission/jwt/verify/guard…）；GET 读操作与认证入口路径豁免
- **Hapi（第 10 个）**：`src/frameworks/hapi-detector.ts`（路由配置模式）——`HAPI_ROUTE_NO_AUTH`：mutation 路由 options 无 auth 字段或显式 `auth: false`（显式公开 mutation 检出）；`auth: 'strategy'` / `auth: { strategy: 'x' }` 两种形态均识别为受保护；`auth.strategy` 声明被记录
- **引擎接线**：collectKoaViolations / collectHapiViolations + overall `koaCoverage`/`hapiCoverage`（加性 best-effort）；frameworks barrel 补全（11 个适配器模块）
- **验证**：15 个新单测（koa 7 + hapi 8，含显式 auth:false 与 strategy 对象形态）；引擎冒烟：Koa 全局认证中间件 0 误报 APPROVED 90、Hapi 无 auth 路由检出 + login 豁免 APPROVED 87；全套件 **181/181**；Python 盲测 v1.2 64 零漂移
- **文档**：10/13 口径（README 双语/覆盖矩阵双语/CLAUDE.md/落地页 + Koa/Hapi 矩阵行）
- **边界（如实）**：文件级窗口（跨文件全局中间件不可见，与 Express 检测器同款）；认证中间件按名词语汇识别；Hapi 路由窗口 500 字符（超长配置截断）

## [3.7.11] — 2026-09-01

### NestJS 补全——框架适配 8/13

- **三缺口补全**（`src/frameworks/nestjs-detector.ts`）：
  ①**全局 APP_GUARD 守卫识别**——@Module providers 的 `{ provide: APP_GUARD, useClass: X }`（装饰器参数与类属性两种形态）→ 全局认证守卫存在时 mutation 路由不再误报；
  ②**@Public()/@SkipAuth()/@AllowAnon() 豁免装饰器**（类级+方法级）——全局守卫模式下的公开路由标记；**显式绕过全局守卫的 mutation 路由 → NESTJS_NO_AUTH**（消息注明绕过的是哪个全局守卫）；
  ③**守卫名认证分类**——ThrottlerGuard/RateLimit/Logger 等非认证守卫不再算认证（限流≠认证，实测误报源）
- **引擎接线升级**：collectNestJSViolations 从 per-file 切 **项目级一次装载**（analyzeNestJSProject）——全局守卫与 @Public 需要跨文件上下文，per-file 分析无法识别全局守卫（系统性误报根因）；coverage.filesScanned 口径改为分析单元=项目
- **合成金标**（`generate-projects-nestjs.ts` + `scan-protocol-nestjs.ts`）：6 项目（类级守卫/全局 APP_GUARD+@Public login/无守卫/显式绕过/ThrottlerGuard 非认证/敏感 GET 公开）——**TP 12 / FP 0 / FN 0 → P=R=100%**
- **验证**：6 个新单测（含 @Public login 在全局守卫下不报）；引擎冒烟 N2 APPROVED 87（全局守卫正确识别）、N4 BLOCKED（显式绕过 critical 拦截）；全套件 166/166；Python 盲测 v1.2 64 零漂移；C 演示不变
- **文档**：NestJS ⚠️ 部分 → ✅ 结构分析（README 双语/覆盖矩阵双语/CLAUDE.md/落地页「8/13 专用检测器」口径）

## [3.7.10] — 2026-09-01

### 安装态 Python 全链路修复（npm 包正确性）

- **修复**：`tools/extract_ir.py` + 三个框架扫描器（`extract_framework_py.py` / `extract_framework_django.py` / `extract_framework_flask.py`）加入 npm 包 `files` 白名单——**此前安装态（MCP 主产品形态）的 Python IR 提取与框架结构扫描全部静默失效**（脚本不在包内，execSync 失败被 best-effort 吞掉）。M1/M2 验证时发现的既有遗留，非 3.7.8/3.7.9 引入
- **安装态端到端验证**（此前从未有过）：打包 tarball → 临时目录 npm install → 用安装态的 dist 跑 evaluateTrust——FastAPI 合成项目检出 `FASTAPI_ROUTE_NO_AUTH`（框架扫描生效）、Python 盲测项目检出 SSG 违规（IR 提取生效）、**安装态与仓库态 A/B 完全一致**；`tools/__pycache__` 未入包（files 精确文件路径）
- **落地页**：语言覆盖现状更新入版（C 注解驱动 Beta 行 + 框架适配 7/13 行 + 双语 i18n + 证据链接）
- 包体：377 文件（+4 个 .py，约 71.5KB）

## [3.7.9] — 2026-08-28

### Flask / Fastify / Next.js 框架结构适配（M4——框架适配 7/13）

- **Flask（Python 第 3 个）**：`tools/extract_framework_flask.py`（@app.route/@bp.route + methods kwarg、认证装饰器、before_request 认证守卫、Blueprint）+ `src/frameworks/flask-detector.ts`（`FLASK_ROUTE_NO_AUTH`——mutation 路由无认证装饰器且无认证 before_request 守卫）——合成金标 4 项目 P=R=100%；vendored flask 库结构识别冒烟通过；修复 before_request 误放 Assign 节点（应为 Expr 表达式语句）
- **Fastify（TS 第 3 个）**：`src/frameworks/fastify-detector.ts`（代码串级，镜像 express-detector——路由注册 + preHandler/preValidation 认证选项 + addHook 认证钩子；`FASTIFY_ROUTE_NO_AUTH`）；引擎冒烟：钩子保护正确识别（0 误报）；8 个单测
- **Next.js（TS 第 4 个）**：`src/frameworks/nextjs-detector.ts`（App Router 文件级结构——route.ts 的 POST/PUT/PATCH/DELETE 导出 + next-auth/自定义认证调用 + 认证 middleware；`NEXT_ROUTE_NO_AUTH`）——7 个单测；pages/api 旧式 handler 方法不可静态区分（只计数如实）；修复注释内 `app/**/route.ts` 的 `*/` 提前终止块注释陷阱
- **引擎接线**：collectFlaskViolations / collectFastifyViolations / collectNextjsViolations + overall 三个 coverage 字段——全部加性 best-effort；frameworks/index.ts barrel 补 5 个适配器导出
- **验证**：新单测 21 个；全相关套件 160/160；Python 盲测 v1.2 64 零漂移；fastapi/django realworld 0 FP 保持；C 演示不变
- **边界（如实）**：Flask 认证 before_request 按函数名词汇识别（自定义名漏判=漏报方向）；Fastify 代码串级（配置展开不可见）；Next.js 只盯 API 面（route.ts/pages-api，页面组件不检查）；npm 安装态 tools/ 不在包内→Python 框架扫描静默降级（既有遗留）

## [3.7.8] — 2026-08-28

### Django / DRF 框架结构适配（M2）——框架适配第 4 个

- **结构提取（Python AST）**：`tools/extract_framework_django.py`（与 extract_ir.py / extract_framework_py.py 解耦）——urlpatterns 解析（url()/path()/re_path() → FBV / CBV .as_view() / include）、FBV 登录装饰器（login_required/permission_required/staff_member_required/user_passes_test + 自定义 *auth* 装饰器）、CBV 基类与方法（View/generics + LoginRequiredMixin 等混入）、DRF permission_classes（AllowAny/IsAuthenticated/其他类名）与 @api_view（methods + permission_classes kwarg）
- **检测规则**（`src/frameworks/django-detector.ts`）：
  - `DJANGO_VIEW_NO_AUTH`——mutation 视图无保护：FBV 按动词名门控（add/create/update/delete/transfer 等——信息页 home/robots/error 不报）；CBV 按方法含写操作（post/put/patch/delete/create/update/destroy）+ 无认证装饰器/无 LoginRequiredMixin
  - `DRF_PERMISSION_BYPASS`——DRF 视图写方法 + 显式 AllowAny / 空权限类（非认证入口端点）
  - 认证入口词汇豁免（login/signin/regist/token/health 等，视图名+URL 名+pattern）
- **引擎接线**：`collectDjangoViolations`（仅 Python，best-effort）+ `overall.djangoCoverage`——加性零漂移
- **合成金标**（`generate-projects-django.ts` + `scan-protocol-django.ts`）：FBV/CBV/DRF × clean/V1/V2/V2b/V1V2 = 8 项目——**TP 6 / FP 0 / FN 0 → Precision 100% / Recall 100%**
- **真实应用验证**：django-realworld（15 路由结构全识别：DRF generics + permission_classes 接线、RegistrationAPIView/LoginAPIView AllowAny 正确豁免）——**0 FP**；PyGoat 133 路由结构全识别，适配器 2 条 flags 均为故意脆弱 lab（csrf_transfer_monei_api / DoItFast）——如实记录；fastapi-realworld 0 FP 保持
- **修复（子串陷阱）**：`registration` 不含 `register` 子串、`register` 不含 `registr` 子串——认证入口词干统一为 `regist`（FastAPI/Django 两检测器同步）+ 回归测试锁定
- **验证**：19 个新单元测试（django-detector 10 + fastapi 豁免回归）；套件 139/139；Python 盲测 v1.2 64 零漂移；C 演示 SSG 结果不变
- **边界（如实）**：FBV 无法静态区分 HTTP 方法（动词名门控口径，非方法级）；include() 递归不展开（被 include 的应用 urls.py 单独成文件时已覆盖）；自定义 permission 类视为保护（保守）

### FastAPI 框架结构适配（M1）——框架适配第 3 个

- **结构提取（Python AST）**：`tools/extract_framework_py.py`（与 extract_ir.py 解耦，零风险）——路由（@app.get/@router.post/@r.api_route）、依赖注入（Depends()/Security()，含 Annotated[...] 订阅、嵌套调用解析、**装饰器级 dependencies=[...]**（realworld 风格）、认证方案声明（OAuth2PasswordBearer/HTTPBearer/APIKeyHeader 等 8 类）、全局中间件；跳过 tests/deps/venv 等非生产目录
- **检测规则**（`src/frameworks/fastapi-detector.ts`，结构提取与规则判定解耦）：
  - `FASTAPI_ROUTE_NO_AUTH`——写操作路由（post/put/patch/delete）无认证依赖且非认证入口端点（login/register/token/health 词汇豁免）→「每个 API 入口都有门禁」的精确形态；公开读（GET）不检查（realworld 的 tags/文章列表就是公开 GET——只盯 mutation 面把误报压到最低）
  - `FASTAPI_DEAD_AUTH_SCHEME`——声明了认证方案但没有任何路由引用（认证设施是死的，装饰性声明）
- **引擎接线**：`collectFastapiViolations`（仅 Python 项目跑 python3 扫描；best-effort 永不阻断评估）+ `overall.fastapiCoverage`（apps/routes/filesScanned/issuesFound）——加性零漂移
- **合成金标**（`generate-projects-fastapi.ts` + `scan-protocol-fastapi.ts`，镜像 generate-projects-python 方法论）：3 结构风格（直连/APIRouter/认证方案）× 4 违规变体（clean/V1 无认证写路由/V2 死方案/V1V2）= 12 项目——**TP 13 / FP 0 / FN 0 → Precision 100% / Recall 100%**
- **真实应用验证**：fastapi-realworld（19 路由全结构识别：签名 Depends 与装饰器 dependencies= 两种认证接线风格）——**0 FP**；django-realworld/django-unicorn 无 FastAPI 结构 → 适配器静默直通（结果不变）
- **零漂移**：Python 盲测 v1.2 64 违规零漂移；C 演示 SSG 结果不变；相关套件 128/128（含 fastapi-detector 9 个新回归）
- **边界（如实）**：全局中间件不视为认证（add_middleware 通常是 CORS；自定义认证中间件结构不可见）；Depends 目标按 auth-like 词表+方案引用判定（无数据流分析）；npm 安装态下 tools/ 不在包内 → 框架扫描与既有 Python IR 提取一样静默降级（安装态 Python 全链路为既有遗留问题，不随本版引入新差异）

## [3.7.7] — 2026-08-28

### C 注解采纳体验（采纳生死线工具）

- **注解建议引擎**（`src/annotation-suggest.ts`）：确定性启发式（无 LLM）——按函数名词汇（3.7.6 金标 5/5 真实注解反推的词表）× 已注解状态，生成原语注解候选（verify/establish/guard/open/close 角色 + 命名空间/状态转移/注释块模板/置信度/命中理由/掩蔽风险标记）；已注解、规则名、外部函数自动排除；两遍计算 maskRisk（体内调用规则原语或本批同被建议函数）
- **CLI 扫描模式**（`scripts/c-annotate.js --scan <dir> [--write] [--all] [--include-resource]`）：dry-run 默认；--write 自动插入函数定义上方（写入后自动刷新 ir.json 防陈旧）；保守门控（全部实测依据）：establish/掩蔽风险跳过（不提供强制开关）、open/close 跳过（--include-resource 强制）
- **引擎加性字段**：`evaluateTrust.annotationSuggestions`（仅 C 生成；TS/Python 无该字段——零漂移）
- **验收（REALWORLD_C_V7.md）**：无注解 uftpd 副本金标恢复率 **4/4 角色正确**（check_user_pass=verify / handle_PASS=establish / do_RETR / do_STOR=guard）；自动应用 7 条后与手写金标**等价**（真实代码 0 SSG FP、植入违规 2/2 精确定位、NEEDS_REVIEW 72 同分）
- **三个实测安全发现（自动写入的门控依据）**：①掩蔽风险——establish 注解把手握违规的流函数变「原语」（函数内顺序不检查）后植入违规被掩蔽（实测 2 处）；②资源生命周期注解自动应用触发跨函数窗口 FP 类（实测 28 条，open/close 分处不同函数窗口）；③new_session 词汇误判守卫（实测 4 FP，模式收紧为 channel 类）
- 回归：15 个新单元测试；引擎相关套件 98/98；Python 盲测 v1.2 零漂移（64）；C 应用级金标 F1=95.7% 不变；演示重扫 SSG 结果不变

## [3.7.6] — 2026-08-28

### C 生产级路径收官：金标 5/5 + 采纳案例 + 正则层噪声治理

- **金标 4/5（libssh 回调分发认证）**（`demo-real-c-libssh-cb/` + `REALWORLD_C_V6.md`）：真实 `samplesshd-cb.c`（359 行）逐字——现代回调分发 API（`ssh_server_callbacks_struct` 的 `auth_password_function` / `channel_open_request_session_function`，决策记录指定的最优模块）。2 注解 → APPROVED 82、真实代码 0 FP、植入 `cb_session_no_auth` 精确定位；认证完成跃迁在 libssh 内部 + main 循环条件（L3 边界），establish 由演示层 wrapper 表达（V5 wrapper 模式）
- **金标 5/5（uftpd 数据传送授权）**：采纳项目第二个协议——真实 `do_RETR`/`do_STOR` + 2 注解（pre AUTHENTICATED → post AUTHORIZED，镜像 check_resource_ownership 语义）→ 真实代码 0 FP、`ftp_transfer_no_login` 精确定位（fixPath → `establish_login`）；金标累计 5/5 全部 ~2-3 注解/协议
- **发现 G5（规则面缺口入册）**：SSG 状态机 per-namespace——内置 `check_resource_ownership`（data_integrity，pre=[AUTHENTICATED]）永远不可满足（AUTHENTICATED 在 auth 命名空间，src/tests 全仓库零引用）——规则面设计缺口，非引擎缺陷
- **正则层噪声治理（V5 发现 4 落地）**：`PLAINTEXT_AUTH_WITHOUT_TLS` 加 `languages` 门控排除 C（真实语料证据 3 FP / 0 TP：libssh 演示 1 + uftpd 采纳案例 2——FTP/SSH 应用层本就明文，Web/TLS 语义对 C 无意义）；SSH 主机密钥规则保留全语言（libssh 演示 1 TP）。`checkSpecificViolations` 加 `language` 参数、engine 传 `ctx.language`、5 个回归测试；**双零漂移**：Python 盲测 v1.2 64 违规（仅时间戳差）、C 应用级金标 F1=95.7% 不变；uftpd 重扫 PLAINTEXT ×2 消失、libssh 演示 FP 消失 TP 保留
- **标签升级已拍板**：C「⚠️ 研究」→「✅ 注解驱动协议验证（Beta）」——README 双语、覆盖矩阵双语、c-language-status、CLAUDE.md 同步翻新；能力边界如实保留（未注解不检测、TLS 级无覆盖）

### C 定位拍板「注解驱动」+ 库边界机制 + 精度修复

- **定位拍板**（Decision record 定稿）：C = 注解驱动协议验证（研究级）——未注解自动检测 0 TP/3 FP，两条自动检测桥（C 库别名注册表、方言解析器）不排期；文档翻转：README 双语 + 覆盖矩阵双语 C 行「⚠️ 注解驱动（研究级）」
- **库边界机制（孵化器）**：两层——项目原语注解（`@progmune`，不迁移）+ **库边界别名**（`.progmune_aliases.json` → 共享表 `c-aliases.json`，跨项目迁移）。新增：`scripts/c-annotate.js`（注释块模板 + 别名条目建议脚手架）、`scripts/c-alias-propose.js`（别名校验 + 回写提案 + 人工确认门）；引擎 `loadProtocolRules` 合并共享表 **confirmed** 条目（proposed 不生效、不覆盖全局/项目别名、规则不存在跳过）；`c-aliases.json` 入 npm 包
- **库边界演示**（`demo-real-c-libssh/` + `REALWORLD_C_V3.md`）：真实 libssh authentication.c 逐字 + 1 别名 + 1 注解 → SSG 层 0 误报、植入 missing-auth 精确定位；正则防护层同跑：SSH_NO_HOST_KEY_CHECK 为**真发现**（示例确实不验证主机密钥）、PLAINTEXT_AUTH_WITHOUT_TLS 为 FP（Web 语义规则误映射 SSH，如实记录）
- **发现**：多机制认证重试循环的状态机语义缺口（verify 类规则 pre 不可重入——全机制别名映射会误报正常重试流，候选：可重试标记）；fixPath 反向映射（规则名 → 库调用名）候选
- **陷阱修复（DSH 复测发现）**：`evaluateTrust` 的注解合并依赖 ir.json 写盘，而自动提取此前仅 TS/JS 生效——C/Python 项目直接调用时注解静默失效。现在按语言分派提取器自动写盘（C 走合并形态；TS/JS 路径零变化）+ 回归测试；提取器改静态导入（vitest 下 lazy require 的 CJS 互操作不可靠——该分支从未被测试触发过）
- **精度修复**：真实语料 24 FP → 3 FP（-87.5%）

### C 精度修复：真实语料 24 FP → 3 FP（-87.5%）

- **Strategy 1 normalized 门控**：Windows API（ReadFile/WriteFile/DeleteFile）经 CamelCase→snake_case 规范化撞上内置规则名是 11/24 FP 的主导源——normalized 分支套用词段门控同款 projectFunctions 门（外部 API 不桥接；注解桥接不受影响——注解原语必为项目函数；原始名精确匹配不限门控）
- **endState 直接调用溯源**：12/24 FP 是 nginx 回调式生命周期（open 在内联 helper 链、close 在指针注册的回调里——L3 级不可见）——`CallSequence.directCalls` + `validateSequenceWithSSG` 的 `entryDirectCalls` 参数，仅当资源获取调用是入口的直接调用时报告 endState（helper 获取不归因入口）
- **结果**：真实语料四仓库 24 flags → **3 flags**（nginx 14→0、redis 0、libssh 1、openssl 2；残留 3 条是词段桥接按设计命中项目函数）。双回归门全过：Python 盲测 v1.2 64 违规零漂移（仅时间戳差异）、C 应用级金标 **TP 11/FP 1/FN 0 → F1=95.7% 不变**（leak_file 的 endState TP 保留）、引擎相关套件 120/120
- **战略记录**：C 产品定位（自动检测 vs 注解驱动）待拍板——写入 `docs/c-language-status.md` Decision record；证据偏向注解驱动（精度修复后未注解自动检测仍 0 TP），金标扩量延后至定位拍板

## [3.7.5] — 2026-08-27

### C 真实语料验证 + 注解驱动演示 + 引擎修复（DSH 双轮评审合入）

- **修复（DSH）：单行指针返回函数系统性漏提取**——`char *foo(`/`SSL *foo(` 类定义被 `(?:^|\s)` 锚点漏掉（名字前是 `*` 非空白）；改为 lookbehind `(?<![a-zA-Z0-9_])` + 回归测试。openssl 等指针密集型仓库补回 ~1,500 函数（如 openssl 15,539 含指针修复与表面过滤的净效果）
- **修复：P4.6 展开兆级序列**（DSH 实测 openssl 单序列可达 1M+ 调用、全扫描 15–25 分钟）——`buildCallSequences` 预算制展开（`MAX_SEQUENCE_CALLS=2000` 可注入，入口自身调用按序优先、超预算即停，`CallSequence.truncated` 标记，不去重——重复调用对状态机有语义）；openssl 全扫描 **15–25 分钟 → 222s**。零漂移前置实测：Python 盲测语料最大序列 23、TS 自身 IR 最大 824（预算零影响），Python 盲测复跑 64 违规不变。**截断是诚实的召回边界**（超大序列尾部违规不可见，非静默回归）
- **真实语料四仓库**（libssh/redis/nginx/openssl）：24 flags 全部人工标注 FP（0 TP）——误报类别稳定（OS API 桥接 11、回调 endState、包装器词段、跨函数窗口），keyword 白名单方向的观测前提已达标待决策；稳定指标 = 黄金函数恢复率 97–100%

- **真实 C 语料验证 v1**（`blind-benchmark/scan-real-c.ts` + `REALWORLD_C_V1.md`）：生产管线扫 libssh/redis/nginx——表面过滤后 16 flags 逐条人工标注全 FP（真实误报率观测：标记精确率 0%）；「命名鸿沟」发现（exact-name 0 次触发，合成金标 95.7% F1 全靠按名+注解命中）；误报源分类：回调生命周期 endState 12 / OS API 关键词桥接 3 / 跨函数窗口 1
- **提取器非生产表面过滤**（对齐 `tools/extract_ir.py` Python 先例）：`collectCFiles` 跳过 `tests/test/examples/docs/docs_src/scripts/deps/vendor/third_party` 目录与 `test_*.c`/`*_test.c`——libssh 63→1、redis 1→0 条 flags；C 金标恢复率零漂移（97/97/89/98/100/99）
- **注解驱动真实项目演示**（`demo-real-c-redis/` + `REALWORLD_C_V2.md`）：真实 redis acl.c 代码 + 3 条注解 → 合法流 APPROVED 85 零误报、植入 missing-auth-check 精确定位；标注成本 ~3 注解/协议——**注解驱动是 C 生产化的现实形态，可行性已验证**
- **引擎修复①（CamelCase 注解规则不可触达）**：注解合并同步注册 normalized 形态（加性，snake_case 注解零变化）
- **引擎修复②（注解合并晚于序列构建）**：P4.5 合并移到 `extractCallSequencesFromProject` 之前——有函数体的注解原语不再被内联掉、post 状态生效；与盲测 harness 语义对齐
- **引擎修复③（fixPath 输出真实函数名）**：`StateAnnotation.displayName` 机制——注解合并记录真实函数名，BFS 展开项目原语优先（stable sort 零漂移）+ 渲染映射；修复建议从通用规则名（`verify_token`）变为项目真实函数（`checkPasswordBasedAuth`），sdk 修复解析直接插入真实调用。三处边界如实记录：establish 赋值状态机不可见（L4 不投入）、模块认证 hook 在状态机外、单条 medium 违规不翻转 APPROVED（决策阈值层独立议题）
- **零漂移验证**：Python 协议盲测 v1.2 复跑 64 违规（报告仅时间戳差异）；引擎相关套件 113/113 + 2 个新回归测试（tests/trust/engine.test.ts）
- **如实记录**：C 语言状态标签维持「研究」；不修项（按评估决策）——establish 赋值不可见（L4 不投入）、medium 违规不翻转 APPROVED（累计扣分设计逻辑，非缺陷）

## [3.7.4] — 2026-08-26

### 新增：C 语言 IR 提取（注册表第三语言）

- **`src/extract-ir-c.ts`**：纯 TS C 提取器（无子进程桥、无原生依赖）——函数签名（含多行、`static`/`inline`/`__attribute__`、指针/数组/函数指针参数）、调用列表（成员调用取 `->`/`.` 后的调用名，`goto` 合成 `goto_<label>`）、`@progmune`/`@protocol` 注解与 `@purpose/@tags/@requires/@produces/@useWhen/@inputs/@outputs` 文档标签（C 注释块镜像 Python 装饰器语法）；注释/字符串感知的括号计数（修复 v2 提取器已知缺口，未改动 `sequence-extractor`——C 金标基准管线保持不动）
- **`LANGUAGE_EXTRACTORS` 注册 `c`**（detect `.c`/`.h`，extract `extractIRC`）——agent 循环、execute() 的 ir.json 写入与 MCP 自动生效；C 项目从纯正则回退切换到 IR-first 序列验证 + SSG 状态机，C 函数名进入词段匹配门控（仅项目函数）；协议行与 protocols.json 规则名（`verify_password` 等）按名命中
- **端到端验证**：临时 C 项目上 extractProjectIR → evaluateTrust 走通——4 条植入违规全部精确定位（内置 auth×2 / db×1 + 自定义 pay 命名空间注解×1），合法链零误报（NEEDS_REVIEW 72 分）；**应用级 C 金标 v1**（`blind-benchmark/scan-protocol-c-app.ts`，镜像 Python 盲测方法学）：10 clean × 7 违规 → **P=87.5% / R=100% / F1=93.3%**（唯一 FP 为跨函数窗口边界，与 Python 盲测 T2×S5 同类）
- **规模化提取**（`blind-benchmark/scan-protocol-c.ts`）：6 个 vendored 仓库（curl 5068 / libssh 3989 / nginx 3199 / openssl 15896 / nghttp2 1315 / redis 10170 函数，3.7.4 发布时代码状态——后续版本口径见 3.7.5）秒级提取，黄金函数恢复率 89–100%；旧 TLS 级金标上 SSG 命中 0/38（口径差异：SSG 无 TLS 规则，如实记录）；nginx 3 FP 为 `ngx_*` 前缀包装器撞词段匹配（引擎层问题，记录待议，未动 SSG 桥避免 TS/Python 漂移）
- **修复：签名正则指数级回溯**——v2 风格类型 token 循环对 `name = ssh_userauth_kbdint_getname(...)` 类行穷举标识符切分（44 字符缓冲 ~11s），改为候选迭代（跳过关键字/类型名候选，返回类型从缓冲区前缀推导）；libssh 提取 >15min（病态）→ 1.8s，回归测试已加
- **评审修复轮（detect/extract 口径、死代码、TU 绑定等）**：①`hasSourceFiles` SKIP_DIRS 补 `benchmarks`（与 extract 口径一致，本仓库自身不再误标 C）；②`#if 0` 死代码块预处理剥离（真实仓库不平衡花括号不再腐蚀函数体计数）；③顶层 `#` 行只跳自身不再吞相邻函数（openssl 14,394→15,896 函数，黄金函数恢复率升至 89–100%）；④`buildCallSequences` 同文件定义优先绑定（跨文件同名 static 不再 last-wins 错绑，入口判定文件化；Python 盲测 v1.2 复测零漂移——报告与基线逐字节一致仅时间戳不同）；⑤提取器取消调用去重（状态机重复调用有语义，双 close/重复 logout 可检出，与 TS/Python 提取器一致）；⑥删死代码 `isCProject`；⑦混合 TS+C 项目回归测试。应用级 C 金标扩至 v2（11 clean × 11 违规 + helper 中介风格 + 逐命名空间分解）：**TP 11/11 FP 1 FN 0 → P=91.7% / R=100% / F1=95.7%**（唯一 FP 为 do_logout 跨函数窗口边界）。已知系统性风险文档化：C 前缀包装器（`ngx_*` 等）撞词段匹配（nginx 3 FP），缓解方案（前缀剥离/连续词段）留待下一轮并强制盲测复跑
- **限制如实记录**：函数指针分发静态不可见（L3 结论不变）、宏/K&R/C++ 不解析、无数据流/指针分析（L4 无计划）；提取器遍历跳过 vendored `benchmarks/`；`docs/c-language-status.md` 已更新（新路线小节 + 基准结果 + Decision record）

## [3.7.3] — 2026-08-24

### 中央免疫 Hub 上线 + 失败语料统一

- **中央 Hub 重新部署**（`progmune-runtime` 应用，`server/hub.js`）：fly.toml 补 443 TLS 端口（此前仅 80，https 不可达），`https://progmune-runtime.fly.dev/report` 生效；数据落持久卷 `progmune_data`（`/app/immune_hub_data`），Dashboard `GET /api/dashboard` 可用（含 5 月历史 12 条指纹 + 冒烟测试 1 条）
- **上报链路打通**：`PROGMUNE_HUB` 指向中央 hub；`immune-reporter` 实测可连（游标增量上报，无新指纹时正常返回）；端到端 POST 冒烟通过（received:1 / total:1）
- **统一失败语料写入路径**：`failure-collector.ts` 的 `CORPUS_DIR` 由仓库根 `failure-corpus/` 改为项目级 `.progmune_corpus/emitter-failures/`（与 `failure-corpus.ts` 同规则：`PROGMUNE_CORPUS_DIR || <PROGMUNE_PROJECT_DIR|cwd>/.progmune_corpus`），消除两套语料并存；dist 已重建
- **部署配置瘦身**：根 Dockerfile 改为零依赖（hub 仅需 `server/` + `public/`，去掉 npm install 与 dist 拷贝）；`.dockerignore` 补 benchmarks/、.progmune_corpus/、dist/ 等大目录（构建上下文 1.1G → 数百 KB）
- **Hub 接口扩展**：`/api/dashboard` 新增 `topPatternsWeek`（本周高频错误模式 Top10）+ 全接口 CORS（`Access-Control-Allow-Origin: *`），供落地页跨域实时拉取

### 落地页新增「失败语料飞轮」板块（05）

- 三卡飞轮叙事（失败入库 → 中央汇聚 → 反馈增强）+ **实时本周高频错误模式 Top 10**（浏览器端 fetch `progmune-runtime.fly.dev/api/dashboard`，SVL 分级徽章 + 调用序列 + 次数；空态/不可达有兜底文案）
- 中英文切换覆盖（113 i18n 键）；序号顺延：使用→06、路线图→07、社区→08；导航新增「飞轮」入口

### 文档全量一致性审计

- 全仓文档与当前进度核对并修正：
  - **CLAUDE.md**：Current coverage reality 更新至 2026-08-24（TS 795 gold 98.5%/100%、Python ✅ 生产级、C ⚠️）；"Python/Go/Java planned"→"TS + Python production"；"Don't add TS rules"禁令改按现行基准表述；P0-P3 标注历史阶段；架构表补 `src/call-sequence.ts`（P4.6）、Protocol Detector 标注为正则回退；SDK 导出修正为 verify/explain/getCompatibility
  - **README 双语**：P0-P3 数字统一为权威口径（+31 规则/+86 轨迹/+13 检测器/+11 防护，另 +19 检测）；21→27 命名空间；架构图 Protocol Detector 标注正则回退 + 补 P4.6 调用序列层
  - **覆盖矩阵双语**：C 列 Connection 按图例降 ⚠️（极高误报率），汇总 ✅×4/⚠️×4；IR 层补 3.7.1 恢复 IR-first + 词段门控注记；日期 08-24
  - **BASELINE_PROTOCOL_PYTHON_v1.md**：标题升 v1.2（文件名兼容保留）；风格表补 S5 行
  - **BASELINE_v6.md**：reset_password"已检出/未覆盖"矛盾消歧（md5 形状已检出、其他形状无规则）；TS precision 99.1%（8-15 波次）与 100%（8-16 打磨后）口径注明
  - **QUICK_START.md**：npx 子命令（发布包中不存在）改为真实入口（MCP / GitHub Action / 仓库 CLI）；覆盖表对齐覆盖矩阵
  - **API_REFERENCE.md**：按真实表面重写——SDK 仅 verify/explain/getCompatibility（verify 为同步单参、VerificationResult 字段如实列出）；npm bin = MCP server（工具清单）；仓库 CLI scripts 表；环境变量表保留
  - **RUNTIME_ARCHITECTURE.md**：7 protocol definitions→27 命名空间/148 规则；业务指标表过时数字（FPR 97%、F1 27-41%）改为现行基准（0 FP、TS 98.5%/100%、C F1 16.5%）
  - **项目全解.html**：hero 版本 v3.2.0→v3.7.2；21→27 命名空间（2 处）；85.2% F1 旧数字→现行基准；5.7 基准表补协议盲测 v1.2 行；6.1 产品形态补社区双渠道机器人
  - **投资人白皮书_v3.2.html**：Python"未激活"→✅；144→148 规则（2 处）；PrintLab 案例对齐最终态（46→0 违规、44→87 APPROVED）；P2 待办 Python/Go→Go/Java；里程碑表补 3.7 行；"当前能力（v3.2）"标注最新 npm 3.7.2
  - **新增产品落地页 `index.html`**：产品介绍（为什么 / 是什么 / 核心能力 / 覆盖矩阵 / 使用方法 / 社区反馈）+ 双群二维码 + 自动回复说明 + 联系邮箱 shenlian1983@qq.com + 官网 tuxingren.xyz；自包含单文件（内联 CSS，无外部依赖），图片相对路径，可直接部署至 tuxingren.xyz
  - **落地页上线 Fly.io**：新增 `web/` 静态站部署目录（nginx:alpine + fly.toml，app `progmune-web`，sin 区域，2 台机器）；`fly certs add tuxingren.xyz` 已绑定域名证书，DNS 待用户按记录配置（A `149.248.206.6` / AAAA `2a09:8280:1::17a:e05f:0`）；踩坑记录：Fly 远程构建不解析符号链接（web/ 内用真实文件副本）、hkg 区域已弃用（改用 sin）、文件权限需 644（nginx 用户可读）
  - **落地页迭代**：新增中英文切换（data-i18n + localStorage）；新增「下一步方向」板块（6 个轻量方向卡：更多语言 / Trust API SaaS / 协议扩展 / CI/CD 插件 / 行业基线 / 公开基准，依据 `docs/development-plan.md`）；移除 tuxingren.xyz 全部引用（官网行 + 页脚链接 + i18n 键，待换新域名）；去除联系卡片"自动回复"行

### 修复

- `src/sdk.ts` `RUNTIME_VERSION` 1.0.0 → 3.7.2（verify() 输出的运行时版本与发布版本对齐）

## [3.7.2] — 2026-08-23

### 新增：社区双渠道自动回复机器人（微信 + WhatsApp）

- **微信公众号自动回复 Bot**（`wechat-bot/`）：零依赖 Node webhook——公众号开发者模式服务器配置（sha1 签名校验、安全模式 AES-256-CBC 加解密、被动回复 5s 窗口）、关键词规则自动回复（与 whatsapp-bot 同规则）、关注欢迎语；`Dockerfile`/`fly.toml` 部署模板 + 本地冒烟文档
- **WhatsApp 自动回复 Bot**（`whatsapp-bot/`，补录）：零依赖 Node webhook——Meta webhook 握手、Graph API 回复、可选 `X-Hub-Signature-256` 签名校验、关键词规则自动回复；`Dockerfile`/`fly.toml` 部署模板 + 本地冒烟文档
- **「群」指令升级为二维码图片消息**：新增合成图 `assets/community-qr.png`（微信 + WhatsApp 群码并排）；公众号侧经 access_token + 临时素材上传回图片消息（3 天有效、到期自动重传，未配置 `WEIXIN_APP_SECRET` 时回文字版指引）；WhatsApp 侧直接发送图片链接
- README（中英）「社区与反馈」章节注明双渠道自动回复已上线：关注公众号 / 向官方号码发送「帮助」查看全部指令
- 回复规则双端同步维护；版本号硬编码于规则内，发版后需同步（`RULES` 数组）

### 修复：微信安全模式 AES 加解密 IV 规范

- 对齐官方 WXBizMsgCrypt：**IV = AES 密钥前 16 字节、密文不带 IV 前缀**（此前误按"IV = 密文前 16 字节"导致解密错位 16 字节、`msgLen` 读出乱码、`appid mismatch`）

### 文档

- CHANGELOG 悬空项收口：3.6.0「二维码占位待替换」补注 3.6.1 已换真实群码；3.7.0「合并形态 IR-first 待恢复」补注 3.7.1 已完成；3.4.0「check 失败待单独排期」补注 3.4.1 已修复

## [3.7.1] — 2026-08-23

### 修复：词段匹配门控（仅项目函数适用）

- `ssg-bridge` 的词段匹配（Strategy 2）增加 `projectFunctions` 门控：只对项目函数做词段匹配——它是为改名协议原语设计的（协议原语必然是项目内函数，如 S5 的 `create_active_session`），外部库调用（如 Node 的 `readFileSync`）经词段撞上 `read_file` 是纯噪声
- 外部 API 的语义桥接不受影响：alias 配置（Strategy 0b）与 domain 关键词（Strategy 3）照常工作；未提供集合时保持旧行为（向后兼容）
- 共享集合构造 `collectProjectFunctionNames`（`src/call-sequence.ts`，全名/裸名/小写变体三形态收录），生产引擎与协议盲测扫描器同款传入

### 修复：合并形态 ir.json 恢复 IR-first（3.5.0 起静默回退的回归）

- `extractCallSequencesFromIR` 与项目 IR 注解合并块兼容 `{ typeMap, functions }` 合并对象（execute/MCP 写盘形态）——此前 `Array.isArray` 守卫使所有 TS 项目自 3.5.0 起静默走正则回退，P4.5/P4.6 的 IR-first 语义在合并形态下未生效
- 配合词段门控后实测：自身 1966 函数 451 入口序列，SSG 违规 346→**2**（均真实命中，`writeTrajectoryFile`→`write_file`），Trust 总分 60→83（APPROVED）
- 协议盲测 v1.2 复测零漂移：66 可测金标 64 检出（Recall 97% / Precision 100% / 0 FP），S5 改名检测不受门控影响

## [3.7.0] — 2026-08-23

### 新增：P4.6 跨函数传播（入口展开 + 片段抑制）

- `src/call-sequence.ts`：`buildCallSequences` 共享序列构建——入口函数（不被项目函数调用）的调用链做传递展开（内联被调项目函数体，深度 ≤4、环安全）；非入口函数的孤立片段不再单独验证（违规归因到调用它的入口），消除 helper 片段误报
- 规则名函数与叶子原语（函数体只调外部调用）不内联——协议原语只在调用链内验证，调用名保留给匹配层
- trust 引擎接线：`extractCallSequencesFromIR` 换用 `buildCallSequences`，规则名集合作为展开保留单元；生效范围如实记录——ir.json 为函数数组形态（协议盲测语料 / extractIR 直出）时 P4.6 生效；合并形态 `{ typeMap, functions }`（execute/MCP 写盘）沿用既有回退路径（3.5.0 起的既有行为）——**合并形态的 IR-first 恢复已于 3.7.1 完成**（词段匹配门控 + 形状兼容）
- 边界（与 C 的 L3 同类，如实记录）：展开是语法内联（调用链扁平化），不做数据流/指针/分支分析

### 新增：协议盲测 v1.2（跨函数 + 任意命名变体）

- 语料网格扩至 38 项目：T0–T5 × S1–S5（30）+ T6/T7 × S1–S4（8）；新增违规类 T6 cross_function_precondition、T7 cross_function_cleanup、风格 S5 renamed（无 `@progmune` 注解 + 改名协议函数，词段匹配验证）
- **复测结果：66 可测金标，检出 64（Recall 97%）/ Precision 100% / 0 FP**；2 处漏检为 T2×S5 注解依赖前置约束（无注解项目级前置不可恢复，命名匹配本身正常），金标与基线如实单列
- 回归测试 `tests/python-protocol-benchmark.test.ts` 扩至 6 例（T1 broken / T0 clean 含分离式清洁链 / T5 endState / T6 cross-function / S5 renamed）

### 文档

- 覆盖矩阵（中英）Python 协议行（Auth / Resource Lifecycle）由 ⚠️ 升级 ✅，证据引用协议盲测 v1.2；升级条件（跨函数传播、任意命名验证）全部勾选
- 基线 `BASELINE_PROTOCOL_PYTHON_v1.md` 更新至 v1.2：语料、结果、已知缺口（注解依赖 / LLM 桥接不在测量范围 / P4.6 展开语义边界）如实记录

## [3.6.1] — 2026-08-23

### 文档

- README 社区章节直展双群二维码：微信（`assets/wechat-group.png`）+ WhatsApp（`assets/whatsapp-group.jpg`），中英双语同步
- 微信群码 7 天过期提醒 workflow 文案同步直展形态

## [3.6.0] — 2026-08-23

### 新增：SSG endState 检查（序列末尾资源未释放）

- trust 桥接路径（`src/trust/ssg-bridge.ts`）补齐 endState 检测：函数序列末尾仍有未释放资源状态 → 违规（`endState: true`、`fixPath=[releaseFn]`、追加式修复文案、独立 rule_id `SSG_*_END_STATE_VIOLATION`）
- 与 planner 语义对齐：共享判定 `findHeldResourceStates` + `RESOURCE_NAMESPACE_RE` 入 `ssg-validator.ts`（planner 重构换用，语义不变）
- 边界：仅资源生命周期命名空间（auth/session 合法地以活跃会话结束不检查）；仅本序列新获取的状态（继承自初始态不算泄漏）
- **Python 协议盲测 v1 复测：40/40 全检出（Recall/Precision 100%，0 FP）**，基线 `BASELINE_PROTOCOL_PYTHON_v1.md`

### 新增：Python 协议盲测基准（v1）

- `blind-benchmark/generate-projects-protocol-python.ts` + `scan-protocol-python.ts` + `expand-gold-protocol-python.ts`：6 违规类型 × 4 结构风格 = 24 项目，金标 `annotations-protocol-python-v1.json`
- 测量生产 SSG 桥接校验器（确定性、无 LLM）；回归测试 `tests/python-protocol-benchmark.test.ts`

### 文档

- README 新增「社区与反馈」章节：讨论群二维码（`assets/wechat-group.png`，3.6.0 发布时为占位图，**3.6.1 已替换为真实群码**并直展双群二维码）+ GitHub Issues 通道（中英双语）
- README 删除双峰（Two-Hump）内容：科学基础章节的双峰类比段与 P0-P3 节的双峰报告链接
- 覆盖矩阵（中英）刷新至 2026-08-23 并新增英文版 `coverage-matrix-en.md`；架构图规则数修正 140→148（与 protocols.json 实测一致）

## [3.5.0] — 2026-08-22

### 新增：多语言合并 IR（注册表式提取）

- `src/extract-project-ir.ts`：`LanguageExtractor` 注册表（detect + extract），`extractProjectIR` 合并所有检测到语言的 FunctionInfo——混合项目中 TS 与 Python 函数共存于同一 IR
- agent loop 感知路径（`extractIRWithDelta`）、`execute()` 的 ir.json 写盘、MCP server 统一走合并入口：Python 项目的函数协议链进入 agent 编排范围（此前 agent 侧 IR 仅 TS）
- `extractIRPython` 默认写临时文件（可选 `outPath`），不再覆盖项目根 ir.json；单语言提取失败不中断其余语言，全部失败才抛错（保留 execute 硬失败语义）
- 新增语言（Go/Java/Rust）：实现 detect + extract → `LANGUAGE_EXTRACTORS` 注册一条 → 调用方零改动

### 修复：function-synonyms 本地超时（遗留）

- `runBootstrapValidation` 无参调用结果缓存（同进程复用，语料重度测试 5 次重计算降为 1 次）
- vitest 改用 forks 池 + 4GB 堆上限（本地语料丰富时 threads 池触 V8 自适应堆上限 OOM）；本地 7/7 通过（~24s）

### 验证

- 相关套件 26/26；`npm run check` 0 失败；合并冒烟：progmune-runtime 自身 4043 函数（TS 1949 + Python 2094）

## [3.4.1] — 2026-08-22

### 修复：`npm run check` 四项失败根因

- protocol-registry：protocols.json 解析加包目录回退——在无协议文件的项目目录下运行时，命名空间初始状态不再退化为仅 `_global`（session 记录与 check 重建的世界一致）
- checkLedgerConsistency：只比较 ledger 中记录过的非空快照命名空间（早期 session 的空数组/部分命名空间不参与比较）
- check：历史约定兼容——早期 session 的 `INIT` 初始状态按当前约定（`UNAUTHENTICATED`）规范化比较（只比较、不改盘）
- audit：`.progmune_allowlist` 祖父条款——存量手写代码一次入册，新文件仍受覆盖率约束
- 结果：check 从 4 失败 → 0 失败（免疫状态正常），1313/1313 Ledger 全过

### 新增：P5 操作级安全层 v1

- 权限决策引擎（auto / sandbox / approve / deny 四级）+ patrol / agent 预设
- FsSandbox 白名单（巡逻报告等产品文件）；shell 执行审批门（`--yes` 或交互确认）
- **commit 恒拒绝且不可被 `--yes` 绕过**（修复信任悖论：自动修复/自动合并永不）

## [3.4.0] — 2026-08-21

### 新增：Agent 化 P1–P4.5

- `npm run agent "意图"` — 免疫门在环内的自主实现循环：目标分解 → 8 门验证 → SSG 确定性修复 → 写盘+指纹 → 编译/指纹/测试验证门 → 失败反馈重试（≤3）→ 审计轨迹 + 带指纹 diff
- `npm run patrol -- --project X [--watch]` — 免疫巡逻：trust_check → 违规报告 + 建议补丁（**绝不自动合并**，修复需人工审批）
- 感知层：Git 仓库上下文注入、IR 增量差集、文件变更监听（RepoWatcher）
- 自监督层：项目测试门（npm test / pytest 自动探测，失败摘要注入重试反馈）

### 行为变化：Trust 引擎协议验证语义（P4.5）

- 协议违规收集从「正则扫描文件声明序列」改为「IR 函数体调用序列」：
  - 函数声明顺序不再被当作执行链（消除 auth.ts 类声明误报）
  - 单调用违规文件不再被 `≥4` 阈值跳过（修复 bad_flow 类漏报）
- 合并项目 `@protocol` 注解（IR 优先、缺 namespace 继承内置 JSON，对齐 planner 语义）——项目级前置约束现在生效
- **升级后 trust 检查结果可能与 3.3.x 不同：误报减少、真违规命中增多**

### 修复

- `verifyCompiles` 绝对路径漏匹配——编译验证门静默漏报
- `@protocol` 注解解析早退——文件首函数协议丢失，SSG 误拦正确调用链
- 语义 marker（`__progmune_*`）泄漏进 LLM 可见函数表，被生成为真实调用
- LLM 调用异常静默吞没——改为可见日志（铁律：不许静默绕过）
- `git status --porcelain` 首字符状态列被整串 trim 截断

### 已知问题

- `npm run check` 的 Ledger 不变量 / 回放 / 覆盖率失败为历史遗留（基线核查确认与本次改动无关）——**3.4.1 已修复**（check 根因修复：包目录回退 / 空快照比较 / INIT 规范化 / 覆盖率祖父条款）

## [3.3.8] — 2026-08-18

- README 链接跨平台修复（npm 页面语言切换链接）
