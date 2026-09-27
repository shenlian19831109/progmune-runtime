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
 * extract-ir-go.test.ts — Go IR 提取器回归（临时目录夹具）
 *
 * 纯 TS 词法提取（与 C 提取器同哲学）：函数签名（多行/接收者方法）、
 * 调用（obj.Method() 取 Method）、注释注解 @progmune + 文档标签、
 * exported=首字母大写、非生产表面过滤。
 */
const vitest_1 = require("vitest");
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const extract_ir_go_1 = require("./extract-ir-go");
let dir;
(0, vitest_1.beforeEach)(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "go-ir-"));
});
(0, vitest_1.afterEach)(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});
function write(rel, content) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
}
(0, vitest_1.describe)("extract-ir-go", () => {
    (0, vitest_1.it)("普通函数 + 调用提取（含 obj.Method() 成员调用）", () => {
        write("main.go", `
package main

func doWork() {
	helper()
	obj.Save()
}

func helper() {}
`);
        const ir = (0, extract_ir_go_1.extractIRGo)(dir);
        const doWork = ir.find((f) => f.name === "doWork");
        (0, vitest_1.expect)(doWork?.calls).toEqual(vitest_1.expect.arrayContaining(["helper", "Save"]));
    });
    (0, vitest_1.it)("接收者方法（func (r *Repo) Name）", () => {
        write("repo.go", `
package main

func (r *Repo) SaveUser(u User) error {
	return nil
}
`);
        const ir = (0, extract_ir_go_1.extractIRGo)(dir);
        (0, vitest_1.expect)(ir.some((f) => f.name === "SaveUser")).toBe(true);
        (0, vitest_1.expect)(ir.find((f) => f.name === "SaveUser")?.exported).toBe(true);
    });
    (0, vitest_1.it)("接收者方法 returnType 与参数正确（receiver 括号组不被误取——回归）", () => {
        write("svc.go", `
package main

func (s *Service) Login(ctx Context, user, password string) (Token, error) {
	return Token{}, nil
}
`);
        const ir = (0, extract_ir_go_1.extractIRGo)(dir);
        const fn = ir.find((f) => f.name === "Login");
        (0, vitest_1.expect)(fn?.returnType).toBe("(Token, error)");
        // Go 语义：ctx / user / password 是 3 个参数（user 与 password 共享类型）
        (0, vitest_1.expect)(fn?.params).toHaveLength(3);
        (0, vitest_1.expect)(fn?.params[0].type).toContain("ctx");
        (0, vitest_1.expect)(fn?.params[1].type).toContain("user");
        (0, vitest_1.expect)(fn?.params[2].type).toContain("string");
    });
    (0, vitest_1.it)("多行签名 + 返回类型", () => {
        write("multi.go", `
package main

func Process(
	name string,
	count int,
) (string, error) {
	return name, nil
}
`);
        const ir = (0, extract_ir_go_1.extractIRGo)(dir);
        const fn = ir.find((f) => f.name === "Process");
        (0, vitest_1.expect)(fn).toBeTruthy();
        (0, vitest_1.expect)(fn?.returnType).toContain("string");
    });
    (0, vitest_1.it)("注释注解 @progmune + 文档标签", () => {
        write("auth.go", `
package main

// @progmune(namespace="auth", pre=["UNAUTHENTICATED"], post=["PASSWORD_VERIFIED"])
// @purpose 凭证比对
// @tags auth
func VerifyPassword(user, password string) bool {
	return password == "secret"
}
`);
        const ir = (0, extract_ir_go_1.extractIRGo)(dir);
        const fn = ir.find((f) => f.name === "VerifyPassword");
        (0, vitest_1.expect)(fn?.protocol?.pre_states).toEqual(["UNAUTHENTICATED"]);
        (0, vitest_1.expect)(fn?.protocol?.post_states).toEqual(["PASSWORD_VERIFIED"]);
        (0, vitest_1.expect)(fn?.protocol?.namespace).toBe("auth");
        (0, vitest_1.expect)(fn?.purpose).toBe("凭证比对");
        (0, vitest_1.expect)(fn?.tags).toContain("auth");
        (0, vitest_1.expect)(fn?.exported).toBe(true);
    });
    (0, vitest_1.it)("接口方法声明（无函数体）不提取", () => {
        write("iface.go", `
package main

type Store interface {
	Save(u User) error
}
`);
        const ir = (0, extract_ir_go_1.extractIRGo)(dir);
        (0, vitest_1.expect)(ir.some((f) => f.name === "Save")).toBe(false);
    });
    (0, vitest_1.it)("字符串/注释里的伪调用不提取", () => {
        write("str.go", `
package main

func tricky() {
	s := "notAFunction() inside string"
	// notAFunction() in comment
	realCall()
}

func realCall() {}
`);
        const ir = (0, extract_ir_go_1.extractIRGo)(dir);
        const fn = ir.find((f) => f.name === "tricky");
        (0, vitest_1.expect)(fn?.calls).toContain("realCall");
        (0, vitest_1.expect)(fn?.calls).not.toContain("notAFunction");
    });
    (0, vitest_1.it)("非生产表面过滤：vendor/testdata/测试文件跳过", () => {
        write("main.go", `package main\nfunc Keep() {}\n`);
        write("vendor/dep.go", `package dep\nfunc SkipVendor() {}\n`);
        write("testdata/sample.go", `package sample\nfunc SkipTestdata() {}\n`);
        write("x_test.go", `package main\nfunc SkipTest() {}\n`);
        const ir = (0, extract_ir_go_1.extractIRGo)(dir);
        (0, vitest_1.expect)(ir.map((f) => f.name)).toEqual(["Keep"]);
    });
    (0, vitest_1.it)("Go 关键字不提取为调用（for/if/go/defer 等）", () => {
        write("ctrl.go", `
package main

func run() {
	for i := 0; i < 3; i++ {
		go step(i)
		defer cleanup()
	}
}

func step(i int) {}
func cleanup() {}
`);
        const ir = (0, extract_ir_go_1.extractIRGo)(dir);
        const fn = ir.find((f) => f.name === "run");
        (0, vitest_1.expect)(fn?.calls).toEqual(vitest_1.expect.arrayContaining(["step", "cleanup"]));
        (0, vitest_1.expect)(fn?.calls).not.toEqual(vitest_1.expect.arrayContaining(["for", "go", "defer", "if"]));
    });
});
