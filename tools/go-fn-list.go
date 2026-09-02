// go-fn-list.go — Go 函数金标生成器（恢复率实验的 ground truth）
//
// 用标准库 go/parser 解析目录，输出 {文件: [函数名]} JSON。
// 与词法提取器（extract-ir-go.ts）用同一文件集（同为 *_test.go 排除）。
//
// 用法：go run tools/go-fn-list.go <dir> <out.json>
package main

import (
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"
)

var skipDirs = map[string]bool{
	"vendor": true, "testdata": true, "test": true, "tests": true,
	"examples": true, "example": true, "docs": true, "doc": true,
	"third_party": true, "node_modules": true, ".git": true,
	"scripts": true, "tools": true,
}

func main() {
	root := os.Args[1]
	out := os.Args[2]
	result := map[string][]string{}

	filepath.Walk(root, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			if skipDirs[info.Name()] {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(p, ".go") || strings.HasSuffix(p, "_test.go") {
			return nil
		}
		fset := token.NewFileSet()
		f, err := parser.ParseFile(fset, p, nil, 0)
		if err != nil {
			return nil // 解析失败的文件跳过（与词法同口径：设计上不可提取）
		}
		var names []string
		for _, decl := range f.Decls {
			if fn, ok := decl.(*ast.FuncDecl); ok && fn.Body != nil {
				names = append(names, fn.Name.Name)
			}
		}
		if len(names) > 0 {
			rel, _ := filepath.Rel(root, p)
			result[rel] = names
		}
		return nil
	})

	b, err := json.Marshal(result)
	if err != nil {
		panic(err)
	}
	if err := os.WriteFile(out, b, 0o644); err != nil {
		panic(err)
	}
}
