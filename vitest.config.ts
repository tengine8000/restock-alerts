import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "path";

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      // React Router v7 maps "~" to the app directory at build time via its
      // Vite plugin. Replicate the same alias here for Vitest.
      "~": path.resolve(__dirname, "app"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./app/test/setup.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "extensions/**", ".claude/**", ".shopify/**"],
    coverage: {
      provider: "v8",
      thresholds: { lines: 80 },
    },
  },
});
