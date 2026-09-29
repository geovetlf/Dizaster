// Monorepo pnpm: Expo detecta el workspace y aplica los "paths" de tsconfig, así que los paquetes
// internos (@dizaster/*) se consumen desde su código fuente TypeScript.
// Esos paquetes usan imports ESM con sufijo ".js" (estándar NodeNext); aquí se resuelven al ".ts" real.
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
const packagesDir = path.resolve(__dirname, "../../packages");

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (context.originModulePath.startsWith(packagesDir) && moduleName.startsWith(".") && moduleName.endsWith(".js")) {
    return context.resolveRequest(context, moduleName.slice(0, -3) + ".ts", platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
