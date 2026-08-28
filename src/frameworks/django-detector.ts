/**
 * Django Framework Adapter — Protocol Detection for Django / DRF
 *
 * 框架适配 M2：结构扫描由 tools/extract_framework_django.py（Python AST）
 * 完成——urlpatterns 解析（FBV/CBV/DRF）、登录装饰器、DRF permission_classes。
 * 本模块消费结构 JSON 做规则判定：
 *
 *   DJANGO_VIEW_NO_AUTH          mutation 视图（FBV 动词名门控 / CBV 方法
 *                                含写操作）无登录装饰器、无权限类、无
 *                                LoginRequiredMixin 等保护——路由级
 *                                missing-auth 的精确形态
 *   DRF_PERMISSION_BYPASS        DRF 视图 mutation 方法 + 显式 AllowAny /
 *                                空权限类——显式绕过（非认证入口端点）
 *
 * 口径（如实）：
 *   - FBV 无法静态区分 HTTP 方法——按视图名动词门控（add/create/update/
 *     delete/transfer 等），信息页（home/robots/error）不报；@api_view
 *     声明的 methods 按真实方法判定
 *   - DRF 写方法 = post/put/patch/delete/create/update/destroy（generics
 *     命名）；read-only（list/retrieve/feed）不检查——公开读是常见设计
 *   - 认证入口端点按 视图名+URL 名 词汇豁免（login/register/signup/token/
 *     health/auth）
 *   - include() 递归与 admin.site.urls 等无法解析的引用跳过
 */

// ── Types（与 tools/extract_framework_django.py 输出对齐） ──

export interface DjangoViewInfo {
  file: string;
  kind: "fbv" | "cbv";
  decorators?: string[];
  authDecorators?: string[];
  apiViewMethods?: string[] | null;
  permissionClasses?: string[];
  bases?: string[];
  methods?: string[];
  isDrf?: boolean;
  protectedByMixin?: boolean;
  openPermission?: boolean;
}

export interface DjangoRoute {
  pattern: string;
  urlname: string;
  view: string | null;
  kind: "fbv" | "cbv" | "include" | "other";
  file: string;
}

export interface DjangoStructure {
  hasDjango: boolean;
  routes: DjangoRoute[];
  views: Record<string, DjangoViewInfo>;
  filesScanned: number;
}

export interface DjangoSecurityIssue {
  severity: "critical" | "high" | "medium" | "low";
  rule: string;
  message: string;
  route?: string;
  handler?: string;
  file?: string;
}

// ── Rule vocabulary ──

/** DRF 写方法（generics 命名 + HTTP 方法） */
const DRF_MUTATION_METHODS = new Set([
  "post", "put", "patch", "delete", "create", "update", "destroy",
]);

/** FBV 动词名门控（信息页不报——home/robots/error 等是公开设计） */
const FBV_MUTATION_VERBS = [
  "add", "create", "update", "delete", "remove", "transfer", "upload",
  "submit", "edit", "change", "save", "write", "send", "post", "pay",
  "checkout", "purchase", "reset", "revoke", "register_device",
];

const AUTH_ENTRY_WORDS = [
  "login", "signin", "sign_in", "regist", "signup", "sign_up",
  "token", "auth", "health", "status",
];

function isAuthEntry(route: DjangoRoute, viewName: string | null): boolean {
  const haystack = `${viewName || ""} ${route.urlname} ${route.pattern}`.toLowerCase();
  return AUTH_ENTRY_WORDS.some((w) => haystack.includes(w));
}

function hasMutationMethod(view: DjangoViewInfo): boolean {
  if (view.apiViewMethods && view.apiViewMethods.length > 0) {
    return view.apiViewMethods.some((m) => DRF_MUTATION_METHODS.has(m.toLowerCase()));
  }
  return (view.methods || []).some((m) => DRF_MUTATION_METHODS.has(m.toLowerCase()));
}

function fbvNameHasMutationVerb(name: string): boolean {
  const lower = name.toLowerCase();
  return FBV_MUTATION_VERBS.some((v) => lower.includes(v));
}

// ── Analysis ──

export function analyzeDjangoStructure(data: DjangoStructure): {
  hasDjango: boolean;
  issues: DjangoSecurityIssue[];
} {
  if (!data.hasDjango || !Array.isArray(data.routes)) {
    return { hasDjango: false, issues: [] };
  }
  const issues: DjangoSecurityIssue[] = [];

  for (const route of data.routes) {
    if (route.kind !== "fbv" && route.kind !== "cbv") continue;
    const viewName = route.view;
    if (!viewName) continue;
    const view = data.views[viewName];
    if (!view) continue; // 无法解析的引用（admin.site.urls 等）跳过
    if (isAuthEntry(route, viewName)) continue;

    if (view.kind === "fbv") {
      const hasAuthDecorator = (view.authDecorators || []).length > 0;
      if (hasAuthDecorator) continue;
      const protectedByApiView = (view.apiViewMethods || []).length > 0
        && (view.permissionClasses || []).length > 0
        && !(view.permissionClasses || []).every((p) => p === "AllowAny");
      const isMutation = view.apiViewMethods && view.apiViewMethods.length > 0
        ? hasMutationMethod(view)
        : fbvNameHasMutationVerb(viewName);
      if (!isMutation) continue;
      if (protectedByApiView) continue;
      issues.push({
        severity: "medium",
        rule: "DJANGO_VIEW_NO_AUTH",
        message:
          `View "${viewName}" (${route.pattern}) has no login decorator or ` +
          `permission protection — any visitor can reach it.`,
        route: route.pattern,
        handler: viewName,
        file: view.file,
      });
      continue;
    }

    // CBV
    if (view.isDrf) {
      if (!hasMutationMethod(view)) continue;
      if (view.openPermission) {
        issues.push({
          severity: "medium",
          rule: "DRF_PERMISSION_BYPASS",
          message:
            `DRF view "${viewName}" (${route.pattern}) accepts write methods ` +
            `with permission_classes allowing any caller.`,
          route: route.pattern,
          handler: viewName,
          file: view.file,
        });
      }
      continue;
    }
    // 非 DRF CBV：写方法 + 无 method_decorator 认证 + 无 LoginRequiredMixin
    if (!hasMutationMethod(view)) continue;
    const authDecorators = (view.authDecorators || []).length > 0;
    if (authDecorators || view.protectedByMixin) continue;
    issues.push({
      severity: "medium",
      rule: "DJANGO_VIEW_NO_AUTH",
      message:
        `View "${viewName}" (${route.pattern}) has write methods without ` +
        `login decorators or auth mixins.`,
      route: route.pattern,
      handler: viewName,
      file: view.file,
    });
  }

  return { hasDjango: true, issues };
}
