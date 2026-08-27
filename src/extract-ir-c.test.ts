/**
 * C IR extractor tests — fixture-string-based parser tests via parseCSource
 * (FS I/O limited to one mkdtemp integration case, per repo convention).
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { parseCSource, extractIRC } from "./extract-ir-c";
import type { FunctionInfo } from "./extract-ir";

const PROJECT = "/proj";

/** Parse a string as /proj/x.c → file "x.c". */
function parse(src: string, file = "x.c"): FunctionInfo[] {
  return parseCSource(src, path.join(PROJECT, file), PROJECT);
}

function fn(ir: FunctionInfo[], name: string): FunctionInfo {
  const f = ir.find((x) => x.name === name);
  expect(f, `expected function ${name}`).toBeDefined();
  return f!;
}

describe("extract-ir-c", () => {
  it("基础签名 + 调用列表（auth_flow fixture 内容）", () => {
    const ir = parse(`
int authenticate(const char* user, const char* pass) {
    if (!verify_password(user, pass)) return 0;
    char* token = generate_jwt(user);
    session_t* sess = create_session(token);
    return sess ? 1 : 0;
}
void do_logout(session_t* sess) {
    logout(sess);
}
`);
    expect(ir.map((f) => f.name)).toEqual(["authenticate", "do_logout"]);

    const auth = fn(ir, "authenticate");
    expect(auth.params).toEqual([
      { name: "user", type: "const char*" },
      { name: "pass", type: "const char*" },
    ]);
    expect(auth.returnType).toBe("int");
    expect(auth.calls).toEqual(["verify_password", "generate_jwt", "create_session"]);
    expect(auth.exported).toBe(true);
    expect(auth.external).toBe(false); // isProjectFn 契约
    expect(auth.file).toBe("x.c");
    expect(auth.tags).toEqual(["c"]);

    const logout = fn(ir, "do_logout");
    expect(logout.params).toEqual([{ name: "sess", type: "session_t*" }]);
    expect(logout.returnType).toBe("void");
    expect(logout.calls).toEqual(["logout"]);
    expect(logout.outputs).toEqual([]);
  });

  it("static 函数 → exported=false，仍被提取", () => {
    const ir = parse(`static int helper(int x) { return x; }`);
    const h = fn(ir, "helper");
    expect(h.exported).toBe(false);
    expect(h.params).toEqual([{ name: "x", type: "int" }]);
  });

  it("多行签名 + 无空格星号返回类型", () => {
    const ir = parse(`
int
compute(const char* a) {
    return strlen(a);
}
static const char*
get_name(void) {
    return "x";
}
`);
    const c = fn(ir, "compute");
    expect(c.returnType).toBe("int");
    expect(c.params).toEqual([{ name: "a", type: "const char*" }]);
    expect(c.calls).toEqual(["strlen"]);

    const g = fn(ir, "get_name");
    expect(g.returnType).toBe("const char*");
    expect(g.exported).toBe(false);
    expect(g.params).toEqual([]);
  });

  it("注释与字符串内的花括号不腐蚀括号计数", () => {
    const ir = parse(`
void f(void) {
    /* { */
    // }
    const char* s = "}";
    g();
}
void g2(void) { h(); }
`);
    expect(ir.map((x) => x.name)).toEqual(["f", "g2"]);
    expect(fn(ir, "f").calls).toEqual(["g"]);
    expect(fn(ir, "g2").calls).toEqual(["h"]);
  });

  it("字符串内容不产生调用", () => {
    const ir = parse(`void f(void) { const char* s = "foo("; g(); }`);
    expect(fn(ir, "f").calls).toEqual(["g"]);
  });

  it("块注释 @progmune 注解", () => {
    const ir = parse(`
/* @progmune(namespace="auth", pre=["UNAUTHENTICATED"], post=["PASSWORD_VERIFIED"]) */
void verify(const char* u, const char* p) { check(u, p); }
`);
    const v = fn(ir, "verify");
    expect(v.protocol).toEqual({
      namespace: "auth",
      pre_states: ["UNAUTHENTICATED"],
      post_states: ["PASSWORD_VERIFIED"],
    });
    expect(v.calls).toEqual(["check"]);
  });

  it("多行注解 + 全部文档标签", () => {
    const ir = parse(`
/*
 * @progmune(namespace="auth", pre=["A"], post=["B"], invalidate=["C"])
 * @purpose verify user
 * @description verifies credentials
 * @tags auth, security
 * @requires P1, P2
 * @produces T1
 * @useWhen login; recovery
 * @inputs user, pass
 * @outputs token
 */
int auth(const char* user, const char* pass) { return 1; }
`);
    const a = fn(ir, "auth");
    expect(a.protocol).toEqual({
      namespace: "auth",
      pre_states: ["A"],
      post_states: ["B"],
      invalidate: ["C"],
    });
    expect(a.purpose).toBe("verify user");
    expect(a.description).toBe("verifies credentials");
    expect(a.tags).toEqual(["auth", "security"]);
    expect(a.requires).toEqual(["P1", "P2"]);
    expect(a.produces).toEqual(["T1"]);
    expect(a.useWhen).toEqual(["login", "recovery"]);
    expect(a.inputs).toEqual(["user", "pass"]);
    expect(a.outputs).toEqual(["token"]);
  });

  it("// @progmune 单行变体", () => {
    const ir = parse(`
// @progmune(namespace="file", pre=["OPEN"], post=["CLOSED"])
void open_file(void) { }
`);
    expect(fn(ir, "open_file").protocol).toEqual({
      namespace: "file",
      pre_states: ["OPEN"],
      post_states: ["CLOSED"],
    });
  });

  it("注解与函数之间允许空行", () => {
    const ir = parse(`
/* @progmune(namespace="auth", pre=["A"], post=["B"]) */

void f(void) {}
`);
    expect(fn(ir, "f").protocol?.namespace).toBe("auth");
  });

  it("只有文档标签、无 @progmune → protocol undefined", () => {
    const ir = parse(`
/**
 * @purpose read config
 * @tags io
 */
void read_conf(void) { }
`);
    const r = fn(ir, "read_conf");
    expect(r.purpose).toBe("read config");
    expect(r.tags).toEqual(["io"]);
    expect(r.protocol).toBeUndefined();
  });

  it("纯文件头注释不挂载到首个函数", () => {
    const ir = parse(`
/* module overview — plain description */
int f(void) { return 0; }
`);
    const f = fn(ir, "f");
    expect(f.purpose).toBe("");
    expect(f.description).toBe("");
    expect(f.protocol).toBeUndefined();
  });

  it("参数边界：数组/多维/函数指针/变参/裸 void/多词类型", () => {
    const ir = parse(`
void a(char buf[256]) {}
void b(int m[2][3]) {}
void c(void (*cb)(int)) {}
void d(...) {}
void e(void) {}
void g(unsigned long long n) {}
`);
    expect(fn(ir, "a").params).toEqual([{ name: "buf", type: "char" }]);
    expect(fn(ir, "b").params).toEqual([{ name: "m", type: "int" }]);
    expect(fn(ir, "c").params).toEqual([{ name: "cb", type: "void (*cb)(int)" }]);
    expect(fn(ir, "d").params).toEqual([{ name: "...", type: "..." }]);
    expect(fn(ir, "e").params).toEqual([]);
    expect(fn(ir, "g").params).toEqual([{ name: "n", type: "unsigned long long" }]);
  });

  it("成员调用取 ->/. 之后的调用名（函数指针分发仍静态不可见）", () => {
    const ir = parse(`void close_conn(conn_t* cf) { cf->close_one(); cf->next->close_two(); obj.method(x); }`);
    expect(fn(ir, "close_conn").calls).toEqual(["close_one", "close_two", "method"]);
  });

  it("自调用被排除；重复调用保留（状态机需要重复语义）", () => {
    const ir = parse(`void f(void) { f(); g(); g(); h(); }`);
    expect(fn(ir, "f").calls).toEqual(["g", "g", "h"]);
  });

  it("struct 定义体被跳过（单行 + 多行）", () => {
    const ir = parse(`
typedef struct { int x; } Foo;
void after_struct(void) { g(); }
typedef struct {
    int x;
} Bar;
void after_struct2(void) { h(); }
`);
    expect(ir.map((x) => x.name)).toEqual(["after_struct", "after_struct2"]);
    expect(fn(ir, "after_struct").calls).toEqual(["g"]);
    expect(fn(ir, "after_struct2").calls).toEqual(["h"]);
  });

  it("goto 合成 goto_<label> 调用", () => {
    const ir = parse(`void f(void) { goto cleanup; g(); cleanup: ; }`);
    expect(fn(ir, "f").calls).toEqual(["g", "goto_cleanup"]);
  });

  it("函数体内的预处理行整体跳过（花括号与调用均不计数）", () => {
    const ir = parse(`
void f(void) {
#define X {
#undef X
    g();
}
`);
    expect(fn(ir, "f").calls).toEqual(["g"]);
  });

  it("嵌套块括号正确闭合", () => {
    const ir = parse(`void f(void) { if (x) { g(); } h(); }`);
    expect(fn(ir, "f").calls).toEqual(["g", "h"]);
  });

  it("__attribute__ 前缀被剥离，不进返回类型", () => {
    const ir = parse(`
static __attribute__((unused)) int helper(void) { return 0; }
void caller(void) { helper(); }
`);
    const h = fn(ir, "helper");
    expect(h.returnType).toBe("int");
    expect(h.exported).toBe(false);
    expect(fn(ir, "caller").calls).toEqual(["helper"]);
  });

  it("头文件原型被忽略；static inline 定义被提取", () => {
    const ir = parse(`
int prototype_only(const char* x);
static inline int add1(int x) { return x + 1; }
`, "header.h");
    expect(ir.map((x) => x.name)).toEqual(["add1"]);
    expect(fn(ir, "add1").exported).toBe(false);
    expect(fn(ir, "add1").params).toEqual([{ name: "x", type: "int" }]);
  });

  it("extractIRC 集成：真实 fixture 内容", () => {
    const authFlow = `
    int authenticate(const char* user, const char* pass) {
        if (!verify_password(user, pass)) return 0;
        char* token = generate_jwt(user);
        session_t* sess = create_session(token);
        return sess ? 1 : 0;
    }
    void do_logout(session_t* sess) {
        logout(sess);
    }
`;
    const dbHandler = `
    void run_query(const char* host, const char* sql) {
        connect_db(host);
        query_db(sql);
        disconnect_db();
    }
    void run_insert(const char* host, const char* data) {
        connect_db(host);
        query_db(data);
        disconnect_db();
    }
    void verify_and_session(const char* user, const char* pass) {
        verify_password(user, pass);
        generate_jwt(user);
        create_session();
    }
    void auth_and_logout(const char* user, const char* pass) {
        verify_password(user, pass);
        generate_jwt(user);
        create_session();
        logout();
    }
`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-c-"));
    try {
      fs.writeFileSync(path.join(dir, "auth_flow.c"), authFlow);
      fs.mkdirSync(path.join(dir, "src"), { recursive: true });
      fs.writeFileSync(path.join(dir, "src", "db_handler.c"), dbHandler);

      const ir = extractIRC(dir);
      expect(ir.map((f) => f.name).sort()).toEqual([
        "auth_and_logout", "authenticate", "do_logout",
        "run_insert", "run_query", "verify_and_session",
      ]);

      const runQuery = fn(ir, "run_query");
      expect(runQuery.file).toBe(path.join("src", "db_handler.c"));
      expect(runQuery.calls).toEqual(["connect_db", "query_db", "disconnect_db"]);
      expect(fn(ir, "auth_and_logout").calls).toEqual(["verify_password", "generate_jwt", "create_session", "logout"]);

      // isProjectFn 契约：全部 external=false + 真实相对路径
      for (const f of ir) {
        expect(f.external).toBe(false);
        expect(f.file).toBeTruthy();
        expect(f.file).not.toBe("(external)");
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("回归：顶层长标识符调用赋值行不触发指数级回溯（44 字符缓冲 11s → 即时）", () => {
    // libssh authentication.c 真实触发：v2 签名正则的类型 token 循环对
    // `name = ssh_userauth_kbdint_getname(session);` 穷举标识符切分（2^k）
    const t0 = Date.now();
    const ir = parse(`
int f(void) { return 0; }
name = ssh_userauth_kbdint_getname(session);
int g(void) { return 1; }
`);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(ir.map((x) => x.name)).toEqual(["f", "g"]);
  });

  it("非生产表面目录被跳过：tests/examples/deps 与测试文件名（Python 先例同款）", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-surface-"));
    try {
      fs.writeFileSync(path.join(dir, "main.c"), "void prod(void) {}\n");
      fs.mkdirSync(path.join(dir, "tests"), { recursive: true });
      fs.writeFileSync(path.join(dir, "tests", "torture_x.c"), "void in_tests(void) {}\n");
      fs.mkdirSync(path.join(dir, "examples"), { recursive: true });
      fs.writeFileSync(path.join(dir, "examples", "demo.c"), "void in_examples(void) {}\n");
      fs.mkdirSync(path.join(dir, "deps", "vendor_lib"), { recursive: true });
      fs.writeFileSync(path.join(dir, "deps", "vendor_lib", "lib.c"), "void in_deps(void) {}\n");
      fs.writeFileSync(path.join(dir, "helper_test.c"), "void testfile(void) {}\n");

      const ir = extractIRC(dir);
      expect(ir.map((f) => f.name)).toEqual(["prod"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("#if 0 死代码块被剥离：体内不平衡花括号不腐蚀计数", () => {
    const ir = parse(`
void f(void) {
#if 0
    void dead(void) { { {
#endif
    g();
}
void g2(void) { h(); }
`);
    expect(ir.map((x) => x.name)).toEqual(["f", "g2"]);
    expect(fn(ir, "f").calls).toEqual(["g"]);
    expect(fn(ir, "g2").calls).toEqual(["h"]);
  });

  it("#if 0 死代码块被剥离：顶层死函数不产生幻影函数；嵌套 #if 死区内保持死", () => {
    const ir = parse(`
#if 0
void dead_fn(void) { broken {
#if 1
void dead_inner(void) { { {
#endif
void also_dead(void) { { {
#endif
void live_fn(void) { g(); }
`);
    expect(ir.map((x) => x.name)).toEqual(["live_fn"]);
    expect(fn(ir, "live_fn").calls).toEqual(["g"]);
  });

  it("#if 0 || X 表达式不求值，按活区处理", () => {
    const ir = parse(`
#if 0 || 1
void maybe_live(void) { g(); }
#endif
void after(void) { h(); }
`);
    expect(ir.map((x) => x.name)).toEqual(["maybe_live", "after"]);
    expect(fn(ir, "maybe_live").calls).toEqual(["g"]);
  });
});

describe("extract-ir-c pointer-return regression", () => {
  it("单行指针返回函数必须被提取（char */SSL */const char */FILE * 等）", () => {
    const src = [
      "int a(void) { return 1; }",
      "char *b(void) { return 0; }",
      "SSL *c(SSL_CTX *ctx) { return 0; }",
      "const char *d(int x) { return 0; }",
      "static FILE *f(void) { return 0; }",
      "int (*handler)(int) { return 0; }",
    ].join("\n");
    const fns = parseCSource(src, "ptr.c", "/");
    const names = fns.map((f) => f.name);
    expect(names).toEqual(expect.arrayContaining(["b", "c", "d", "f"]));
    // 函数指针变量不是函数定义
    expect(names).not.toContain("handler");
    // 返回类型保留指针
    const c = fns.find((f) => f.name === "c");
    expect(c?.returnType).toBe("SSL *");
  });
});
