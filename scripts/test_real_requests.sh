#!/bin/bash
set -e

echo "🧪 真实项目测试：Requests 库"

# 1. 克隆真实项目
REPO_DIR="test-real-requests"
if [ ! -d "$REPO_DIR" ]; then
  git clone --depth 1 https://github.com/psf/requests.git "$REPO_DIR"
fi

# 2. 统计函数总数
FUNC_COUNT=$(grep -r "^def " "$REPO_DIR/src" | wc -l | tr -d ' ')
echo "📊 函数数量: $FUNC_COUNT"

# 3. 提取 IR
python3 tools/extract_ir.py "$REPO_DIR/src"
echo "✅ IR 已提取"

# 4. 运行生成（两种 Planner）
echo ""
echo "--- LLM Planner ---"
npx ts-node src/generate.ts --lang python --project "$REPO_DIR/src" --planner llm \
  "实现一个带超时和重试的 HTTP GET 函数"

echo ""
echo "--- Search Planner ---"
npx ts-node src/generate.ts --lang python --project "$REPO_DIR/src" --planner search \
  "实现一个带超时和重试的 HTTP GET 函数"

echo ""
echo "✅ 真实项目测试完成，详细运行结果已记录"
