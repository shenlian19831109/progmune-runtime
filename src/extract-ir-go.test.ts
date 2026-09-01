/**
 * extract-ir-go.test.ts — Go IR 提取器回归（临时目录夹具）
 *
 * 纯 TS 词法提取（与 C 提取器同哲学）：函数签名（多行/接收者方法）、
 * 调用（obj.Method() 取 Method）、注释注解 @progmune + 文档标签、
 * exported=首字母大写、非生产表面过滤。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { extractIRGo } from "./extract-ir-go";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "go-ir-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function write(rel: string, content: string) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

describe("extract-ir-go", () => {
  it("普通函数 + 调用提取（含 obj.Method() 成员调用）", () => {
    write("main.go", `
package main

func doWork() {
	helper()
	obj.Save()
}

func helper() {}
`);
    const ir = extractIRGo(dir);
    const doWork = ir.find((f) => f.name === "doWork");
    expect(doWork?.calls).toEqual(expect.arrayContaining(["helper", "Save"]));
  });

  it("接收者方法（func (r *Repo) Name）", () => {
    write("repo.go", `
package main

func (r *Repo) SaveUser(u User) error {
	return nil
}
`);
    const ir = extractIRGo(dir);
    expect(ir.some((f) => f.name === "SaveUser")).toBe(true);
    expect(ir.find((f) => f.name === "SaveUser")?.exported).toBe(true);
  });

  it("多行签名 + 返回类型", () => {
    write("multi.go", `
package main

func Process(
	name string,
	count int,
) (string, error) {
	return name, nil
}
`);
    const ir = extractIRGo(dir);
    const fn = ir.find((f) => f.name === "Process");
    expect(fn).toBeTruthy();
    expect(fn?.returnType).toContain("string");
  });

  it("注释注解 @progmune + 文档标签", () => {
    write("auth.go", `
package main

// @progmune(namespace="auth", pre=["UNAUTHENTICATED"], post=["PASSWORD_VERIFIED"])
// @purpose 凭证比对
// @tags auth
func VerifyPassword(user, password string) bool {
	return password == "secret"
}
`);
    const ir = extractIRGo(dir);
    const fn = ir.find((f) => f.name === "VerifyPassword");
    expect(fn?.protocol?.pre_states).toEqual(["UNAUTHENTICATED"]);
    expect(fn?.protocol?.post_states).toEqual(["PASSWORD_VERIFIED"]);
    expect(fn?.protocol?.namespace).toBe("auth");
    expect(fn?.purpose).toBe("凭证比对");
    expect(fn?.tags).toContain("auth");
    expect(fn?.exported).toBe(true);
  });

  it("接口方法声明（无函数体）不提取", () => {
    write("iface.go", `
package main

type Store interface {
	Save(u User) error
}
`);
    const ir = extractIRGo(dir);
    expect(ir.some((f) => f.name === "Save")).toBe(false);
  });

  it("字符串/注释里的伪调用不提取", () => {
    write("str.go", `
package main

func tricky() {
	s := "notAFunction() inside string"
	// notAFunction() in comment
	realCall()
}

func realCall() {}
`);
    const ir = extractIRGo(dir);
    const fn = ir.find((f) => f.name === "tricky");
    expect(fn?.calls).toContain("realCall");
    expect(fn?.calls).not.toContain("notAFunction");
  });

  it("非生产表面过滤：vendor/testdata/测试文件跳过", () => {
    write("main.go", `package main\nfunc Keep() {}\n`);
    write("vendor/dep.go", `package dep\nfunc SkipVendor() {}\n`);
    write("testdata/sample.go", `package sample\nfunc SkipTestdata() {}\n`);
    write("x_test.go", `package main\nfunc SkipTest() {}\n`);
    const ir = extractIRGo(dir);
    expect(ir.map((f) => f.name)).toEqual(["Keep"]);
  });

  it("Go 关键字不提取为调用（for/if/go/defer 等）", () => {
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
    const ir = extractIRGo(dir);
    const fn = ir.find((f) => f.name === "run");
    expect(fn?.calls).toEqual(expect.arrayContaining(["step", "cleanup"]));
    expect(fn?.calls).not.toEqual(expect.arrayContaining(["for", "go", "defer", "if"]));
  });
});
