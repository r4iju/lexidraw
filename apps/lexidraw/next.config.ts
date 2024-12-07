import { NextConfig } from "next";
import nextBundleAnalyzer from "@next/bundle-analyzer";

// import path from "path";
// import { fileURLToPath } from "url";
// const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
    dangerouslyAllowSVG: true,
    remotePatterns: [
      {
        protocol: "https",
        port: "",
        hostname: "khebpsoymyxdkdwpltvv.supabase.co",
        pathname: "/storage/v1/object/sign/**",
      },
      {
        protocol: "https",
        port: "",
        hostname: "khebpsoymyxdkdwpltvv.supabase.co",
        pathname: "/storage/v1/s3/excalidraw/**",
      },
    ],
  },
};

export default withBundleAnalyzer(config);
