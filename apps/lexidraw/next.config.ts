import type { NextConfig } from "next";
import nextBundleAnalyzer from "@next/bundle-analyzer";
import env from "@packages/env";
import { withWorkflow } from "workflow/next";
import { reactCompiler } from "./react-compiler";

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
  // A PNG render rasterises with resvg, which is a native binding: it has to
  // be required at runtime rather than bundled.
  serverExternalPackages: ["@resvg/resvg-js"],
  // resvg reads the editor's fonts from disk, and nothing imports them, so
  // tracing cannot find them. Without this a deployed render draws every
  // label in a substitute font. Keyed on every entry rather than the two
  // routes that render today, because the next one to call `renderDrawing`
  // would otherwise fail silently, in production only.
  outputFileTracingIncludes: {
    "**": ["./src/server/drawings/fonts/*.ttf"],
  },
  productionBrowserSourceMaps: true,
  cacheComponents: true,
  // `next dev` otherwise writes AGENTS.md/CLAUDE.md into the app; the repo keeps
  // its own at the root.
  agentRules: false,
  experimental: {
    turbopackFileSystemCacheForDev: true,
  },
  reactCompiler,
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
        hostname: new URL(env.VERCEL_BLOB_STORAGE_HOST_DEV).hostname,
        pathname: `${new URL(env.VERCEL_BLOB_STORAGE_HOST_DEV).pathname}**`,
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

const configWithWorkflow = withWorkflow(config);

export default async function nextConfig(
  phase: string,
  ctx: { defaultConfig: NextConfig },
): Promise<NextConfig> {
  const resolved = await configWithWorkflow(phase, ctx);
  // @next/bundle-analyzer resolves its `next` types through bun's hoisted
  // copy, which is a different peer-hashed instance than the one this app
  // links; the NextConfig shapes are identical, so bridge the identity.
  return withBundleAnalyzer(
    resolved as unknown as Parameters<typeof withBundleAnalyzer>[0],
  ) as NextConfig;
}
