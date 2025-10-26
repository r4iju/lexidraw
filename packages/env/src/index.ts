import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

const env = createEnv({
  server: {
    REACT_SCAN_ENABLED: z.preprocess((val) => val === "true", z.boolean()),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    TURSO_URL: z.string().min(1),
    TURSO_TOKEN: z.string().min(1),
    SHARED_KEY: z.string(),
    CRON_SECRET: z.string(),
    NEXTAUTH_SECRET: z.string(),
    NEXTAUTH_URL: z.preprocess(
      (str) => str ?? process.env.VERCEL_URL,
      process.env.VERCEL ? z.string() : z.url(),
    ),
    VERCEL_URL: z.string(),
    UNSPLASH_APP_ID: z.string(),
    UNSPLASH_ACCESS_KEY: z.string(),
    UNSPLASH_SECRET_KEY: z.string(),
    SUPABASE_S3_ACCESS_KEY_ID: z.string().min(1),
    SUPABASE_S3_SECRET_ACCESS_KEY: z.string().min(1),
    SUPABASE_S3_ENDPOINT: z.url(),
    SUPABASE_S3_REGION: z.string().min(1),
    SUPABASE_S3_BUCKET: z.string().min(1),
    BLOB_READ_WRITE_TOKEN: z.string().min(1),
    VERCEL_BLOB_STORAGE_HOST: z.url(),
    GITHUB_CLIENT_ID: z.string().min(1),
    GITHUB_CLIENT_SECRET: z.string().min(1),
    ICE_SERVER_CONFIG: z.preprocess(
      (val) => {
        if (typeof val === "string") {
          return JSON.parse(val);
        } else {
          throw new Error("ICE_SERVER_CONFIG must be a JSON string");
        }
      },
      z.array(
        z.union([
          z.object({
            urls: z.url(),
            username: z.string(),
            credential: z.string(),
          }),
          z.object({
            urls: z.url(),
          }),
        ]),
      ),
    ),
    ANALYZE: z.preprocess((val) => val === "true", z.boolean()),
    MEDIA_DOWNLOADER_PORT: z.coerce.number().optional(),
    MEDIA_DOWNLOADER_URL: z.url(),
    // Optional org/global LLM keys used as fallbacks when user-level keys are absent
    OPENAI_API_KEY: z.string().optional(),
    GOOGLE_API_KEY: z.string().optional(),
    // Google Custom Search (required org-level for server-side proxy)
    GOOGLE_SEARCH_ENGINE_ID: z.string().min(1),
    // Kokoro sidecar (optional; used in local/dev or when configured)
    KOKORO_URL: z.url().optional(),
    KOKORO_BEARER: z.string().optional(),
    // Optional pricing/budget controls (USD values as strings)
    TTS_PRICE_OPENAI_PER_MILLION_CHARS: z.string().optional(),
    TTS_PRICE_GOOGLE_PER_MILLION_CHARS: z.string().optional(),
    TTS_MAX_ESTIMATED_COST_USD: z.string().optional(),
    HEADLESS_RENDER_ENABLED: z
      .preprocess((val) => val === "true", z.boolean())
      .optional(),
    HEADLESS_RENDER_URL: z.url().optional(),
    NORDVPN_SERVICE_USER: z.string(),
    NORDVPN_SERVICE_PASS: z.string(),
    // Cloudflare Access (used on Vercel only; optional locally)
    CF_ACCESS_CLIENT_ID: z.string().optional(),
    CF_ACCESS_CLIENT_SECRET: z.string().optional(),
  },
  client: {
    NEXT_PUBLIC_UNSPLASH_APP_NAME: z.string().min(1),
    NEXT_PUBLIC_NODE_ENV: z.enum(["development", "test", "production"]),
    NEXT_PUBLIC_WS_SERVER: z.string().min(1),
    NEXT_PUBLIC_FIRESTORE_API_KEY: z.string().min(1),
    NEXT_PUBLIC_FIRESTORE_AUTH_DOMAIN: z.string().min(1),
    NEXT_PUBLIC_FIRESTORE_PROJECT_ID: z.string().min(1),
    NEXT_PUBLIC_FIRESTORE_STORAGE_BUCKET: z.string().min(1),
    NEXT_PUBLIC_FIRESTORE_MESSAGING_SENDER_ID: z.string().min(1),
    NEXT_PUBLIC_FIRESTORE_APP_ID: z.string().min(1),
  },
  runtimeEnv: {
    REACT_SCAN_ENABLED: process.env.REACT_SCAN_ENABLED,
    NEXT_PUBLIC_UNSPLASH_APP_NAME: process.env.NEXT_PUBLIC_UNSPLASH_APP_NAME,
    ANALYZE: process.env.ANALYZE,
    NEXT_PUBLIC_NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_WS_SERVER: process.env.NEXT_PUBLIC_WS_SERVER,
    ICE_SERVER_CONFIG: process.env.ICE_SERVER_CONFIG,
    SHARED_KEY: process.env.SHARED_KEY,
    CRON_SECRET: process.env.CRON_SECRET,
    TURSO_URL: process.env.TURSO_URL,
    TURSO_TOKEN: process.env.TURSO_TOKEN,
    NODE_ENV: process.env.NODE_ENV,
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    VERCEL_URL: process.env.VERCEL_URL,
    UNSPLASH_APP_ID: process.env.UNSPLASH_APP_ID,
    UNSPLASH_ACCESS_KEY: process.env.UNSPLASH_ACCESS_KEY,
    UNSPLASH_SECRET_KEY: process.env.UNSPLASH_SECRET_KEY,
    SUPABASE_S3_ACCESS_KEY_ID: process.env.SUPABASE_S3_ACCESS_KEY_ID,
    SUPABASE_S3_SECRET_ACCESS_KEY: process.env.SUPABASE_S3_SECRET_ACCESS_KEY,
    SUPABASE_S3_ENDPOINT: process.env.SUPABASE_S3_ENDPOINT,
    SUPABASE_S3_REGION: process.env.SUPABASE_S3_REGION,
    SUPABASE_S3_BUCKET: process.env.SUPABASE_S3_BUCKET,
    BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
    VERCEL_BLOB_STORAGE_HOST: process.env.VERCEL_BLOB_STORAGE_HOST,
    GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
    NEXT_PUBLIC_FIRESTORE_API_KEY: process.env.NEXT_PUBLIC_FIRESTORE_API_KEY,
    NEXT_PUBLIC_FIRESTORE_AUTH_DOMAIN:
      process.env.NEXT_PUBLIC_FIRESTORE_AUTH_DOMAIN,
    NEXT_PUBLIC_FIRESTORE_PROJECT_ID:
      process.env.NEXT_PUBLIC_FIRESTORE_PROJECT_ID,
    NEXT_PUBLIC_FIRESTORE_STORAGE_BUCKET:
      process.env.NEXT_PUBLIC_FIRESTORE_STORAGE_BUCKET,
    NEXT_PUBLIC_FIRESTORE_MESSAGING_SENDER_ID:
      process.env.NEXT_PUBLIC_FIRESTORE_MESSAGING_SENDER_ID,
    NEXT_PUBLIC_FIRESTORE_APP_ID: process.env.NEXT_PUBLIC_FIRESTORE_APP_ID,
    MEDIA_DOWNLOADER_PORT: process.env.MEDIA_DOWNLOADER_PORT,
    MEDIA_DOWNLOADER_URL: process.env.MEDIA_DOWNLOADER_URL,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
    GOOGLE_SEARCH_ENGINE_ID: process.env.GOOGLE_SEARCH_ENGINE_ID,
    KOKORO_URL: process.env.KOKORO_URL,
    KOKORO_BEARER: process.env.KOKORO_BEARER,
    TTS_PRICE_OPENAI_PER_MILLION_CHARS:
      process.env.TTS_PRICE_OPENAI_PER_MILLION_CHARS,
    TTS_PRICE_GOOGLE_PER_MILLION_CHARS:
      process.env.TTS_PRICE_GOOGLE_PER_MILLION_CHARS,
    TTS_MAX_ESTIMATED_COST_USD: process.env.TTS_MAX_ESTIMATED_COST_USD,
    HEADLESS_RENDER_ENABLED: process.env.HEADLESS_RENDER_ENABLED,
    HEADLESS_RENDER_URL: process.env.HEADLESS_RENDER_URL,
    NORDVPN_SERVICE_USER: process.env.NORDVPN_SERVICE_USER,
    NORDVPN_SERVICE_PASS: process.env.NORDVPN_SERVICE_PASS,
    CF_ACCESS_CLIENT_ID: process.env.CF_ACCESS_CLIENT_ID,
    CF_ACCESS_CLIENT_SECRET: process.env.CF_ACCESS_CLIENT_SECRET,
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});

export default env;
