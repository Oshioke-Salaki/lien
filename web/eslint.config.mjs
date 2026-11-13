import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The landing page's vendored design system: plain browser scripts, not React, so React's
    // hook rules misread its helpers (fx.js's useFallback) as hooks.
    "public/site/assets/**",
  ]),
]);

export default eslintConfig;
