import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const pkg = (p: string) => fileURLToPath(new URL(`../../packages/${p}/src/index.ts`, import.meta.url));

// Solo lógica pura (sin React Native): cola offline, presencia, emergencia, proveedor de mapa.
export default defineConfig({
  resolve: { alias: { "@dizaster/contracts": pkg("contracts"), "@dizaster/geo-kit": pkg("geo-kit") } },
  test: { include: ["test/**/*.test.ts"] },
});
