import type { NextConfig } from "next";

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typescript: {
    ignoreBuildErrors: false,
  },
} satisfies NextConfig;

export default nextConfig;
