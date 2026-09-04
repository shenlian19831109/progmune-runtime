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

// ── 协议行金标 v1：token 生命周期（verify 先于 use，2026-09-02）──

/** 真实语料 token 链的 verify-before-use 判定（金标规则 v1）：
 *  doFilterInternal 的调用序须满足 getSubFromToken（verify）先于
 *  setAuthentication（use/信任）。 */
function tokenVerifyBeforeUse(calls: string[] | undefined): { ok: boolean; why: string } {
  if (!calls) return { ok: false, why: "无调用边" };
  const verifyIdx = calls.findIndex((c) => /getSubFromToken|verify/.test(c));
  const useIdx = calls.findIndex((c) => c === "setAuthentication");
  if (useIdx === -1) return { ok: true, why: "无 use（本链不消费认证）" };
  if (verifyIdx === -1) return { ok: false, why: "use(setAuthentication) 之前无 verify" };
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
const MUT_FILTER = REAL_FILTER.replace(
  "        .flatMap(token -> jwtService.getSubFromToken(token))",
  "        .map(id -> id)"
);

describe("协议行金标 v1 — token 生命周期（verify-before-use）", () => {
  it("原文链：verify 先于 use → 合规", () => {
    const fp = path.join(dir, "JwtTokenFilter.java");
    fs.writeFileSync(fp, REAL_FILTER);
    const fns = extractJavaFile(fp);
    const calls = fns.find((f) => f.name === "doFilterInternal")!.calls;
    expect(tokenVerifyBeforeUse(calls).ok).toBe(true);
    expect(tokenVerifyBeforeUse(calls).why).toContain("verify→use");
  });

  it("变异（摘 verify）：use 前无 verify → 违规被判定（0-FP 语义负例）", () => {
    const fp = path.join(dir, "JwtTokenFilter.java");
    fs.writeFileSync(fp, MUT_FILTER);
    const fns = extractJavaFile(fp);
    const calls = fns.find((f) => f.name === "doFilterInternal")!.calls;
    expect(tokenVerifyBeforeUse(calls).ok).toBe(false);
    expect(tokenVerifyBeforeUse(calls).why).toContain("无 verify");
  });
});
