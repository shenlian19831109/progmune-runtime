# Real-World Structural v4 — Flask：词表缺口 FP（@jwt_required 不可见，10/10）

> 2026-09-02 — AST 结构级检测器第四个真实语料考核（结构级系列收官）。
> 语料：gothinkster/flask-realworld-example-app（vendored
> benchmarks/py-apps/flask-realworld，**1.1k★，Flask RealWorld 标准
> 实现**：Flask + flask-jwt-extended + flask-apispec + blueprint）。

## 扫描结果（与金标对照）

| 项 | 检测器 | 金标（人工核实） |
|----|--------|------------------|
| 路由 | 19（blueprint 解析正常，含 10 mutation） | 同左 |
| authDecorators | **mutation 全空** | **全部 mutation 有 `@jwt_required`**（articles/user/profiles 视图逐一核实） |
| issues | **10**（FLASK_ROUTE_NO_AUTH） | 0 协议级违规（spec 合规，写操作全受保护） |

**10/10 FP——全部落在正确受保护的 mutation 上。**

## FP 根因：词表缺生态头号认证装饰器

```python
@blueprint.route('/api/articles', methods=('POST',))
@jwt_required                    # ← flask_jwt_extended 标准认证装饰器
@use_kwargs(article_schema)
def make_article(...): ...
```

扫描器 `AUTH_WORDS = (auth, login, permission, token, credential,
session, user)`——**没有 "jwt"**。"jwt_required" 不含任何词表词 →
authDecorators 空 → 10 条 mutation 全报「no auth decorator」。

**讽刺点**：这不是解析问题（AST 完美读到了装饰器栈），是**词表漏了
Flask 生态最主流的认证装饰器名**——结构性扫描器同样栽在词表上
（与 FastAPI "user" 过宽、Next.js webhook 词表同族，只是方向相反：
FastAPI 多认 → FN，Flask 少认 → FP）。

## 反证实验

摘掉某条 mutation 的 `@jwt_required`（真实违规）→ 检测器输出**不变**
（10 issues）——无感。它无法区分「有 jwt_required 保护」与「被摘掉
保护」的同款应用。

## 结论

- **Flask 结构级标签未获真实支持**：词表缺口导致 10/10 FP。修复极小
  （AUTH_WORDS 补 "jwt"，或按 flask_jwt_extended import 识别认证
  装饰器）但暴露本质：**结构级检测器的词表与启发式是同一块短板**
- 结构级系列四语料定论：
  | 检测器 | 真实语料结果 | 失败/缺口类型 |
  |--------|------------|--------------|
  | NestJS | 23 issues 全 FP（0/23 TP）+ 摘保护无感 | guard 单一惯用法失明（中间件时代语料） |
  | FastAPI | **通过**（0 issues 真、对缺失敏感）+ user 词假保护 | 词表过宽（FN 风险） |
  | Django | urlconf 直连通过 + ViewSet 不可见（0 issues 部分空洞） | DefaultRouter/router.register 注册机制缺口 |
  | Flask | 10/10 FP | 词表缺 "jwt"（FN 反向） |
- **总体**：4 结构级 = 1 通过（FastAPI）、3 有真实缺口。与启发式系列
  合看：**「结构级更可靠」分层叙事只对了一半**——AST 解决了语法
  形态（FastAPI/Django urlconf 证明有效），但认证词表、注册机制覆盖、
  惯用法模型仍是结构级与启发式共享的软肋；任何「100%」背书（无论
  合成还是结构级）都需真实语料复核

## ✅ 修复记录（2026-09-02 结构级修复轮）

**AUTH_WORDS 补 "jwt" 已修**（`tools/extract_framework_flask.py`）：
- 词表加 `jwt` → `@jwt_required`（flask_jwt_extended 头号认证装饰器）
  被识别。**重测 flask-realworld：10 FP → 0 issues**
  （POST /api/articles authDecorators=["jwt_required"] ✓）
