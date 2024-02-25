await import("./src/env.js");
const nextBundleAnalyzer = await import("@next/bundle-analyzer");
const withBundleAnalyzer = nextBundleAnalyzer.default({
  // could be changed to process.env.ANALYZE === 'true' to enable analysis
  enabled: process.env.ANALYZE === "true",
  // enabled: true,
});

/** @type {import("next").NextConfig} */
const config = {
  experimental: {
    serverComponentsExternalPackages: ["bcrypt"],
  },
};

export default withBundleAnalyzer(config);
