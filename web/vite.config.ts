/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Phase 0 keeps the test environment as plain Node (no jsdom yet) because
// frameFormat.test.ts is pure-logic. Phase 3 introduces canvas-based tests
// and will switch test.environment to "jsdom" + add jsdom to devDeps.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
