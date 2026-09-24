import type { Env } from "./env";
import { usageError } from "./errors";

export const PROFILES = {
  prod: "https://lexidraw.vercel.app",
  dev: "http://localhost:3025",
} as const;

export type ProfileName = keyof typeof PROFILES;

export type Profile = {
  name: string;
  baseUrl: string;
  /** Scheme, host, and port of `baseUrl`: the identity of the server. */
  origin: string;
  /**
   * Whether a stored token may be sent here. `LEXIDRAW_URL` can point a
   * profile at any host, and a token is bearer credential for one server
   * only, so the keychain is off unless the host is the one the token was
   * stored for.
   */
  keychainAllowed: boolean;
};

export const DEFAULT_PROFILE: ProfileName = "prod";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function resolveProfile(flag: string | undefined, env: Env): Profile {
  const name = flag ?? env.LEXIDRAW_PROFILE ?? DEFAULT_PROFILE;
  if (!Object.hasOwn(PROFILES, name)) {
    throw usageError(`unknown profile "${name}"`, {
      known: Object.keys(PROFILES),
    });
  }
  const fallback = PROFILES[name as ProfileName];
  const raw = env.LEXIDRAW_URL || fallback;
  const url = parseBaseUrl(raw);
  return {
    name,
    baseUrl: raw.replace(/\/+$/, ""),
    origin: url.origin,
    keychainAllowed: mayUseKeychain(name, url, parseBaseUrl(fallback).origin),
  };
}

/** The keychain rule, stated once. */
function mayUseKeychain(
  name: string,
  url: URL,
  defaultOrigin: string,
): boolean {
  if (url.origin === defaultOrigin) return true;
  // A dev profile is expected to move between local ports, but never off the
  // machine.
  return name === "dev" && LOOPBACK_HOSTS.has(url.hostname);
}

export function keychainRefusal(profile: Profile): string {
  return `profile "${profile.name}" points at ${profile.origin}, which is not its own host; the keychain is only used for ${PROFILES[profile.name as ProfileName]} or a loopback dev server. Use LEXIDRAW_TOKEN for this origin.`;
}

/** A directory-safe form of the origin, so one profile can cache per host. */
export function originKey(origin: string): string {
  return origin.replace("://", "-").replace(/[^a-zA-Z0-9.-]/g, "-");
}

function parseBaseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw usageError(`"${raw}" is not a valid base URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw usageError(`"${raw}" must be an http or https URL`);
  }
  return url;
}
