import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/.expo/**", "apps/mobile/src/reference-data/**", "apps/mobile/dist-check/**", "**/*.config.js"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": "off",
    },
  },
  {
    // Aislamiento del proyecto: Dizaster no importa nada de WEE ni MelonOffice.
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ group: ["*wee*", "*melonoffice*", "*melon-office*"], message: "Dizaster es independiente de WEE y MelonOffice." }] }],
    },
  },
);
