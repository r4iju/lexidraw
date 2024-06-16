await import("@packages/env");

const nextBundleAnalyzer = await import("@next/bundle-analyzer");
const withBundleAnalyzer = nextBundleAnalyzer.default({
  enabled: process.env.ANALYZE === "true",
});

/** @type {import("next").NextConfig} */
const config = {
  webpack: (config, { isServer }) => {
    return config;
  },
  productionBrowserSourceMaps: true,
  experimental: {
    // reactCompiler: {
    //   compilationMode: "all",
    // },
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
