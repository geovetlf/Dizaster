import { defineConfig } from "vitest/config";
import { sourceConditions } from "../../vitest.shared.js";

export default defineConfig({
  ...sourceConditions,
  test: {
    include: ["test/**/*.test.ts"],
    // Los tests de integración comparten una base de datos real: se ejecutan en serie.
    fileParallelism: false,
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
