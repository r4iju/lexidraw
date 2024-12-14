import { NextConfig } from "next";
import nextBundleAnalyzer from "@next/bundle-analyzer";
import env from "@packages/env";

const withBundleAnalyzer = nextBundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const config: NextConfig = {
  webpack: (config) => {
    return config;
  },
  productionBrowserSourceMaps: true,
  experimental: {
    reactCompiler: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    dangerouslyAllowSVG: false, // true
    remotePatterns: [
      {
        protocol: "https",
        port: "",
        hostname: new URL(env.SUPABASE_S3_ENDPOINT).hostname,
        pathname: new URL(env.SUPABASE_S3_ENDPOINT).pathname + "/**",
      },
      {
        protocol: "https",
        port: "",
        hostname: new URL(env.VERCEL_URL).hostname,
        pathname: "/api/*images/**",
      },
    ],
  },
};

export default withBundleAnalyzer(config);
