import { usageError } from "./errors";
import type { Env } from "./context";

export const PROFILES = {
  prod: "https://lexidraw.app",
  dev: "http://localhost:3025",
} as const;

export type ProfileName = keyof typeof PROFILES;

export type Profile = { name: string; baseUrl: string };

export const DEFAULT_PROFILE: ProfileName = "prod";

export function resolveProfile(flag: string | undefined, env: Env): Profile {
  const name = flag ?? env.LEXIDRAW_PROFILE ?? DEFAULT_PROFILE;
  if (!Object.hasOwn(PROFILES, name)) {
    throw usageError(`unknown profile "${name}"`, {
      known: Object.keys(PROFILES),
    });
  }
  const baseUrl = env.LEXIDRAW_URL || PROFILES[name as ProfileName];
  return { name, baseUrl: baseUrl.replace(/\/+$/, "") };
}
