# Real-World Corpus Methodology — 真实语料考核方法论

> 2026-09-02 定稿。基于 12 个框架检测器的真实语料考核（`REALWORLD_FRAMEWORK_FP_V1-V8.md`
> + `REALWORLD_STRUCTURAL_V1-V4.md`）提炼。工具化入口：
> `npm run audit:realworld -- --framework <f> --repo <url|dir>`。

## 为什么需要它

合成金标（P=R=100%）只证明检测器在**它预设的惯用法**上自洽。真实代码
的认证形态是各框架生态多年演化出来的惯例，与合成样例系统性偏离——
8/8 启发式与 3/4 结构级在真实语料首测全部失手（0% 精确率 / 全盲 /
分类器串扰 / 词表缺口 / 注册机制不可见……）。**任何「100%」背书（无论
合成还是 AST 结构级）都必须过真实语料复核。**

## 方法五步（对每个检测器）

1. **语料**：真实开源生产项目（优先 gothinkster 家族 RealWorld 与真实
   产品，如 netflx-web/journalist/jiotv_go），浅克隆 vendored 到
   `benchmarks/{ts-apps,py-apps,go-apps}/`（gitignored，报告注明来源可复现）
2. **扫描**：检测器跑语料 → 记录 flags（规则/路由/文件）
3. **金标**：人工读真实代码确认每个 flag 的 TP/FP/加固类/能力令牌
   分类，以及语料的「理想输出」（spec 合规 → 0 协议级违规）
4. **反证实验**（区分「0 flags 是验证通过」与「0 flags 是没看见」）：
   - 摘掉一条真实受保护 mutation 的认证 → 必须报（无反应 = 失明）
   - 0 flags 语料须确认全部受保护（空洞检查）
   - 删组级认证/中间件 → 相关 mutation 必须重现
5. **修复 → 重测**：每项修复先在原语料重测到 0 + 反证通过，再入回归测试

## 三类跨框架根因（12 检测器反复出现）

| # | 根因 | 表现 | 涉及 |
|---|------|------|------|
| ① | 300 字符前向窗口跨路由串扰 | 后面路由的 auth 洗白前面公开路由；单点摘保护无感 | Koa/Gin/Fiber（→ 窗口按调用边界截断） |
| ② | 声明式/组级/跨文件/中间件认证形态不可见 | 保护写在 bootstrap/模块/配置里，路由在别处 | Fastify(object)/Hapi(声明式)/Gin·Fiber(组 Use)/NestJS(configure)/Express(路由级)（→ 注册链传播/declarative 解析/接收者化） |
| ③ | 词表与豁免缺口 | 少认（@jwt_required/裸 auth()/webhook 签名）或多认（"user" 假保护） | Flask/Next.js/tRPC/Express/FastAPI（→ 词表校准 + 语义豁免） |

## 附带产出的真实缺陷（语料方法论价值证明）

每个语料当场揪出可复现检测器 bug：Express cors→security_header 分类、
Koa 窗口串扰、tRPC 嵌套括号失明 + lastIndex 泄漏、FastAPI user 假保护、
Flask 缺 jwt、Django ViewSet 注册不可见、NestJS 中间件失明、Fastify/
Hapi/Gin/Fiber 形态失配……全部修复 + 回归测试锁定。

**反向也成立**：修复后的检测器在真实语料上抓出真实漏洞——NestJS 语料
（lujakob realworld 2.6k★）的 `DELETE /users/:slug` 无保护用户删除端点。

## 防再犯守则（写入 CLAUDE.md 精神）

- 新检测器/新语言（Java/Spring 等）：上线前必须 `npm run audit:realworld`
  过 ≥1 真实生产语料 + 反证通过，报告入 `blind-benchmark/reports/`
- 合成金标可作开发期迭代，**不可作对外背书**
- 「启发式 ⚠️ / 结构级」内部实现分层 ≠ 可靠分层；对外按**证据档位**说话
  （见 CLAUDE.md 标签升级）
- 语料 gitignored（体积），报告与文档入版（可复现，注明来源 URL）
