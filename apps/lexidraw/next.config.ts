import { NextConfig } from "next";
import nextBundleAnalyzer from "@next/bundle-analyzer";
import env from "@packages/env";

const withBundleAnalyzer = nextBundleAnalyzer({
  enabled: false, // process.env.ANALYZE === "true",
});

const config: NextConfig = {
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
      ({ context, request }, callback) => {
        if (request && request.endsWith(".node")) {
          return callback(null, "commonjs " + request); // leave native modules to Node.js
        }
        callback();
      },
    ];

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
        hostname: new URL(env.SUPABASE_S3_ENDPOINT).hostname,
        pathname: new URL(env.SUPABASE_S3_ENDPOINT).pathname + "/**",
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
    ],
  },
};

export default withBundleAnalyzer(config);
