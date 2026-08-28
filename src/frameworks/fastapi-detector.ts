/**
 * FastAPI Framework Adapter — Protocol Detection for FastAPI
 *
 * 框架适配 M1（Python 侧结构提取 + TS 侧规则判定）：
 * 结构扫描由 tools/extract_framework_py.py（Python AST）完成——路由
 * （@app.get/@router.post）、依赖注入（Depends()/Security()，含
 * Annotated[...] 与装饰器级 dependencies=[...]）、认证方案声明
 * （OAuth2PasswordBearer/HTTPBearer/APIKeyHeader 等）、全局中间件。
 * 本模块消费结构 JSON 做规则判定：
 *
 *   FASTAPI_ROUTE_NO_AUTH        写操作路由（post/put/patch/delete）无
 *                                认证依赖，且不是认证入口端点（login/
 *                                register/token 等）——「每个 API 入口
 *                                都有门禁」的精确形态
 *   FASTAPI_DEAD_AUTH_SCHEME     声明了认证方案但没有任何路由引用——
 *                                认证设施是死的（装饰性声明，防御性价值为零）
 *
 * 边界（如实）：
 *   - 读操作（GET）不检查——公开读是常见设计（realworld 的 tags/文章
 *     列表就是公开 GET），只盯写操作把误报压到最低（实测 realworld 0 FP）
 *   - 认证入口端点按 处理器名+路径 词汇豁免——登录/注册本身不能要求已认证
 *   - 不做数据流分析：Depends 目标是 auth-like 名或声明的方案即视为认证
 *   - 全局中间件不视为认证（add_middleware 通常是 CORS 等；认证中间件
 *     是自定义 BaseHTTPMiddleware 且结构不可见——如实不认）
 */

// ── Types（与 tools/extract_framework_py.py 输出对齐） ──

export interface FastapiRoute {
  method: string;
  path: string;
  handler: string;
  file: string;
  line: number;
  dependencies: Array<{ name: string | null; via: string; authLike: boolean }>;
}

export interface FastapiStructure {
  hasFastAPI: boolean;
  apps: string[];
  routers: string[];
  authSchemes: Array<{ name: string; type: string }>;
  globalAuthMiddleware: string[];
  routes: FastapiRoute[];
  filesScanned: number;
}

export interface FastapiSecurityIssue {
  severity: "critical" | "high" | "medium" | "low";
  rule: string;
  message: string;
  route?: string;
  handler?: string;
  file?: string;
  line?: number;
}

// ── Rule vocabulary ──

/** 写操作方法——公开读是常见设计，只盯 mutation 面 */
const MUTATION_METHODS = new Set(["post", "put", "patch", "delete"]);

/** 认证入口端点豁免词（登录/注册/token 签发本身不能要求已认证） */
const AUTH_ENTRY_WORDS = [
  "login", "signin", "sign_in", "regist", "signup", "sign_up",
  "token", "auth", "health", "status",
];

/** 认证方案类型——引用即视为认证依赖 */
const SCHEME_TYPES = new Set([
  "OAuth2PasswordBearer", "OAuth2AuthorizationCodeBearer", "HTTPBearer",
  "HTTPBasic", "HTTPDigest", "APIKeyHeader", "APIKeyQuery", "APIKeyCookie",
  "OpenIdConnect",
]);

function isAuthEntryRoute(route: FastapiRoute): boolean {
  const haystack = `${route.handler} ${route.path}`.toLowerCase();
  return AUTH_ENTRY_WORDS.some((w) => haystack.includes(w));
}

/** 路由是否引用了某个认证方案（Depends(oauth2_scheme) 形态） */
function referencesScheme(route: FastapiRoute, schemeNames: Set<string>): boolean {
  return route.dependencies.some(
    (d) => d.name !== null && schemeNames.has(d.name)
  );
}

// ── Analysis ──

export function analyzeFastapiStructure(data: FastapiStructure): {
  hasFastAPI: boolean;
  issues: FastapiSecurityIssue[];
} {
  if (!data.hasFastAPI || !Array.isArray(data.routes)) {
    return { hasFastAPI: false, issues: [] };
  }
  const issues: FastapiSecurityIssue[] = [];
  const schemeNames = new Set((data.authSchemes || []).map((s) => s.name));

  // R1：无认证写操作路由
  for (const route of data.routes) {
    if (!MUTATION_METHODS.has(route.method.toLowerCase())) continue;
    const hasAuthDep = route.dependencies.some((d) => d.authLike);
    if (hasAuthDep) continue;
    if (isAuthEntryRoute(route)) continue;
    issues.push({
      severity: "medium",
      rule: "FASTAPI_ROUTE_NO_AUTH",
      message:
        `Route ${route.method.toUpperCase()} ${route.path || "(root)"} has no ` +
        `authentication dependency — any caller can invoke "${route.handler}" ` +
        `without credentials.`,
      route: `${route.method.toUpperCase()} ${route.path || "(root)"}`,
      handler: route.handler,
      file: route.file,
      line: route.line,
    });
  }

  // R2：声明了认证方案但没有路由引用（死设施）
  for (const scheme of data.authSchemes || []) {
    if (!SCHEME_TYPES.has(scheme.type)) continue; // 非认证方案类跳过
    const used = data.routes.some((r) => referencesScheme(r, schemeNames));
    if (!used) {
      issues.push({
        severity: "medium",
        rule: "FASTAPI_DEAD_AUTH_SCHEME",
        message:
          `Auth scheme "${scheme.name}" (${scheme.type}) is declared but no ` +
          `route references it — the scheme does not protect any endpoint.`,
      });
    }
  }

  return { hasFastAPI: true, issues };
}
