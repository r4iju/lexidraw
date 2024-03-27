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
  eslint: {
    ignoreDuringBuilds: false,
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
    ],
  },
};

export default withBundleAnalyzer(config);
