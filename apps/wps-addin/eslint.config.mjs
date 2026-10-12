import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "dist-desktop/**", "node_modules/**", ".build-tools/**", ".installer-build/**", "release/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ["runtime/**/*.mjs", "test/*.mjs", "installer/*.mjs"], languageOptions: { globals: { Buffer: "readonly", URL: "readonly", process: "readonly", console: "readonly", fetch: "readonly", setTimeout: "readonly", clearTimeout: "readonly" } } },
);
