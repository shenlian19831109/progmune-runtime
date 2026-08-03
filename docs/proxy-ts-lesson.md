# proxy.ts 教训：AI 治理中的框架版本约定

> **日期**: 2026-08-03
> **触发**: CRM 项目 `proxy.ts` → `middleware.ts` → `proxy.ts` 的往返重命名
> **教训**: AI 遵循项目实际依赖的框架版本。人工审查遵循训练数据中的框架版本。当二者不同时，人工审查通常出错。

---

## 事件

1. Manus AI 为 Next.js 16 项目生成 `src/proxy.ts`
2. Progmune 治理审查将该文件标记为 bug（"中间件应命名为 `middleware.ts`"）
3. 审查将其重命名为 `middleware.ts`
4. 启动应用时，Next.js 16 显示警告：*"The 'middleware' file convention is deprecated. Please use 'proxy' instead."*
5. 审查将其重命名回 `proxy.ts`

**AI 从一开始就是正确的。治理审查引入了 bug。**

## 根因

| 知识来源 | 约定 | 正确？ |
|----------|------|--------|
| LLM 训练数据（Next.js 12-15） | `middleware.ts` | ❌ 已过时 |
| AI 编写时的项目依赖（Next.js 16） | `proxy.ts` | ✅ 当前版本 |
| 人工审查直觉（Next.js 12-15 经验） | `middleware.ts` | ❌ 已过时 |

**AI 遵循 `node_modules`。人工审查遵循训练数据。`node_modules` 更准确。**

## 为什么 AI 在这些细节上更准确

AI 编写代码时直接引用项目安装的框架模块。它天然地适配**这个项目实际使用的版本**。审查的 LLM 则依赖训练数据中的"常识"——而"常识"对于已发布的新版本框架而言是过时的。

## 治理规则

### 规则：FW_FRAMEWORK_CONVENTION_CHECK

```
如果项目包含框架版本警告（如 AGENTS.md 中的 "This is NOT the Next.js you know"）：
  在重命名任何框架约定文件之前：
    1. 从 package.json 读取框架版本
    2. 从 node_modules/<framework>/dist/docs/ 查阅当前文档
    3. 仅当当前文档确认该约定确实错误时才重命名
```

### 实现

- `src/frameworks/version-awareness.ts` — 框架版本感知治理引擎
- `src/protocol-detector.ts` — 框架约定覆盖 safeguard 规则
- `BREAKING_CHANGES` 注册表：跨框架版本的已知破坏性变更

## 已知受影响的框架约定

| 框架 | 版本 | 旧约定（训练数据） | 新约定（正确） |
|------|------|-------------------|---------------|
| Next.js | ≥16 | `middleware.ts` | `proxy.ts` |

*此列表将随新发现而更新。*

## 对 AI 治理的影响

1. **对框架版本约定，审查应遵循"先信任，后验证"原则**——不要立即假设 AI 的命名是错误的。

2. **AGENTS.md 的警告应被强制执行**——"This is NOT the Next.js you know" 意味着"你熟悉的规则可能不适用"。要相信它。

3. **Progmune 应利用 `package.json` 中的版本信息**——在应用规则之前，检查项目针对的框架版本。

4. **"看起来像 bug"需要实际验证**——对于框架约定文件，验证方法是查阅 `node_modules` 中的框架文档，而非训练数据。
