## 全球免疫网络 (Global Immune Network)

Progmune 可将本地脱敏后的错误指纹安全上报至中央免疫服务器，实现“群体免疫”。  
上报前，请设置中央服务器地址：

```bash
export PROGMUNE_HUB="https://progmune-runtime.fly.dev/report"
之后只需两条命令即可预览和上报：

bash
# 查看待上报的脱敏错误指纹（仅函数名、SVL级别、状态迁移）
npx ts-node src/report.ts preview

# 执行安全上报
npx ts-node src/report.ts report
隐私保护：只上传函数名序列、SVL级别、状态迁移，绝不包含任何代码片段、变量值或用户数据。

## 全球免疫网络 (Global Immune Network)

Progmune 可将本地脱敏后的错误指纹安全上报至中央免疫服务器，实现“群体免疫”。
上报前，请设置中央服务器地址：

```bash
export PROGMUNE_HUB="https://progmune-runtime.fly.dev/report"
```

之后只需两条命令即可预览和上报：

```bash
# 查看待上报的脱敏错误指纹（仅函数名、SVL级别、状态迁移）
npx ts-node src/report.ts preview

# 执行安全上报
npx ts-node src/report.ts report
```

**隐私保护**：只上传函数名序列、SVL级别、状态迁移，绝不包含任何代码片段、变量值或用户数据。

## 全球免疫网络 (Global Immune Network)

Progmune 可将本地脱敏后的错误指纹安全上报至中央免疫服务器，实现"群体免疫"。
上报前，请设置中央服务器地址：

```bash
export PROGMUNE_HUB="https://progmune-runtime.fly.dev/report"
```

之后只需两条命令即可预览和上报：

```bash
# 查看待上报的脱敏错误指纹（仅函数名、SVL级别、状态迁移）
npx ts-node src/report.ts preview

# 执行安全上报
npx ts-node src/report.ts report
```

**隐私保护**：只上传函数名序列、SVL级别、状态迁移，绝不包含任何代码片段、变量值或用户数据。
