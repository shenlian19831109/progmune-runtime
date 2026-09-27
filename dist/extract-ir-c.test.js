"use strict";
/**
 * C IR extractor tests — fixture-string-based parser tests via parseCSource
 * (FS I/O limited to one mkdtemp integration case, per repo convention).
 */
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
const vitest_1 = require("vitest");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const extract_ir_c_1 = require("./extract-ir-c");
const PROJECT = "/proj";
/** Parse a string as /proj/x.c → file "x.c". */
function parse(src, file = "x.c") {
    return (0, extract_ir_c_1.parseCSource)(src, path.join(PROJECT, file), PROJECT);
}
function fn(ir, name) {
    const f = ir.find((x) => x.name === name);
    (0, vitest_1.expect)(f, `expected function ${name}`).toBeDefined();
    return f;
}
(0, vitest_1.describe)("extract-ir-c", () => {
    (0, vitest_1.it)("基础签名 + 调用列表（auth_flow fixture 内容）", () => {
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
        (0, vitest_1.expect)(ir.map((f) => f.name)).toEqual(["authenticate", "do_logout"]);
        const auth = fn(ir, "authenticate");
        (0, vitest_1.expect)(auth.params).toEqual([
            { name: "user", type: "const char*" },
            { name: "pass", type: "const char*" },
        ]);
        (0, vitest_1.expect)(auth.returnType).toBe("int");
        (0, vitest_1.expect)(auth.calls).toEqual(["verify_password", "generate_jwt", "create_session"]);
        (0, vitest_1.expect)(auth.exported).toBe(true);
        (0, vitest_1.expect)(auth.external).toBe(false); // isProjectFn 契约
        (0, vitest_1.expect)(auth.file).toBe("x.c");
        (0, vitest_1.expect)(auth.tags).toEqual(["c"]);
        const logout = fn(ir, "do_logout");
        (0, vitest_1.expect)(logout.params).toEqual([{ name: "sess", type: "session_t*" }]);
        (0, vitest_1.expect)(logout.returnType).toBe("void");
        (0, vitest_1.expect)(logout.calls).toEqual(["logout"]);
        (0, vitest_1.expect)(logout.outputs).toEqual([]);
    });
    (0, vitest_1.it)("static 函数 → exported=false，仍被提取", () => {
        const ir = parse(`static int helper(int x) { return x; }`);
        const h = fn(ir, "helper");
        (0, vitest_1.expect)(h.exported).toBe(false);
        (0, vitest_1.expect)(h.params).toEqual([{ name: "x", type: "int" }]);
    });
    (0, vitest_1.it)("多行签名 + 无空格星号返回类型", () => {
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
        (0, vitest_1.expect)(c.returnType).toBe("int");
        (0, vitest_1.expect)(c.params).toEqual([{ name: "a", type: "const char*" }]);
        (0, vitest_1.expect)(c.calls).toEqual(["strlen"]);
        const g = fn(ir, "get_name");
        (0, vitest_1.expect)(g.returnType).toBe("const char*");
        (0, vitest_1.expect)(g.exported).toBe(false);
        (0, vitest_1.expect)(g.params).toEqual([]);
    });
    (0, vitest_1.it)("注释与字符串内的花括号不腐蚀括号计数", () => {
        const ir = parse(`
void f(void) {
    /* { */
    // }
    const char* s = "}";
    g();
}
void g2(void) { h(); }
`);
        (0, vitest_1.expect)(ir.map((x) => x.name)).toEqual(["f", "g2"]);
        (0, vitest_1.expect)(fn(ir, "f").calls).toEqual(["g"]);
        (0, vitest_1.expect)(fn(ir, "g2").calls).toEqual(["h"]);
    });
    (0, vitest_1.it)("字符串内容不产生调用", () => {
        const ir = parse(`void f(void) { const char* s = "foo("; g(); }`);
        (0, vitest_1.expect)(fn(ir, "f").calls).toEqual(["g"]);
    });
    (0, vitest_1.it)("块注释 @progmune 注解", () => {
        const ir = parse(`
/* @progmune(namespace="auth", pre=["UNAUTHENTICATED"], post=["PASSWORD_VERIFIED"]) */
void verify(const char* u, const char* p) { check(u, p); }
`);
        const v = fn(ir, "verify");
        (0, vitest_1.expect)(v.protocol).toEqual({
            namespace: "auth",
            pre_states: ["UNAUTHENTICATED"],
            post_states: ["PASSWORD_VERIFIED"],
        });
        (0, vitest_1.expect)(v.calls).toEqual(["check"]);
    });
    (0, vitest_1.it)("多行注解 + 全部文档标签", () => {
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
        (0, vitest_1.expect)(a.protocol).toEqual({
            namespace: "auth",
            pre_states: ["A"],
            post_states: ["B"],
            invalidate: ["C"],
        });
        (0, vitest_1.expect)(a.purpose).toBe("verify user");
        (0, vitest_1.expect)(a.description).toBe("verifies credentials");
        (0, vitest_1.expect)(a.tags).toEqual(["auth", "security"]);
        (0, vitest_1.expect)(a.requires).toEqual(["P1", "P2"]);
        (0, vitest_1.expect)(a.produces).toEqual(["T1"]);
        (0, vitest_1.expect)(a.useWhen).toEqual(["login", "recovery"]);
        (0, vitest_1.expect)(a.inputs).toEqual(["user", "pass"]);
        (0, vitest_1.expect)(a.outputs).toEqual(["token"]);
    });
    (0, vitest_1.it)("// @progmune 单行变体", () => {
        const ir = parse(`
// @progmune(namespace="file", pre=["OPEN"], post=["CLOSED"])
void open_file(void) { }
`);
        (0, vitest_1.expect)(fn(ir, "open_file").protocol).toEqual({
            namespace: "file",
            pre_states: ["OPEN"],
            post_states: ["CLOSED"],
        });
    });
    (0, vitest_1.it)("注解与函数之间允许空行", () => {
        const ir = parse(`
/* @progmune(namespace="auth", pre=["A"], post=["B"]) */

void f(void) {}
`);
        (0, vitest_1.expect)(fn(ir, "f").protocol?.namespace).toBe("auth");
    });
    (0, vitest_1.it)("只有文档标签、无 @progmune → protocol undefined", () => {
        const ir = parse(`
/**
 * @purpose read config
 * @tags io
 */
void read_conf(void) { }
`);
        const r = fn(ir, "read_conf");
        (0, vitest_1.expect)(r.purpose).toBe("read config");
        (0, vitest_1.expect)(r.tags).toEqual(["io"]);
        (0, vitest_1.expect)(r.protocol).toBeUndefined();
    });
    (0, vitest_1.it)("纯文件头注释不挂载到首个函数", () => {
        const ir = parse(`
/* module overview — plain description */
int f(void) { return 0; }
`);
        const f = fn(ir, "f");
        (0, vitest_1.expect)(f.purpose).toBe("");
        (0, vitest_1.expect)(f.description).toBe("");
        (0, vitest_1.expect)(f.protocol).toBeUndefined();
    });
    (0, vitest_1.it)("参数边界：数组/多维/函数指针/变参/裸 void/多词类型", () => {
        const ir = parse(`
void a(char buf[256]) {}
void b(int m[2][3]) {}
void c(void (*cb)(int)) {}
void d(...) {}
void e(void) {}
void g(unsigned long long n) {}
`);
        (0, vitest_1.expect)(fn(ir, "a").params).toEqual([{ name: "buf", type: "char" }]);
        (0, vitest_1.expect)(fn(ir, "b").params).toEqual([{ name: "m", type: "int" }]);
        (0, vitest_1.expect)(fn(ir, "c").params).toEqual([{ name: "cb", type: "void (*cb)(int)" }]);
        (0, vitest_1.expect)(fn(ir, "d").params).toEqual([{ name: "...", type: "..." }]);
        (0, vitest_1.expect)(fn(ir, "e").params).toEqual([]);
        (0, vitest_1.expect)(fn(ir, "g").params).toEqual([{ name: "n", type: "unsigned long long" }]);
    });
    (0, vitest_1.it)("成员调用取 ->/. 之后的调用名（函数指针分发仍静态不可见）", () => {
        const ir = parse(`void close_conn(conn_t* cf) { cf->close_one(); cf->next->close_two(); obj.method(x); }`);
        (0, vitest_1.expect)(fn(ir, "close_conn").calls).toEqual(["close_one", "close_two", "method"]);
    });
    (0, vitest_1.it)("自调用被排除；重复调用保留（状态机需要重复语义）", () => {
        const ir = parse(`void f(void) { f(); g(); g(); h(); }`);
        (0, vitest_1.expect)(fn(ir, "f").calls).toEqual(["g", "g", "h"]);
    });
    (0, vitest_1.it)("struct 定义体被跳过（单行 + 多行）", () => {
        const ir = parse(`
typedef struct { int x; } Foo;
void after_struct(void) { g(); }
typedef struct {
    int x;
} Bar;
void after_struct2(void) { h(); }
`);
        (0, vitest_1.expect)(ir.map((x) => x.name)).toEqual(["after_struct", "after_struct2"]);
        (0, vitest_1.expect)(fn(ir, "after_struct").calls).toEqual(["g"]);
        (0, vitest_1.expect)(fn(ir, "after_struct2").calls).toEqual(["h"]);
    });
    (0, vitest_1.it)("goto 合成 goto_<label> 调用", () => {
        const ir = parse(`void f(void) { goto cleanup; g(); cleanup: ; }`);
        (0, vitest_1.expect)(fn(ir, "f").calls).toEqual(["g", "goto_cleanup"]);
    });
    (0, vitest_1.it)("函数体内的预处理行整体跳过（花括号与调用均不计数）", () => {
        const ir = parse(`
void f(void) {
#define X {
#undef X
    g();
}
`);
        (0, vitest_1.expect)(fn(ir, "f").calls).toEqual(["g"]);
    });
    (0, vitest_1.it)("嵌套块括号正确闭合", () => {
        const ir = parse(`void f(void) { if (x) { g(); } h(); }`);
        (0, vitest_1.expect)(fn(ir, "f").calls).toEqual(["g", "h"]);
    });
    (0, vitest_1.it)("__attribute__ 前缀被剥离，不进返回类型", () => {
        const ir = parse(`
static __attribute__((unused)) int helper(void) { return 0; }
void caller(void) { helper(); }
`);
        const h = fn(ir, "helper");
        (0, vitest_1.expect)(h.returnType).toBe("int");
        (0, vitest_1.expect)(h.exported).toBe(false);
        (0, vitest_1.expect)(fn(ir, "caller").calls).toEqual(["helper"]);
    });
    (0, vitest_1.it)("头文件原型被忽略；static inline 定义被提取", () => {
        const ir = parse(`
int prototype_only(const char* x);
static inline int add1(int x) { return x + 1; }
`, "header.h");
        (0, vitest_1.expect)(ir.map((x) => x.name)).toEqual(["add1"]);
        (0, vitest_1.expect)(fn(ir, "add1").exported).toBe(false);
        (0, vitest_1.expect)(fn(ir, "add1").params).toEqual([{ name: "x", type: "int" }]);
    });
    (0, vitest_1.it)("extractIRC 集成：真实 fixture 内容", () => {
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
            const ir = (0, extract_ir_c_1.extractIRC)(dir);
            (0, vitest_1.expect)(ir.map((f) => f.name).sort()).toEqual([
                "auth_and_logout", "authenticate", "do_logout",
                "run_insert", "run_query", "verify_and_session",
            ]);
            const runQuery = fn(ir, "run_query");
            (0, vitest_1.expect)(runQuery.file).toBe(path.join("src", "db_handler.c"));
            (0, vitest_1.expect)(runQuery.calls).toEqual(["connect_db", "query_db", "disconnect_db"]);
            (0, vitest_1.expect)(fn(ir, "auth_and_logout").calls).toEqual(["verify_password", "generate_jwt", "create_session", "logout"]);
            // isProjectFn 契约：全部 external=false + 真实相对路径
            for (const f of ir) {
                (0, vitest_1.expect)(f.external).toBe(false);
                (0, vitest_1.expect)(f.file).toBeTruthy();
                (0, vitest_1.expect)(f.file).not.toBe("(external)");
            }
        }
        finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
    (0, vitest_1.it)("回归：顶层长标识符调用赋值行不触发指数级回溯（44 字符缓冲 11s → 即时）", () => {
        // libssh authentication.c 真实触发：v2 签名正则的类型 token 循环对
        // `name = ssh_userauth_kbdint_getname(session);` 穷举标识符切分（2^k）
        const t0 = Date.now();
        const ir = parse(`
int f(void) { return 0; }
name = ssh_userauth_kbdint_getname(session);
int g(void) { return 1; }
`);
        (0, vitest_1.expect)(Date.now() - t0).toBeLessThan(2000);
        (0, vitest_1.expect)(ir.map((x) => x.name)).toEqual(["f", "g"]);
    });
    (0, vitest_1.it)("非生产表面目录被跳过：tests/examples/deps 与测试文件名（Python 先例同款）", () => {
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
            const ir = (0, extract_ir_c_1.extractIRC)(dir);
            (0, vitest_1.expect)(ir.map((f) => f.name)).toEqual(["prod"]);
        }
        finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
    (0, vitest_1.it)("#if 0 死代码块被剥离：体内不平衡花括号不腐蚀计数", () => {
        const ir = parse(`
void f(void) {
#if 0
    void dead(void) { { {
#endif
    g();
}
void g2(void) { h(); }
`);
        (0, vitest_1.expect)(ir.map((x) => x.name)).toEqual(["f", "g2"]);
        (0, vitest_1.expect)(fn(ir, "f").calls).toEqual(["g"]);
        (0, vitest_1.expect)(fn(ir, "g2").calls).toEqual(["h"]);
    });
    (0, vitest_1.it)("#if 0 死代码块被剥离：顶层死函数不产生幻影函数；嵌套 #if 死区内保持死", () => {
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
        (0, vitest_1.expect)(ir.map((x) => x.name)).toEqual(["live_fn"]);
        (0, vitest_1.expect)(fn(ir, "live_fn").calls).toEqual(["g"]);
    });
    (0, vitest_1.it)("#if 0 || X 表达式不求值，按活区处理", () => {
        const ir = parse(`
#if 0 || 1
void maybe_live(void) { g(); }
#endif
void after(void) { h(); }
`);
        (0, vitest_1.expect)(ir.map((x) => x.name)).toEqual(["maybe_live", "after"]);
        (0, vitest_1.expect)(fn(ir, "maybe_live").calls).toEqual(["g"]);
    });
});
(0, vitest_1.describe)("extract-ir-c pointer-return regression", () => {
    (0, vitest_1.it)("单行指针返回函数必须被提取（char */SSL */const char */FILE * 等）", () => {
        const src = [
            "int a(void) { return 1; }",
            "char *b(void) { return 0; }",
            "SSL *c(SSL_CTX *ctx) { return 0; }",
            "const char *d(int x) { return 0; }",
            "static FILE *f(void) { return 0; }",
            "int (*handler)(int) { return 0; }",
        ].join("\n");
        const fns = (0, extract_ir_c_1.parseCSource)(src, "ptr.c", "/");
        const names = fns.map((f) => f.name);
        (0, vitest_1.expect)(names).toEqual(vitest_1.expect.arrayContaining(["b", "c", "d", "f"]));
        // 函数指针变量不是函数定义
        (0, vitest_1.expect)(names).not.toContain("handler");
        // 返回类型保留指针
        const c = fns.find((f) => f.name === "c");
        (0, vitest_1.expect)(c?.returnType).toBe("SSL *");
    });
});
