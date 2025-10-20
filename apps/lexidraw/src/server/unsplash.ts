import { createApi } from "unsplash-js";
import env from "@packages/env";

type UnsplashClient = ReturnType<typeof createApi>;

declare global {
  var __unsplashClient: UnsplashClient | undefined;
}

function createClient(): UnsplashClient {
  if (!env.UNSPLASH_ACCESS_KEY) {
    console.warn(
      "UNSPLASH_ACCESS_KEY is not set. Unsplash client created, but API calls will fail.",
    );
  }
  if (process.env.NODE_ENV !== "production") {
    console.log("Creating Unsplash API client...");
  }
  return createApi({ accessKey: env.UNSPLASH_ACCESS_KEY });
}

export function getUnsplash(): UnsplashClient {
  if (!globalThis.__unsplashClient) {
    globalThis.__unsplashClient = createClient();
  }
  return globalThis.__unsplashClient;
}

// Back-compat default export for existing imports
export const unsplash = getUnsplash();
