import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

function scope(configs, files) {
  return configs.map((config) => ({
    ...config,
    files,
  }));
}

export default defineConfig([
  ...scope(nextTs, ["packages/**/*.{ts,tsx}"]),
  ...scope([...nextVitals, ...nextTs], ["apps/demo/**/*.{js,jsx,ts,tsx}"]),
  globalIgnores([
    "**/.next/**",
    "**/dist/**",
    "**/out/**",
    "**/build/**",
    "**/coverage/**",
    "**/next-env.d.ts",
  ]),
]);