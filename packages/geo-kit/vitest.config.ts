import { defineConfig } from "vitest/config";
import { sourceConditions } from "../../vitest.shared.js";

export default defineConfig({ ...sourceConditions, test: { include: ["test/**/*.test.ts"] } });
