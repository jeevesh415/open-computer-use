import { defineConfig } from "vitest/config"
import path from "path"
import react from "@vitejs/plugin-react"

export default defineConfig({
  // React plugin is only needed for the .tsx render-pipeline tests; it's a
  // no-op for plain .ts test files.
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    globals: true,
    environment: "node",
    // Frontend (Next.js) test surface — TypeScript only, anywhere under tests/.
    include: ["tests/**/*.test.{ts,tsx}"],
    // Explicit exclusions for adjacent test surfaces and non-CI test dirs.
    // tests/post_deploy/** is the live-environment smoke suite that hits real
    // AWS / Supabase / Stripe — must NEVER run in unit-test contexts. Even
    // though it has only .py files today, this guards against accidental
    // .test.ts files being added there in the future.
    exclude: [
      "node_modules/**",
      "electron/**",          // electron has its own vitest config
      "backend/**",           // backend uses pytest
      ".next/**",
      "out/**",
      "dist/**",
      "coverage/**",
      "tests/post_deploy/**", // live-environment smoke tests — run separately
      "OSWorld/**",           // upstream benchmark; not part of CI
      "docker/**",            // docker image build-time tests
    ],
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
