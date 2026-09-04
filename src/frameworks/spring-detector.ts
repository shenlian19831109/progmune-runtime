/**
 * spring-detector.ts — Spring (Boot) Framework Adapter — 路由覆盖模型
 *
 * Java 语言支持里程碑 2。真实语料（gothinkster/spring-boot-realworld-
 * example-app 1581★）证实 Spring 认证惯例 = **安全配置类集中声明**：
 *
 *   @Configuration @EnableWebSecurity
 *   class WebSecurityConfig extends WebSecurityConfigurerAdapter {
 *     configure(HttpSecurity http) {
 *       http...authorizeRequests()
 *           .antMatchers(HttpMethod.POST, "/users", "/users/login").permitAll()
 *           .antMatchers(HttpMethod.GET, "/articles/**", "/tags").permitAll()
 *           .antMatchers(HttpMethod.GET, "/articles/feed").authenticated()
 *           .anyRequest().authenticated();      // ← 兜底
 *   }
 *
 * 路由保护 = Spring 规则序（首个匹配者胜）+ anyRequest 兜底。检测器
 * 解析安全配置规则 → 控制器注解路由（@RestController + @*Mapping）→
 * 判定 mutation 是否最终公开。代码串级 + ant 模式匹配（与 Gin/Fiber
 * 项目级模型同族；注册在配置而非路由上——见 REALWORLD 系列根因②）。
 */
import * as fs from "fs";
import * as path from "path";
import { collectRegisterRoots, isRegisterRoot } from "./route-window";

export interface SpringRoute {
  method: string;
  path: string;
  controller: string;
  /** 命中规则/兜底后的最终访问 */
  access: string; // permitAll | authenticated | hasRole… | deny
  protectedFlag: boolean;
  line: number;
}

export interface SpringSecurityRule {
  method?: string; // HttpMethod.XXX（无 = 全方法）
  patterns: string[];
  access: string;
  anyRequest?: boolean;
}

export interface SpringProjectAnalysis {
  filesScanned: number;
  hasSecurityConfig: boolean;
  catchAll: string | null; // anyRequest 兜底访问
  rules: SpringSecurityRule[];
  routes: SpringRoute[];
  issues: SpringSecurityIssue[];
}

export interface SpringSecurityIssue {
  severity: "critical" | "high" | "medium" | "low";
  rule: string;
  message: string;
  route?: string;
  line?: number;
}

const MUTATION_METHODS = new Set(["post", "put", "patch", "delete"]);

const ACCESS_AUTH = new Set([
  "authenticated", "fullyAuthenticated", "hasRole", "hasAnyRole",
  "hasAuthority", "hasAnyAuthority", "rememberMe", "denyAll",
]);

function isAuthEntryPath(p: string): boolean {
  return /\/?(login|signin|signup|sign_in|register|refresh)(\/|$)/i.test(p);
}

/** Spring ant 模式 → 正则（** → 任意段，* → 单段） */
export function antToRegex(pattern: string): RegExp {
  const esc = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const re = esc.replace(/\*\*/g, "__DOUBLE__").replace(/\*/g, "[^/]*").replace(/__DOUBLE__/g, ".*");
  return new RegExp("^" + re + "$");
}

function parseSecurityConfig(code: string): { rules: SpringSecurityRule[]; catchAll: string | null } {
  const rules: SpringSecurityRule[] = [];
  let catchAll: string | null = null;
  // 逐个 .antMatchers(...) 与其后 .access() 配对
  const re = /\.antMatchers\(\s*([^)]*)\)\s*\.(\w+)\s*\(|\.anyRequest\(\)\s*\.(\w+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    if (m[3] !== undefined) {
      catchAll = m[3];
      continue;
    }
    const argText = m[1];
    let method: string | undefined;
    let rest = argText.trim();
    const hm = rest.match(/^HttpMethod\.(\w+)/);
    if (hm) {
      method = hm[1].toLowerCase();
      rest = rest.slice(hm[0].length).replace(/^,/, "").trim();
    }
    const patterns: string[] = [];
    for (const pm of rest.matchAll(/"([^"]+)"/g)) patterns.push(pm[1]);
    if (patterns.length === 0) {
      // 无引号模式（变量引用）→ 宽匹配不了，跳过（保守：不豁免）
      continue;
    }
    rules.push({ method, patterns, access: m[2] });
  }
  return { rules, catchAll };
}

function parseControllers(root: string): Array<{ controller: string; header: string; body: string; path: string }> {
  const out: Array<{ controller: string; header: string; body: string; path: string }> = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (["build", "target", ".git", ".gradle"].includes(e.name)) continue;
        walk(full);
      } else if (e.name.endsWith(".java")) {
        const code = fs.readFileSync(full, "utf-8");
        const clsRe = /@(?:RestController|Controller)(?!\w)[\s\S]*?(?=class\s+([A-Za-z_]\w*))/g;
        let cm: RegExpExecArray | null;
        while ((cm = clsRe.exec(code)) !== null) {
          const name = cm[1] || "Unknown";
          const clsAt = code.indexOf("class " + name, cm.index);
          if (clsAt < 0) continue;
          const header = code.slice(cm.index, clsAt); // 类声明头（类级注解区）
          const body = code.slice(clsAt);             // 类体（方法注解区）
          out.push({ controller: name, header, body, path: full });
        }
      }
    }
  };
  walk(root);
  return out;
}

