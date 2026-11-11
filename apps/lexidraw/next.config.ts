import type { NextConfig } from "next";
import env from "@packages/env";
import { withWorkflow } from "workflow/next";
import { reactCompiler } from "./react-compiler";
import { EXCALIDRAW_ASSETS } from "./src/lib/excalidraw-assets";

function origin(url: string | undefined) {
  if (!url) return [];
  try {
    return [new URL(url).origin];
  } catch {
    // A relative address is our own origin, which 'self' covers.
    return [];
  }
}

/**
 * Observed in the browser console, not reported to an endpoint, until it is
 * shown to allow everything the app means to load and can be enforced.
 */
function reportOnlyPolicy() {
  const storage = [
    env.SUPABASE_S3_ENDPOINT,
    env.VERCEL_BLOB_STORAGE_HOST,
    env.VERCEL_BLOB_STORAGE_HOST_DEV,
  ].flatMap(origin);
  const directives = {
    "default-src": ["'self'"],
    // Next's streamed payload and bootstrap are inline scripts, and pages
    // prerendered as static shells cannot carry a per-request nonce. HTML
    // blocks run in a WebAssembly interpreter.
    "script-src": [
      "'self'",
      "'unsafe-inline'",
      "'wasm-unsafe-eval'",
      "https://platform.twitter.com",
      ...(env.REACT_SCAN_ENABLED ? ["https://unpkg.com"] : []),
    ],
    "style-src": ["'self'", "'unsafe-inline'"],
    // Documents show images from any link they were given.
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "media-src": ["'self'", "data:", "blob:", ...storage],
    "font-src": [
      "'self'",
      "data:",
      "https://fonts.gstatic.com",
      // Excalidraw lists this fallback in every font face after our own copy,
      // and the browser checks each listed source even when it never loads it.
      "https://esm.sh/@excalidraw/",
    ],
    "frame-src": [
      "'self'",
      "https://www.youtube-nocookie.com",
      "https://www.figma.com",
      "https://platform.twitter.com",
      ...origin(env.NEXT_PUBLIC_CODE_MODE_RUNNER_URL),
    ],
    "worker-src": ["'self'", "blob:"],
    "connect-src": [
      "'self'",
      ...storage,
      "https://vercel.com/api/blob/",
      "https://images.unsplash.com",
      "https://openrouter.ai",
    ],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
  };
  return Object.entries(directives)
    .map(([name, sources]) => [name, ...sources].join(" "))
    .join("; ");
}

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
  headers: async () => [
    {
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        // Not 'none': the document screenshot route frames our own pages.
        { key: "X-Frame-Options", value: "SAMEORIGIN" },
        { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
      ],
    },
    {
      source: "/:path((?!api(?:/|$)).*)",
      headers: [
        {
          key: "Content-Security-Policy-Report-Only",
          value: reportOnlyPolicy(),
        },
      ],
    },
    // Framed, the approval could be clicked by someone who cannot see it.
    // After the site-wide framing headers, so these replace them.
    {
      source: "/native-sign-in",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
      ],
    },
    // Named by their content, so a font never changes under its address.
    {
      source: `${EXCALIDRAW_ASSETS}fonts/:path*`,
      headers: [
        { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
      ],
    },
  ],
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
    rules: {
      "**/@excalidraw/excalidraw/dist/*/subset-worker.chunk.js": {
        loaders: [
          {
            loader: "./excalidraw-worker-loader.cjs",
            options: { url: `${EXCALIDRAW_ASSETS}subset-worker.chunk.js` },
          },
        ],
      },
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
  return configWithWorkflow(phase, ctx);
}
