import type { NextConfig } from "next";
import nextBundleAnalyzer from "@next/bundle-analyzer";
import env from "@packages/env";
import { withWorkflow } from "workflow/next";

const withBundleAnalyzer = nextBundleAnalyzer({
  enabled: env.ANALYZE,
});

const config = {
  webpack: (config) => {
    // exclude non-js files from being processed by webpack
    config.module.rules.push(
      {
        test: /\.(md|LICENSE)$/,
        use: "null-loader",
      },
      {
        test: /\.d\.ts$/,
        use: "null-loader",
      },
      {
        test: /\.node$/,
        loader: "node-loader",
      },
    );

    config.resolve.fallback = {
      punycode: false, // avoid deprecated punycode module
    };

    // mark .node files as external to prevent bundling
    config.externals = [
      ...(config.externals || []),
      // @ts-expect-error unknown types
      ({ request }, callback) => {
        if (request?.endsWith(".node")) {
          return callback(null, `commonjs ${request}`);
        }
        callback();
      },
    ];

    config.resolve.alias = {
      ...config.resolve.alias,
      "~/*": ["./src/*"],
    };

    return config;
  },
  allowedDevOrigins: [env.VERCEL_URL],
  productionBrowserSourceMaps: true,
  cacheComponents: true,
  experimental: {
    useCache: true,
    turbopackFileSystemCacheForDev: true,
  },
  reactCompiler: {
    compilationMode: "all",
    panicThreshold: "critical_errors",
  },
  turbopack: {
    resolveAlias: {
      "~/*": ["./src/*"],
    },
    // minify: false,
    // treeShaking: true,
    // sourceMaps: true,
    // unstablePersistentCaching: false,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    dangerouslyAllowSVG: false, // true
    remotePatterns: [
      {
        protocol: "https",
        hostname: new URL(env.SUPABASE_S3_ENDPOINT).hostname,
        pathname: `${new URL(env.SUPABASE_S3_ENDPOINT).pathname}/**`,
      },
      {
        protocol: "https",
        hostname: new URL(env.VERCEL_BLOB_STORAGE_HOST).hostname,
        pathname: `${new URL(env.VERCEL_BLOB_STORAGE_HOST).pathname}**`,
      },
      {
        protocol: "https",
        hostname: env.VERCEL_URL,
        pathname: "/api/*images/**",
      },
      {
        protocol: "https",
        hostname: env.VERCEL_URL,
        pathname: "/_next/**",
      },
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        // pathname: "/**",
      },
    ],
  },
} satisfies NextConfig;

export default withBundleAnalyzer(withWorkflow(config));