function methodAccessOf(ann: string): { method: string; rpath: string } {
  const lower = ann.toLowerCase().replace(/^@/, "");
  const method = lower.startsWith("requestmapping")
    ? (() => {
        const mm = ann.match(/method\s*=\s*(?:RequestMethod\.)?(\w+)/);
        return mm ? mm[1].toLowerCase() : "";
      })()
    : lower.replace(/mapping.*/, "").replace(/^@/, "").trim();
  const pm = ann.match(/(?:path\s*=\s*)?["']([^"']*)["']/);
  return { method, rpath: pm ? pm[1] : "" };
}

export function analyzeSpringProject(projectRoot: string): SpringProjectAnalysis {
  const issues: SpringSecurityIssue[] = [];
  // 1) 安全配置（全仓找 WebSecurityConfigurerAdapter / SecurityFilterChain）
  let secCode = "";
  let hasSecurityConfig = false;
  let catchAll: string | null = null;
  let rules: SpringSecurityRule[] = [];
  const collect = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (["build", "target", ".git", ".gradle", "node_modules"].includes(e.name)) continue;
        collect(full);
      } else if (e.name.endsWith(".java")) {
        const code = fs.readFileSync(full, "utf-8");
        if (/WebSecurityConfigurerAdapter|SecurityFilterChain/.test(code) && /authorizeRequests|authorizeHttpRequests/.test(code)) {
          hasSecurityConfig = true;
          secCode += code + "\n";
        }
      }
    }
  };
  collect(projectRoot);
  if (hasSecurityConfig) {
    const parsed = parseSecurityConfig(secCode);
    rules = parsed.rules;
    catchAll = parsed.catchAll;
  }
  const registerRootsSet = new Set<string>();

  // 2) 控制器路由
  const routes: SpringRoute[] = [];
  const allPaths: string[] = [];
  const filesScanned = (() => {
    let n = 0;
    const cnt = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (["build", "target", ".git", ".gradle", "node_modules"].includes(e.name)) continue;
          cnt(full);
        } else if (e.name.endsWith(".java")) n++;
      }
    };
    cnt(projectRoot);
    return n;
  })();

  for (const c of parseControllers(projectRoot)) {
    // 类级 @RequestMapping 只认类声明头（方法级 @RequestMapping 不算前缀）
    const clsReq = c.header.match(/@RequestMapping\s*\((?:path\s*=\s*)?["']([^"']*)["']/);
    const prefix = clsReq ? clsReq[1].replace(/^\//, "") : "";
    const annRe = /@(Get|Post|Put|Delete|Patch|Request)Mapping\s*(\([^)]*\))?/g;
    let m: RegExpExecArray | null;
    while ((m = annRe.exec(c.body)) !== null) {
      const ann = "@" + m[1] + "Mapping" + (m[2] || "()");
      const { method, rpath } = methodAccessOf(ann);
      if (!method) continue;
      const seg = rpath.replace(/^\//, "");
      const fullPath = "/" + (prefix ? prefix + (seg ? "/" + seg : "") : seg);
      // 找到该 handler 起始行（用于 line + 后续注解如 @PreAuthorize）
      const line = c.body.slice(0, m.index).split("\n").length;
      const window = c.body.slice(m.index, m.index + 600);
      const preAuth = /@PreAuthorize/.test(window);
      allPaths.push(fullPath);
      routes.push({
        method,
        path: fullPath,
        controller: c.controller,
        access: preAuth ? "authenticated(@PreAuthorize)" : "",
        protectedFlag: !!preAuth,
        line,
      });
    }
  }
  // register 集合根（同文件/项目内 /login 姊妹）
  const registerRoots = collectRegisterRoots(allPaths);

  // 3) 逐路由判定（Spring 序：首个匹配规则胜；无匹配 → 兜底）
  for (const r of routes) {
    let access: string | null = null;
    for (const rule of rules) {
      if (rule.method && rule.method !== r.method) continue;
      if (!rule.patterns.some((p) => antToRegex(p).test(r.path))) continue;
      access = rule.access; // 首个匹配
      break;
    }
    const finalAccess = access ?? catchAll ?? (hasSecurityConfig ? "deny" : "public");
    r.access = finalAccess;
    r.protectedFlag = ACCESS_AUTH.has(finalAccess) || r.protectedFlag;

    if (!MUTATION_METHODS.has(r.method)) continue;
    if (r.protectedFlag) continue;
    if (isAuthEntryPath(r.path)) continue;
    if (r.method === "post" && isRegisterRoot(r.path, registerRoots)) continue;
    issues.push({
      severity: "medium",
      rule: "SPRING_ROUTE_NO_AUTH",
      message:
        `Mutation route ${r.method.toUpperCase()} ${r.path} is reachable without ` +
        `authentication (access=${finalAccess}) — any caller can invoke it.`,
      route: `${r.method.toUpperCase()} ${r.path}`,
      line: r.line,
    });
  }

  return {
    filesScanned,
    hasSecurityConfig,
    catchAll,
    rules,
    routes,
    issues,
  };
}
