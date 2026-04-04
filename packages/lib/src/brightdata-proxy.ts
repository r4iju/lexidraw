type CacheEntry = { urls: string[] | null; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const DEFAULT_TTL_MS = 10 * 60_000;

function getCached(key: string): string[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt > Date.now()) return entry.urls ?? null;
  cache.delete(key);
  return null;
}

function setCached(key: string, urls: string[], ttlMs: number): void {
  cache.set(key, { urls, expiresAt: Date.now() + ttlMs });
}

function normalizeSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildBrightDataUsername({
  username,
  country,
  sessionId,
}: {
  username: string;
  country?: string;
  sessionId: string;
}): string {
  const parts = [username];
  const normalizedCountry = country ? normalizeSegment(country) : "";
  if (normalizedCountry) parts.push(`country-${normalizedCountry}`);
  parts.push(`session-${sessionId}`);
  return parts.join("-");
}

export async function getBrightDataProxyUrls({
  proxyUrl,
  country,
  sessionPrefix = "lexidraw",
  limit = 50,
  ttlMs = DEFAULT_TTL_MS,
}: {
  proxyUrl: string;
  country?: string;
  sessionPrefix?: string;
  limit?: number;
  ttlMs?: number;
}): Promise<string[]> {
  const parsedProxyUrl = new URL(proxyUrl);
  const baseUsername = decodeURIComponent(parsedProxyUrl.username);
  const password = decodeURIComponent(parsedProxyUrl.password);
  const host = parsedProxyUrl.hostname;
  const port = parsedProxyUrl.port;
  const normalizedProtocol =
    parsedProxyUrl.protocol === "https:" ? "https" : "http";
  const normalizedPrefix = normalizeSegment(sessionPrefix) || "lexidraw";
  const cacheKey = [
    "brightdata",
    proxyUrl,
    password,
    host,
    port,
    normalizedProtocol,
    country ?? "",
    normalizedPrefix,
    String(limit),
  ].join(":");
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const timeWindow = Math.floor(Date.now() / Math.max(ttlMs, 1)).toString(36);
  const urls = Array.from({ length: limit }, (_, index) => {
    const sessionId = `${normalizedPrefix}-${timeWindow}-${index + 1}`;
    const sessionUsername = buildBrightDataUsername({
      username: baseUsername,
      country,
      sessionId,
    });
    return `${normalizedProtocol}://${encodeURIComponent(
      sessionUsername,
    )}:${encodeURIComponent(password)}@${host}${port ? `:${port}` : ""}`;
  });

  shuffleInPlace(urls);
  setCached(cacheKey, urls, ttlMs);
  return urls;
}

export function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = arr[i];
    const b = arr[j];
    if (a === undefined || b === undefined) continue;
    arr[i] = b as T;
    arr[j] = a as T;
  }
}
