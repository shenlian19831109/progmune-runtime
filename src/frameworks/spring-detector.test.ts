/**
 * spring-detector.test.ts — Spring 路由覆盖模型回归（纯函数 + 临时目录）
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { analyzeSpringProject, antToRegex } from "./spring-detector";

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "spring-det-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function writeJava(rel: string, content: string) {
  const fp = path.join(dir, rel);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, content);
}
const PKG = "package app;\nimport org.springframework.web.bind.annotation.*;\n";
const SEC = (catchAll: string) => `${PKG}
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
@Configuration @EnableWebSecurity
public class WebSecurityConfig extends WebSecurityConfigurerAdapter {
  @Override protected void configure(HttpSecurity http) throws Exception {
    http.csrf().disable().authorizeRequests()
      .antMatchers(HttpMethod.POST, "/users", "/users/login").permitAll()
      .antMatchers(HttpMethod.GET, "/articles/**", "/tags").permitAll()
      .antMatchers(HttpMethod.GET, "/articles/feed").authenticated()
      .anyRequest().${catchAll}();
    http.addFilterBefore(new JwtTokenFilter(), UsernamePasswordAuthenticationFilter.class);
  }
}`;
const CTRL = `${PKG}
@RestController @RequestMapping(path = "articles")
public class ArticleApi {
  @PostMapping public Object create() { return null; }
  @PutMapping("/{slug}") public Object update() { return null; }
  @GetMapping("/{slug}") public Object one() { return null; }
  @DeleteMapping("/{slug}") public Object del() { return null; }
}`;

describe("antToRegex", () => {
  it("ant 模式转正则", () => {
    expect(antToRegex("/articles/**").test("/articles/abc")).toBe(true);
    expect(antToRegex("/articles/**").test("/articles/abc/def")).toBe(true);
    expect(antToRegex("/articles/*").test("/articles/abc")).toBe(true);
    expect(antToRegex("/articles/*").test("/articles/abc/def")).toBe(false);
    expect(antToRegex("/users").test("/users")).toBe(true);
    expect(antToRegex("/users").test("/users/x")).toBe(false);
  });
});

describe("analyzeSpringProject", () => {
  it("anyRequest().authenticated() 兜底：受保护 mutation 不报", () => {
    writeJava("sec/WebSecurityConfig.java", SEC("authenticated"));
    writeJava("api/ArticleApi.java", CTRL);
    const a = analyzeSpringProject(dir);
    expect(a.hasSecurityConfig).toBe(true);
    expect(a.catchAll).toBe("authenticated");
    expect(a.issues).toHaveLength(0);
    const art = a.routes.find((r) => r.method === "post" && r.path === "/articles");
    expect(art!.access).toBe("authenticated");
  });

  it("翻兜底为 permitAll → mutation 重现（敏感性）", () => {
    writeJava("sec/WebSecurityConfig.java", SEC("permitAll"));
    writeJava("api/ArticleApi.java", CTRL);
    const a = analyzeSpringProject(dir);
    const flags = a.issues.map((i) => i.route);
    expect(flags).toContain("POST /articles");
    expect(flags).toContain("PUT /articles/{slug}");
    expect(flags).toContain("DELETE /articles/{slug}");
    // GET 读不查
    expect(flags).not.toContain("GET /articles/{slug}");
  });

  it("register/login（permitAll + 姊妹佐证）不报", () => {
    writeJava("sec/WebSecurityConfig.java", SEC("authenticated"));
    writeJava("api/UsersApi.java", `${PKG}
@RestController public class UsersApi {
  @RequestMapping(path = "/users", method = POST) public Object reg() { return null; }
  @RequestMapping(path = "/users/login", method = POST) public Object login() { return null; }
}`);
    const a = analyzeSpringProject(dir);
    expect(a.issues).toHaveLength(0);
  });

  it("无安全配置 → mutation 报（无认证裸奔）", () => {
    writeJava("api/ArticleApi.java", CTRL);
    const a = analyzeSpringProject(dir);
    expect(a.hasSecurityConfig).toBe(false);
    expect(a.issues.some((i) => i.route === "POST /articles")).toBe(true);
  });
});

// ── Spring 方言扩展：SecurityFilterChain bean + requestMatchers + @PreAuthorize ──

const SEC_BEAN = `${PKG}
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
@Configuration @EnableWebSecurity
public class WebSecurityConfig {
  @Bean
  public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    http.csrf().disable().authorizeHttpRequests(auth -> auth
      .requestMatchers(HttpMethod.POST, "/users", "/users/login").permitAll()
      .requestMatchers(HttpMethod.GET, "/articles/**", "/tags").permitAll()
      .requestMatchers(HttpMethod.GET, "/articles/feed").authenticated()
      .anyRequest().authenticated());
    return http.build();
  }
}`;

const ADMIN_CTRL = `${PKG}
@RestController @RequestMapping(path = "admin")
@PreAuthorize("hasRole('ADMIN')")
public class AdminApi {
  @DeleteMapping("/users/{id}") public Object ban() { return null; }
  @PostMapping("/reset") public Object reset() { return null; }
}`;

describe("spring 方言扩展（2026-09-02）", () => {
  it("SecurityFilterChain bean + authorizeHttpRequests + requestMatchers 解析", () => {
    writeJava("sec/WebSecurityConfig.java", SEC_BEAN);
    writeJava("api/ArticleApi.java", CTRL);
    const a = analyzeSpringProject(dir);
    expect(a.hasSecurityConfig).toBe(true);
    expect(a.catchAll).toBe("authenticated");
    expect(a.issues).toHaveLength(0);
    const post = a.routes.find((r) => r.method === "post" && r.path === "/articles");
    expect(post!.access).toBe("authenticated");
  });

  it("类级 @PreAuthorize → 该类 mutation 全部受保护（不报）", () => {
    writeJava("sec/WebSecurityConfig.java", SEC("permitAll")); // 兜底全公开
    writeJava("api/AdminApi.java", ADMIN_CTRL);
    const a = analyzeSpringProject(dir);
    // 兜底 permitAll 下，无注解类会报；@PreAuthorize 类不报
    expect(a.issues.some((i) => i.route === "DELETE /admin/users/{id}")).toBe(false);
    expect(a.issues.some((i) => i.route === "POST /admin/reset")).toBe(false);
  });

  it("方言反证：requestMatchers permitAll 的 mutation 公开（register 豁免外仍查）", () => {
    const cfg = SEC_BEAN.replace(
      ".requestMatchers(HttpMethod.GET, \"/articles/**\", \"/tags\").permitAll()",
      ".requestMatchers(HttpMethod.GET, \"/articles/**\", \"/tags\", \"/payments\").permitAll()"
    ).replace(/\.anyRequest\(\)\.authenticated\(\)/, ".anyRequest().permitAll()");
    writeJava("sec/WebSecurityConfig.java", cfg);
    writeJava("api/ArticleApi.java", CTRL);
    const a = analyzeSpringProject(dir);
    expect(a.issues.some((i) => i.route === "POST /articles")).toBe(true);
  });
});
