# Real-World Structural v3 — Django：DRF ViewSet/DefaultRouter 路由不可见

> 2026-09-02 — AST 结构级检测器第三个真实语料考核。
> 语料：gothinkster/django-realworld-example-app（vendored
> benchmarks/py-apps/django-realworld/conduit，**2.4k★，Django + DRF
> RealWorld 标准实现**）。

## 扫描结果（与金标对照）

| 项 | 检测器 | 金标（人工核实） |
|----|--------|------------------|
| 路由表 | 15（urlconf 直连） | urlconf 直连 15 + **ViewSet 组（文章 CRUD）** |
| 权限提取 | 正确（permission_classes 逐视图） | — |
| issues | **0** | 0 协议级违规（金标：所有写操作受保护） |

## 核心缺陷：DRF ViewSet + DefaultRouter 路由不可见

文章的 create/update/delete（**spec 核心写面**）注册形态：

```python
router = DefaultRouter(trailing_slash=False)
router.register(r'articles', ArticleViewSet)   # ← 核心 CRUD
urlpatterns = [url(r'^', include(router.urls)), ...]
```

urlconf 解析器只见字面 `include(router.urls)`（kind: include）——
`router.register` 的路由由 DRF **运行时生成** → ArticleViewSet 及其
permission_classes **从未进入路由表** → 分析器从不评估它。

**反证实验**：把 ArticleViewSet 的 `IsAuthenticatedOrReadOnly` 改为
`AllowAny`（真实违规：任何人可增删改文章）→ **issues 仍 0**——不是
保护住了，是**该视图从未被检查**。语料的「0 issues」对 ViewSet 写面
是**空洞的**（金标上它确实受保护，但检测器没验证过）。

**对照（敏感性真实）**：改**路由表内**的 ArticlesFavoriteAPIView
（IsAuthenticated → AllowAny）→ **DRF_PERMISSION_BYPASS 正确触发**。
urlconf 直连视图的分析链路是好的——缺口只在 ViewSet/DefaultRouter
这一种注册机制。

## 结论

- **Django 结构级标签部分成立 + 一个机制缺口**：urlconf 直连视图
  0 issues 真实（权限提取与规则正确、变异有反应）；但 **DRF 最主流的
  路由机制（ViewSet + router.register）整体不可见**——真实 DRF 项目
  普遍用 ViewSet/ModelViewSet，此缺口意味着核心写面通常未经验证
- 修复方向（AST 可精确解决，非启发式）：解析 `router.register(prefix,
  ViewSet)` + `include(router.urls)` → 按 DRF 约定展开标准 action 路由
  （list/create/retrieve/update/destroy → GET/POST/GET/PUT/DELETE），
  再把 ViewSet 的 permission_classes 接到展开路由上——纯静态可解，
  因为 ViewSet 类与权限都在模块内可见
- 方法学累积：NestJS 中间件惯用法失明 / FastAPI 现代依赖形态通过（+
  词表精度缺陷）/ Django urlconf 直连通过 + ViewSet 注册不可见——
  **结构级的真实分水岭不是 AST vs 代码串，而是「是否实现了该框架
  主流注册/保护机制的解析」**

## ✅ 修复记录（2026-09-02 结构级修复轮）

**DRF ViewSet + DefaultRouter 路由展开已修**：
- `tools/extract_framework_django.py`：收集 `DefaultRouter(...)` 定义
  （trailing_slash 关键字）与 `router.register(prefix, ViewSet)` 语句；
  当 urlpatterns 含 `include(router.urls)` 时按 DRF 约定展开集合/详情
  两条路由（`^prefix/?$` 与 `^prefix/(?P<pk>[^/.]+)/?$`），权限由
  views 表原样接入——ViewSet 写面进入路由表
- `django-detector.ts`：DRF_PERMISSION_BYPASS 按视图去重（同一 ViewSet
  多条展开路由只报一次）
- 回归测试 +2（12 green）；**重测 django-realworld**：ArticleViewSet
  写面现可见（routes 15→17），0 issues 从部分空洞变为**全部真实核查**
  （含文章 CRUD 的 IsAuthenticatedOrReadOnly）；AllowAny 变异实验
  **由无感变为触发**（DRF_PERMISSION_BYPASS ×1）
