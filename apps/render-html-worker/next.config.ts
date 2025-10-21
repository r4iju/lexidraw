import type { NextConfig } from "next";

const config = {
  experimental: {},
  outputFileTracingIncludes: {
    "/api/render-html": [
      "node_modules/@sparticuz/chromium/bin/**",
      "node_modules/@sparticuz/chromium/lib/**",
    ],
  },
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
} satisfies NextConfig;

export default config;
