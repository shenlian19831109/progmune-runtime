/**
 * extract-ir-java.test.ts — Java 提取器回归（纯字符串 + 临时目录）
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { extractJavaFile } from "./extract-ir-java";

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "javair-")); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

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

describe("extract-ir-java", () => {
  it("@Override 注解方法被提取（不会被 @ 前导过滤误杀）", () => {
    const fp = path.join(dir, "JwtTokenFilter.java");
    fs.writeFileSync(fp, SAMPLE);
    const fns = extractJavaFile(fp);
    expect(fns.some((f) => f.name === "doFilterInternal")).toBe(true);
    expect(fns.some((f) => f.name === "getTokenString")).toBe(true);
  });

  it("方法调用边（calls）被提取——JWT 认证链可见", () => {
    const fp = path.join(dir, "JwtTokenFilter.java");
    fs.writeFileSync(fp, SAMPLE);
    const fns = extractJavaFile(fp);
    const filter = fns.find((f) => f.name === "doFilterInternal");
    expect(filter!.calls).toContain("getSubFromToken");
    expect(filter!.calls).toContain("getAuthentication");
    expect(filter!.calls).toContain("setAuthentication");
    // 关键字不算调用
    expect(filter!.calls).not.toContain("if");
  });

  it("基础方法提取", () => {
    const fp = path.join(dir, "Plain.java");
    fs.writeFileSync(fp, `package app;
public class Plain {
  public Plain() {}
  public int add(int a, int b) { return a + b; }
}`);
    const fns = extractJavaFile(fp);
    expect(fns.some((f) => f.name === "add")).toBe(true);
  });
});
