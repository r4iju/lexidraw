await import("@packages/env");

// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const { PrismaPlugin } = await import(
  // @ts-expect-error ignore
  "@prisma/nextjs-monorepo-workaround-plugin"
);

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
  webpack: (config, { isServer }) => {
    if (isServer) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      config.plugins = [...config.plugins, new PrismaPlugin()];
    }
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return config;
  },
};

export default withBundleAnalyzer(config);
