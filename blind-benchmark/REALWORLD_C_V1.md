# Real-World C Validation v1

> 真实 C 应用语料验证（生产管线，人工标注）— 2026-08-27
> 扫描器：`blind-benchmark/scan-real-c.ts`；报告：`reports/scan-real-c-results.json`

## 目的

回答「C 可以投入生产了吗」。方法学对齐 Python 真实项目验证 v1（`REALWORLD_PYTHON_V1.md` / PyGoat）：用生产管线（extractIRC → buildCallSequences → validateSequenceWithSSG，词段门控开，无 LLM）扫描真实 C 仓库，逐条人工标注 TP/FP，测量真实项目误报率。

## 语料（vendored，无新克隆）

| 仓库 | 应用级协议面 | 生产表面函数数（过滤后） | 入口序列 |
|------|-------------|------------------------|---------|
| libssh 0.11 | SSH 认证（password/kbdint/publickey） | 1,964 | 523 |
| redis 7.x | AUTH/ACL 认证、文件持久化 | 4,906 | 1,310 |
| nginx 1.27 | auth_basic 密码验证、静态文件生命周期 | 3,199 | 1,362 |

## 结果

### 过滤前：79 flags（65/79 = 82% 在非生产表面）

- libssh 63（tests/ 与 examples/ 的 setup/teardown 函数——`ssh_pcap_file_open` 词段撞 `open_file`，62 条 endState + 1 条词段）
- redis 1（`deps/jemalloc/test/` vendored 第三方测试回调 `prof_dump_write_file_error` 词段撞 `write_file`）
- nginx 15（全部 src/ 生产代码）

**修复**：`extract-ir-c.ts` 的 `collectCFiles` 补非生产表面过滤（对齐 `tools/extract_ir.py` Python 先例——"Skip test files — tests are not production surface for a security scanner"）：跳过 `tests/test/examples/docs/docs_src/scripts/deps/vendor/third_party` 目录 + `test_*.c`/`*_test.c` 文件名。C 金标恢复率零漂移（97/97/89/98/100/99）。

### 过滤后：16 flags，逐条人工标注 → **0 TP / 16 FP（标记精确率 0%）**

| # | 仓库 | 位置 | 调用 → 规则 | 策略 | 判定 | 依据 |
|---|------|------|------------|------|------|------|
| 1 | libssh | src/pcap.c::`ssh_pcap_file_free` | `ssh_pcap_file_close` → close_file | word-segment | FP | 清理函数：fclose 调用方打开的文件（跨函数窗口，同 do_logout 类） |
| 2-13 | nginx | 8 个 `ngx_http_*_handler` + `ngx_stream_log_handler` + 3 个 open_file_cache 函数 | end-of-sequence → close_file | endState | FP | 异步/回调生命周期：close 注册在 pool cleanup 回调（`cln->handler = ngx_open_file_cleanup`），直接调用序列不可见；其中 `ngx_open_file_cleanup` 等 3 个就是清理函数本身（归因反转） |
| 14-16 | nginx | src/os/win32/ngx_files.c | `ReadFile`/`WriteFile` → read_file/write_file | keyword | FP | Windows API 包装器：fd 由调用方传入（已打开），窗口内无 open 是正确代码 |

### 关键观察

1. **exact-name 策略 0 次触发**。应用级金标 v2 的 95.7% F1 全部来自「调用名 = 规则名」（verify_password 等）与注解。真实 C 代码用库自身命名（`ssh_userauth_password`、`ngx_open_file`），没有一条按名命中——合成金标与真实代码之间存在「命名鸿沟」。
2. **所有 16 条 flag 都来自启发式策略**（endState 12 / keyword 3 / word-segment 1），且全部是误报。当前形态下，未注解的真实 C 代码在新路线上产出的是**纯噪声**。
3. **三个已定位的误报源**（全部有数据支撑）：
   - 跨函数窗口（1/16）：清理函数关闭调用方打开的资源——与 Python 盲测 T2×S5、应用级金标 do_logout 同类；
   - 回调式生命周期（12/16）：nginx 模型的 close 在 cleanup 回调中，直接调用序列不可见；
   - API 包装器（3/16）：OS API 层（ReadFile/WriteFile）被关键词桥接误映射。
4. **测试基础设施噪声已消除**：表面过滤修复让 libssh 63→1、redis 1→0，与 Python 真实验证 v1 的「排除测试 66% 噪音」同源同解。

## 对生产化问题的回答

**维持研究标签**（README 现状正确）。真实 C 代码验证：0 TP / 16 FP——精度不可用于生产。但结论比旧路线的「C 不可行」精确得多：

- **可行路径 = 注解驱动**：真实项目用 `/* @progmune(...) */` 标注协议原语（应用级金标证明该路径 P=91.7%/R=100%），未注解代码依赖启发式 = 噪声。这是 C 生产化的现实形态，与 TS/Python 的 alias 生态不同（C 没有库别名注册表）。
- **引擎决策的数据已到位**（用户复盘原则「先观察再动引擎」）：
  - 词段匹配：真实误报 1/16（生产表面），加旧金标 nginx 3/432——频率低但命名鸿沟下无真阳性贡献；
  - endState 检查：12/16 是回调生命周期盲区——若要修，方向是「识别 cleanup 回调注册」（`*_pool_cleanup_add` 类），而非收紧状态机；
  - keyword 桥接：ReadFile/WriteFile 类 OS API 名应从域关键词中排除或限定。

## Addendum（2026-08-27，openssl + 性能修复后）

- **openssl 加入扫描**（`scan-real-c.ts` 默认四仓库）：9 flags（8 keyword + 1 word-segment），
  全部 FP、全部落在已建立类别——OS API 桥接（ReadFile/WriteFile/DeleteFile）与包装器
  （file_write）——无新误报类别。四仓库合计：**24 flags / 0 TP / 24 FP**（libssh 1、redis 0、
  nginx 14——较 v1 主表 15 减 1，指针修复引起的提取微调、openssl 9）。
- **性能修复**：P4.6 展开宽度爆炸（openssl 单序列可达 1M+ 调用）——`buildCallSequences`
  2,000 调用预算制截断（`truncated: true` 字段，入口自身调用优先，不做去重）。
  openssl 全扫描 15–25 分钟 → **222s**。截断是诚实的召回边界：超大序列尾部违规不可见。
  零漂移前置实测：Python 盲测语料 350 序列最大 23、TS 自身 IR 469 序列最大 824——
  2,000 预算对现有语料零影响；Python 盲测复跑 64 违规不变。
- **keyword 白名单方向的数据已达标**：ReadFile/WriteFile/DeleteFile 类 OS API 桥接
  FP 合计 11/25（nginx 3 + openssl 8）——引擎级修复的观测前提已满足，待决策。

## 下一步（按优先级）

1. 注解驱动 C 项目端到端演示（真实项目 + 注解 → 生产管线决策），验证生产形态；
2. endState 回调识别（引擎级，需盲测复跑）；keyword 白名单收紧（ReadFile/WriteFile 类排除）；
3. 词段匹配维持现状（数据不支持也不否定，等真实注解项目语料再评估）。
