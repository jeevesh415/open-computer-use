import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules", "electron", ".next", "backend"],
    testTimeout: 15000,
    setupFiles: ["tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "json", "html"],
      reportsDirectory: "coverage",
      include: ["lib/**/*.ts", "app/api/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        "**/*.d.ts",
        "lib/motion.ts",
        "lib/seo.ts",
        "lib/trending-questions.ts",
      ],
    },
  },
})
