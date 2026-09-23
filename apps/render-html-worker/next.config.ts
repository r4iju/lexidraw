import type { NextConfig } from "next";
import path from "node:path";

// @sparticuz/chromium resolves its brotli archives next to wherever the
// package really lives, which depends on the install layout: hoisted to the
// workspace root, bun's isolated store, or app-local.
const CHROMIUM_BIN = [
  "../../node_modules/@sparticuz/chromium/bin/**",
  "../../node_modules/.bun/@sparticuz+chromium@*/node_modules/@sparticuz/chromium/bin/**",
  "./node_modules/@sparticuz/chromium/bin/**",
];

const config = {
  experimental: {},
  outputFileTracingRoot: path.join(__dirname, "../.."),
  typescript: { ignoreBuildErrors: true },
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  // The archives are read from disk at runtime, so the file tracer never sees
  // them; every route that launches a browser needs them.
  outputFileTracingIncludes: {
    "/api/screenshot": CHROMIUM_BIN,
    "/api/render-html": CHROMIUM_BIN,
    "/api/render/pdf": CHROMIUM_BIN,
  },
} satisfies NextConfig;

export default config;
