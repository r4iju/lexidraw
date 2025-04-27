import { createApi } from "unsplash-js";
import env from "@packages/env";

// Infer type from the factory function
type UnsplashClient = ReturnType<typeof createApi>;

let unsplashInstance: UnsplashClient | undefined;

const createClient = (): UnsplashClient => {
  if (!env.UNSPLASH_ACCESS_KEY) {
    console.warn(
      "UNSPLASH_ACCESS_KEY is not set. Unsplash client created, but API calls will fail.",
    );
  }
  console.log("Creating Unsplash API client...");
  return createApi({
    accessKey: env.UNSPLASH_ACCESS_KEY,
  });
};

if (!unsplashInstance) {
  unsplashInstance = createClient();
}

export const unsplash = unsplashInstance;
