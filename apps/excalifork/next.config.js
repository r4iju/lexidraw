await import("@packages/env");

const nextBundleAnalyzer = await import("@next/bundle-analyzer");
const withBundleAnalyzer = nextBundleAnalyzer.default({
  enabled: process.env.ANALYZE === "true",
});

/** @type {import("next").NextConfig} */
const config = {
  experimental: {
    serverComponentsExternalPackages: ["bcrypt"],
  },
  webpack: (config, { isServer }) => {
    return config;
  },
};

export default withBundleAnalyzer(config);
