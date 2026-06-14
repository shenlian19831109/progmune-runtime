import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts", "tests/**/*.test.ts", "tests/**/*.perf.ts", "tests/**/*.stress.ts", "tests/**/*.soak.ts"],
    exclude: ["node_modules", "dist"],
    environment: "node",
    testTimeout: 30_000,
    // Stress/soak tests may need longer
    hookTimeout: 120_000,

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
