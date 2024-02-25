import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  server: {
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    DATABASE_URL: z
      .string()
      .url()
      .refine(
        (str) => !str.includes("YOUR_MYSQL_URL_HERE"),
        "You forgot to change the default URL",
      ),
    SHARED_KEY: z.string(),
    NEXTAUTH_SECRET: z.string(),
    NEXTAUTH_URL: z.preprocess(
      (str) => process.env.VERCEL_URL ?? str,
      process.env.VERCEL ? z.string() : z.string().url(),
    ),
    SUPABASE_URL: z.string().url(),
    SUPABASE_KEY: z.string().min(1),
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
            urls: z.string().url(),
            username: z.string(),
            credential: z.string(),
          }),
          z.object({
            urls: z.string().url(),
          }),
        ]),
      ),
    ),
  },
  client: {
    NEXT_PUBLIC_FIRESTORE_API_KEY: z.string().min(1),
    NEXT_PUBLIC_FIRESTORE_AUTH_DOMAIN: z.string().min(1),
    NEXT_PUBLIC_FIRESTORE_PROJECT_ID: z.string().min(1),
    NEXT_PUBLIC_FIRESTORE_STORAGE_BUCKET: z.string().min(1),
    NEXT_PUBLIC_FIRESTORE_MESSAGING_SENDER_ID: z.string().min(1),
    NEXT_PUBLIC_FIRESTORE_APP_ID: z.string().min(1),
  },
  runtimeEnv: {
    ICE_SERVER_CONFIG: process.env.ICE_SERVER_CONFIG,
    SHARED_KEY: process.env.SHARED_KEY,
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_KEY: process.env.SUPABASE_KEY,
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
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
});
