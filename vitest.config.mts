import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` throws outside the React Server Components runtime.
      "server-only": fileURLToPath(new URL("./tests/support/empty.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    environment: "node",
    setupFiles: ["tests/support/setup.ts"],
    testTimeout: 30000,
    // Mirror Next.js: make .env.local (e.g. WIKIMEDIA_USER_AGENT) available to live tests.
    env: loadEnv("test", process.cwd(), ""),
  },
});
