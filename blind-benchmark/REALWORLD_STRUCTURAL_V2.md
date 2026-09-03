# Real-World Structural v2 — FastAPI：首个基本通过的结构级考核

> 2026-09-02 — AST 结构级检测器第二个真实语料考核。
> 语料：nsidnev/fastapi-realworld-example-app（vendored
> benchmarks/py-apps/fastapi-realworld，**2.4k★，FastAPI RealWorld 的
> 标准实现**，现代 FastAPI 技术栈：Depends/Security + 依赖工厂）。

## 扫描结果（与金标对照）

| 项 | 检测器 | 金标（人工核实） |
|----|--------|------------------|
| 路由 | 19（含 12 mutation） | 同左 |
| issues | **0** | 0 协议级违规（12 mutation：10 认证保护 + login/register 按 spec 公开） |

**0 issues 与金标一致且非空洞**——12 个 mutation 逐一有交代：
- 10 个带认证依赖：`Depends(get_current_user_authorizer())`（处理器
  参数）或 `dependencies=[Depends(check_*_modification_permissions)]`
  （装饰器 kwargs——扫描器正确捕获两种形态）
- 2 个公开入口：login（路径豁免）+ register（**handler 名豁免**——
  真实 world 的 register 函数名含 "register"，绕开了路径豁免词表
  缺口，比 Koa/Gin/Next 的纯路径豁免更鲁棒）

## 实验验证

**敏感性 ✓**（受控夹具）：真实无认证的 `DELETE /secret`（仅
get_repository 依赖）→ 正确报 FASTAPI_ROUTE_NO_AUTH——规则对
「mutation 缺认证依赖」有真敏感性。

**假保护缺陷 ✗**（词表精度，FN 风险）：`POST /follow/{username}`
唯一依赖是 `get_profile_by_username_from_path`（**DB 查询**，函数名
含 "user"）→ 被标 authLike → 不报。若真实应用删掉真认证依赖但保留
user-词 DB 依赖，检测器会漏报。AUTH_WORDS 的 `"user"` 过宽（与
启发式词表问题同族——结构级同样栽在词表精度上）。

## 结论

- **FastAPI 结构级标签获得首个真实数据支持**：现代惯用法（依赖注入）
  下 0 issues 与金标一致、对真缺失敏感——AST + 依赖模型在该形态下
  确实有效（区别于 NestJS 只认 guard 惯用法）
- **遗留缺陷**：词表 `"user"` 过宽致假保护（FN 风险）——修复方向：
  authLike 判定区分「认证依赖」与「含 user 词的数据依赖」（如排除
  *_from_path / get_*_repository / repository 类名，或要求依赖名含
  auth/authorizer/current_user/login/token/security 等强词）
- 对照：NestJS（guard 单一惯用法失明）vs FastAPI（现代依赖形态
  通过）——结构级检测器的成败取决于**是否覆盖了该框架的真实惯用法**，
  与 AST 与否无关；真正拉开差距的是形态模型，不是解析技术

## ✅ 修复记录（2026-09-02 结构级修复轮）

**AUTH_WORDS 去裸 "user" 已修**（`tools/extract_framework_py.py`）：
- 词表移除 `"user"`（保留 `current_user`，另补 `jwt`）——DB 查询依赖
  名（get_profile_by_username_from_path 等）不再被误标认证
- **重测 fastapi-realworld：仍 0 issues**（真认证依赖
  get_current_user_authorizer 含 current_user 照常识别 ✓）
- **假保护反证修复**：仅 user-词 DB 依赖的无认证 mutation 现被报
  （FASTAPI_ROUTE_NO_AUTH ✓），真认证路由不误报 ✓
