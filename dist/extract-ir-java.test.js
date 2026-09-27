"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * extract-ir-java.test.ts — Java 提取器回归（纯字符串 + 临时目录）
 */
const vitest_1 = require("vitest");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const extract_ir_java_1 = require("./extract-ir-java");
let dir;
(0, vitest_1.beforeEach)(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "javair-")); });
(0, vitest_1.afterEach)(() => { fs.rmSync(dir, { recursive: true, force: true }); });
const SAMPLE = `package app;
public class JwtTokenFilter extends OncePerRequestFilter {
  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    getTokenString(request.getHeader("Authorization"))
        .flatMap(token -> jwtService.getSubFromToken(token))
        .ifPresent(id -> {
          if (SecurityContextHolder.getContext().getAuthentication() == null) {
            setAuthentication(id, request);
          }
        });
  }
  private Optional<String> getTokenString(String h) {
    if (h == null) return Optional.empty();
    return Optional.of(h.substring(7));
  }
}`;
(0, vitest_1.describe)("extract-ir-java", () => {
    (0, vitest_1.it)("@Override 注解方法被提取（不会被 @ 前导过滤误杀）", () => {
        const fp = path.join(dir, "JwtTokenFilter.java");
        fs.writeFileSync(fp, SAMPLE);
        const fns = (0, extract_ir_java_1.extractJavaFile)(fp);
        (0, vitest_1.expect)(fns.some((f) => f.name === "doFilterInternal")).toBe(true);
        (0, vitest_1.expect)(fns.some((f) => f.name === "getTokenString")).toBe(true);
    });
    (0, vitest_1.it)("方法调用边（calls）被提取——JWT 认证链可见（带接收者输出完整链）", () => {
        const fp = path.join(dir, "JwtTokenFilter.java");
        fs.writeFileSync(fp, SAMPLE);
        const fns = (0, extract_ir_java_1.extractJavaFile)(fp);
        const filter = fns.find((f) => f.name === "doFilterInternal");
        (0, vitest_1.expect)(filter.calls).toContain("jwtService.getSubFromToken");
        // 链式调用按段输出：SecurityContextHolder.getContext() 输出第一段，
        // 其返回值的 getAuthentication() 无文本接收者 → 裸名
        (0, vitest_1.expect)(filter.calls).toContain("SecurityContextHolder.getContext");
        (0, vitest_1.expect)(filter.calls).toContain("getAuthentication");
        (0, vitest_1.expect)(filter.calls).toContain("setAuthentication");
        // 关键字不算调用
        (0, vitest_1.expect)(filter.calls).not.toContain("if");
    });
    (0, vitest_1.it)("基础方法提取", () => {
        const fp = path.join(dir, "Plain.java");
        fs.writeFileSync(fp, `package app;
public class Plain {
  public Plain() {}
  public int add(int a, int b) { return a + b; }
}`);
        const fns = (0, extract_ir_java_1.extractJavaFile)(fp);
        (0, vitest_1.expect)(fns.some((f) => f.name === "add")).toBe(true);
    });
});
// ── 协议行金标 v1：token 生命周期（verify 先于 use，2026-09-02）──
/** 真实语料 token 链的 verify-before-use 判定（金标规则 v1）：
 *  doFilterInternal 的调用序须满足 getSubFromToken（verify）先于
 *  setAuthentication（use/信任）。 */
