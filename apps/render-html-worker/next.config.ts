import type { NextConfig } from "next";
import path from "node:path";

const config = {
  experimental: {},
  outputFileTracingRoot: path.join(__dirname, "../.."),
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
} satisfies NextConfig;

export default config;
