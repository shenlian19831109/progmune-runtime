import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts", "tests/**/*.test.ts", "tests/**/*.perf.ts", "tests/**/*.stress.ts", "tests/**/*.soak.ts"],
    exclude: ["node_modules", "dist"],
    environment: "node",
    testTimeout: 30_000,
    // Stress/soak tests may need longer
    hookTimeout: 120_000,

    // 本地语料丰富时（.progmune_corpus 864+ 条），function-synonyms 等
    // 语料重度测试在并行 worker 内存竞争下会触到 V8 自适应堆上限（~2GB）OOM。
    // 用 forks 子进程池 + 显式 4GB 堆上限（threads 池的 execArgv 不生效）。
    // CI 干净检出无语料，不受影响。
    pool: "forks",
    poolOptions: {
      forks: {
        execArgv: ["--max-old-space-size=4096"],
      },
    },

    // Coverage
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/mcp-server.ts",   // integration-tested separately (MCP protocol)
        "src/semantic-trace.ts", // terminal UI
        "src/obs-web.ts",
        "src/main.ts",
        "src/generate_500.ts",
        "src/semantic_guard_test.ts",
      ],
      thresholds: {
        // Floor: prevent regression from current baseline
        // Raise these as test coverage improves
        statements: 8,
        branches: 7,
        functions: 8,
        lines: 8,
      },
    },
  },
});
