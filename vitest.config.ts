import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    exclude: ["node_modules", "dist"],
    environment: "node",
    testTimeout: 30_000,

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
        statements: 6,
        branches: 5,
        functions: 6,
        lines: 6,
      },
    },
  },
});
