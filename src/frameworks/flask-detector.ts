/**
 * Flask Framework Adapter — Protocol Detection for Flask
 *
 * 第 5 个框架适配（Python 第 3 个）：结构扫描由 tools/extract_framework_flask.py
 * （Python AST）完成——@app.route/@bp.route、methods kwarg、认证装饰器、
 * before_request 认证守卫、Blueprint。
 * 本模块消费结构 JSON 做规则判定：
 *
 *   FLASK_ROUTE_NO_AUTH         mutation 路由（methods 含 POST/PUT/PATCH/
 *                               DELETE）无认证装饰器，且项目无认证
 *                               before_request 守卫——路由级 missing-auth
 *
 * 口径（如实）：
 *   - @app.route 缺省 methods = GET only（Flask 语义）——公开读不检查
 *   - 认证 before_request 按函数名词汇识别（auth/login/permission 等）；
 *     自定义守卫函数若名字不含词表会漏判（保守方向是漏报不是误报）
 *   - 认证入口端点按 处理器名+路径 词汇豁免（login/regist/token/health）
 *   - Blueprint 内的 before_request 与 app 级同权重（项目内任一认证守卫
 *     存在即视为全局保护信号）
 */

// ── Types（与 tools/extract_framework_flask.py 输出对齐） ──

export interface FlaskRoute {
  methods: string[];
  path: string;
  handler: string;
  file: string;
  line: number;
  target: string | null;
  authDecorators?: string[];
}

export interface FlaskStructure {
  hasFlask: boolean;
  apps: string[];
  blueprints: string[];
  routes: FlaskRoute[];
  beforeRequestAuth: string[];
  filesScanned: number;
}

export interface FlaskSecurityIssue {
  severity: "critical" | "high" | "medium" | "low";
  rule: string;
  message: string;
  route?: string;
  handler?: string;
  file?: string;
  line?: number;
}

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const AUTH_ENTRY_WORDS = [
  "login", "signin", "sign_in", "regist", "signup", "sign_up",
  "token", "auth", "health", "status",
];

function isAuthEntry(route: FlaskRoute): boolean {
  const haystack = `${route.handler} ${route.path}`.toLowerCase();
  return AUTH_ENTRY_WORDS.some((w) => haystack.includes(w));
}

export function analyzeFlaskStructure(data: FlaskStructure): {
  hasFlask: boolean;
  issues: FlaskSecurityIssue[];
} {
  if (!data.hasFlask || !Array.isArray(data.routes)) {
    return { hasFlask: false, issues: [] };
  }
  const issues: FlaskSecurityIssue[] = [];
  const hasGlobalAuthGuard = (data.beforeRequestAuth || []).length > 0;

  for (const route of data.routes) {
    const isMutation = (route.methods || []).some((m) => MUTATION_METHODS.has(m));
    if (!isMutation) continue;
    const hasAuthDecorator = (route.authDecorators || []).length > 0;
    if (hasAuthDecorator || hasGlobalAuthGuard) continue;
    if (isAuthEntry(route)) continue;
    issues.push({
      severity: "medium",
      rule: "FLASK_ROUTE_NO_AUTH",
      message:
        `Route ${(route.methods || []).join("/")} ${route.path || "(root)"} has no ` +
        `auth decorator and the app has no auth before_request guard — any ` +
        `visitor can invoke "${route.handler}".`,
      route: `${(route.methods || []).join("/")} ${route.path || "(root)"}`,
      handler: route.handler,
      file: route.file,
      line: route.line,
    });
  }

  return { hasFlask: true, issues };
}
