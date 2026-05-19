import { defineConfig } from "vitest/config";

export default defineConfig({
  // Disable PostCSS so Vite doesn't try to load the parent monorepo's
  // Tailwind/PostCSS config when running the MCP server tests.
  css: { postcss: { plugins: [] } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 10_000,
  },
});