function tokenVerifyBeforeUse(calls) {
    if (!calls)
        return { ok: false, why: "无调用边" };
    const verifyIdx = calls.findIndex((c) => /getSubFromToken|verify/.test(c));
    const useIdx = calls.findIndex((c) => c === "setAuthentication");
    if (useIdx === -1)
        return { ok: true, why: "无 use（本链不消费认证）" };
    if (verifyIdx === -1)
        return { ok: false, why: "use(setAuthentication) 之前无 verify" };
    return verifyIdx < useIdx
        ? { ok: true, why: "verify→use 序正确" }
        : { ok: false, why: "use 先于 verify" };
}
const REAL_FILTER = `package io.spring.api.security;
public class JwtTokenFilter {
  @Override
  protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws Exception {
    getTokenString(request.getHeader(header))
        .flatMap(token -> jwtService.getSubFromToken(token))
        .ifPresent(id -> {
          if (SecurityContextHolder.getContext().getAuthentication() == null) {
            setAuthentication(id, request);   // use：信任已验 token
          }
        });
    chain.doFilter(request, response);
  }
}`;
// 变异：删掉 verify（真实违规：未验 token 直接信任）
const MUT_FILTER = REAL_FILTER.replace("        .flatMap(token -> jwtService.getSubFromToken(token))", "        .map(id -> id)");
(0, vitest_1.describe)("协议行金标 v1 — token 生命周期（verify-before-use）", () => {
    (0, vitest_1.it)("原文链：verify 先于 use → 合规", () => {
        const fp = path.join(dir, "JwtTokenFilter.java");
        fs.writeFileSync(fp, REAL_FILTER);
        const fns = (0, extract_ir_java_1.extractJavaFile)(fp);
        const calls = fns.find((f) => f.name === "doFilterInternal").calls;
        (0, vitest_1.expect)(tokenVerifyBeforeUse(calls).ok).toBe(true);
        (0, vitest_1.expect)(tokenVerifyBeforeUse(calls).why).toContain("verify→use");
    });
    (0, vitest_1.it)("变异（摘 verify）：use 前无 verify → 违规被判定（0-FP 语义负例）", () => {
        const fp = path.join(dir, "JwtTokenFilter.java");
        fs.writeFileSync(fp, MUT_FILTER);
        const fns = (0, extract_ir_java_1.extractJavaFile)(fp);
        const calls = fns.find((f) => f.name === "doFilterInternal").calls;
        (0, vitest_1.expect)(tokenVerifyBeforeUse(calls).ok).toBe(false);
        (0, vitest_1.expect)(tokenVerifyBeforeUse(calls).why).toContain("无 verify");
    });
});
// ── 恢复率裁决修复回归（spring-realworld AST 基准实测根因，2026-09-05）──
(0, vitest_1.describe)("恢复率裁决修复回归（spring-realworld 实测三根因）", () => {
    (0, vitest_1.it)("参数注解实参括号：@PathVariable(\"slug\") 不截断参数列表", () => {
        const fp = path.join(dir, "ArticleApi.java");
        fs.writeFileSync(fp, `package app;
public class ArticleApi {
  @DeleteMapping
  public ResponseEntity deleteArticle(
      @PathVariable("slug") String slug, @AuthenticationPrincipal User user) {
    return articleRepository.findBySlug(slug);
  }
}`);
        const fns = (0, extract_ir_java_1.extractJavaFile)(fp);
        const fn = fns.find((f) => f.name === "deleteArticle");
        (0, vitest_1.expect)(fn).toBeTruthy();
        (0, vitest_1.expect)(fn.params.map((p) => p.name)).toEqual(["slug", "user"]);
    });
    (0, vitest_1.it)("通配符泛型返回类型：ResponseEntity<?> 方法被提取", () => {
        const fp = path.join(dir, "Wildcard.java");
        fs.writeFileSync(fp, `package app;
public class Wildcard {
  public ResponseEntity<?> article(String slug) {
    return ResponseEntity.ok(slug);
  }
}`);
        const fns = (0, extract_ir_java_1.extractJavaFile)(fp);
        (0, vitest_1.expect)(fns.some((f) => f.name === "article")).toBe(true);
    });
    (0, vitest_1.it)("构造器（无返回类型）：public Name(…) 被提取（含同行 @Autowired）", () => {
        const fp = path.join(dir, "UserService.java");
        fs.writeFileSync(fp, `package app;
public class UserService {
  @Autowired
  public UserService(
      UserRepository userRepository,
      @Value("\${image.default}") String defaultImage) {
    this.userRepository = userRepository;
  }
}`);
        const fns = (0, extract_ir_java_1.extractJavaFile)(fp);
        (0, vitest_1.expect)(fns.some((f) => f.name === "UserService")).toBe(true);
    });
    (0, vitest_1.it)("泛型对象构造调用：new HashMap<String, Object>() 的 HashMap 可见", () => {
        const fp = path.join(dir, "Resp.java");
        fs.writeFileSync(fp, `package app;
public class Resp {
  public Map<?, ?> build() {
    Map<String, Object> m = new HashMap<String, Object>();
    return m;
  }
}`);
        const fns = (0, extract_ir_java_1.extractJavaFile)(fp);
        const calls = fns.find((f) => f.name === "build").calls;
        (0, vitest_1.expect)(calls).toContain("HashMap");
    });
    (0, vitest_1.it)("super/this 构造调用不算调用边", () => {
        const fp = path.join(dir, "Base.java");
        fs.writeFileSync(fp, `package app;
public class Base {
  public Base(int config) {
    super(config);
  }
}`);
        const fns = (0, extract_ir_java_1.extractJavaFile)(fp);
        const ctor = fns.find((f) => f.name === "Base");
        (0, vitest_1.expect)(ctor).toBeTruthy();
        (0, vitest_1.expect)(ctor.calls).not.toContain("super");
    });
});
// ── 接收者限定名匹配（名碰撞根因修复，2026-09-06）──
(0, vitest_1.describe)("接收者限定名匹配（className 捕获 + 限定调用输出）", () => {
    (0, vitest_1.it)("className 捕获：顶层类与嵌套类归属正确", () => {
        const fp = path.join(dir, "JacksonCustomizations.java");
        fs.writeFileSync(fp, `package app;
public class JacksonCustomizations {
  public void outer() {}
  public static class DateTimeSerializer {
    public void serialize() {}
    public static class Inner {
      public void innermost() {}
    }
  }
  public interface NestedIface {
    default void ifaceMethod() {}
  }
}`);
        const fns = (0, extract_ir_java_1.extractJavaFile)(fp);
        const byName = new Map(fns.map((f) => [f.name, f]));
        (0, vitest_1.expect)(byName.get("outer").className).toBe("JacksonCustomizations");
        (0, vitest_1.expect)(byName.get("serialize").className).toBe("DateTimeSerializer");
        (0, vitest_1.expect)(byName.get("innermost").className).toBe("Inner");
        (0, vitest_1.expect)(byName.get("ifaceMethod").className).toBe("NestedIface");
    });
    (0, vitest_1.it)("匿名类内方法 className 为 undefined（按无类名处理）", () => {
        const fp = path.join(dir, "Anon.java");
        fs.writeFileSync(fp, `package app;
public class Anon {
  public void setup() {
    Runnable r = new Runnable() {
      public void run() {
        doWork();
      }
    };
  }
}`);
        const fns = (0, extract_ir_java_1.extractJavaFile)(fp);
        (0, vitest_1.expect)(fns.find((f) => f.name === "run").className).toBeUndefined();
        (0, vitest_1.expect)(fns.find((f) => f.name === "setup").className).toBe("Anon");
    });
    (0, vitest_1.it)("record 声明形态：record Name(...) { 的类名被捕获", () => {
        const fp = path.join(dir, "Point.java");
        fs.writeFileSync(fp, `package app;
public record Point(int x, int y) {
  public int sum() { return x + y; }
}`);
        const fns = (0, extract_ir_java_1.extractJavaFile)(fp);
        (0, vitest_1.expect)(fns.find((f) => f.name === "sum").className).toBe("Point");
    });
    (0, vitest_1.it)("this. 前缀剥离：this.foo() 输出裸名", () => {
        const fp = path.join(dir, "Self.java");
        fs.writeFileSync(fp, `package app;
public class Self {
  public void outer() {
    this.inner();
  }
  public void inner() {}
}`);
        const fns = (0, extract_ir_java_1.extractJavaFile)(fp);
        (0, vitest_1.expect)(fns.find((f) => f.name === "outer").calls).toContain("inner");
        (0, vitest_1.expect)(fns.find((f) => f.name === "outer").calls).not.toContain("this.inner");
    });
    (0, vitest_1.it)("限定串去重：a.open() 与 b.open() 是两条不同调用边", () => {
        const fp = path.join(dir, "Multi.java");
        fs.writeFileSync(fp, `package app;
public class Multi {
  public void go(A a, B b) {
    a.open();
    b.open();
  }
}`);
        const fns = (0, extract_ir_java_1.extractJavaFile)(fp);
        const calls = fns.find((f) => f.name === "go").calls;
        (0, vitest_1.expect)(calls).toContain("a.open");
        (0, vitest_1.expect)(calls).toContain("b.open");
    });
    (0, vitest_1.it)("无接收者调用保持裸名（protocol 金标 exact-match 锁）", () => {
        const fp = path.join(dir, "Bare.java");
        fs.writeFileSync(fp, `package app;
public class Bare {
  public void caller() {
    setAuthentication(id, request);
  }
  public void setAuthentication(String id, Object r) {}
}`);
        const fns = (0, extract_ir_java_1.extractJavaFile)(fp);
        (0, vitest_1.expect)(fns.find((f) => f.name === "caller").calls).toContain("setAuthentication");
    });
});
