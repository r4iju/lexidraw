import "server-only";

import { ProxyAgent } from "undici";

type NordServer = {
  hostname?: string;
  domain?: string;
  technologies?: Array<{ identifier?: string }>;
  features?: { proxy_ssl?: boolean };
};

type CacheEntry = { urls: string[] | null; expiresAt: number };
const cache = new Map<string, CacheEntry>();

type NordCountry = { id: number; name: string };

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

/** Fetch a shuffled list of HTTPS proxy URLs usable with undici's ProxyAgent. */
export async function getNordHttpsProxyUrls(
  opts: {
    user?: string;
    pass?: string;
    limit?: number; // total desired before caller slices
    ttlMs?: number; // cache TTL
    countryId?: number; // optional fixed country
  } = {},
): Promise<string[]> {
  const { user, pass, limit = 50, ttlMs = 10 * 60_000, countryId } = opts;

  const cacheKey = `nord:proxy_ssl:${countryId ?? "global"}:${user ?? ""}:$${
    pass ?? ""
  }:${limit}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const auth =
    user && pass
      ? `${encodeURIComponent(user)}:${encodeURIComponent(pass)}@`
      : "";

  async function fetchRecommendations(
    params: URLSearchParams,
  ): Promise<NordServer[]> {
    const url = `https://api.nordvpn.com/v1/servers/recommendations?${params.toString()}`;
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Nord API ${res.status}`);
    const data = (await res.json()) as unknown;
    return Array.isArray(data) ? (data as NordServer[]) : [];
  }

  async function fetchCountries(): Promise<NordCountry[]> {
    const res = await fetch("https://api.nordvpn.com/v1/servers/countries", {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Nord API ${res.status}`);
    const data = (await res.json()) as unknown;
    return Array.isArray(data) ? (data as NordCountry[]) : [];
  }

  let items: NordServer[] = [];
  try {
    if (typeof countryId === "number") {
      const params = new URLSearchParams({
        "filters[servers_technologies][identifier]": "proxy_ssl",
        limit: String(limit),
        "filters[country_id]": String(countryId),
      });
      items = await fetchRecommendations(params);
    } else {
      // Global diversity: sample random countries and aggregate
      const countries = await fetchCountries();
      const ids = countries
        .map((c) => c.id)
        .filter((n): n is number => typeof n === "number");
      for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const a = ids[i];
        const b = ids[j];
        ids[i] = b as number;
        ids[j] = a as number;
      }
      const countryQueries = Math.min(12, ids.length);
      const perCountry = Math.max(
        1,
        Math.ceil(limit / Math.max(1, countryQueries)),
      );
      const chosen = ids.slice(0, countryQueries);
      const perCountryClamped = Math.min(perCountry, 10);
      const calls = chosen.map((id) => {
        const params = new URLSearchParams({
          "filters[servers_technologies][identifier]": "proxy_ssl",
          limit: String(perCountryClamped),
          "filters[country_id]": String(id),
        });
        return fetchRecommendations(params).catch(() => []);
      });
      const results = await Promise.all(calls);
      for (const arr of results) items.push(...arr);

      if (items.length < Math.max(10, Math.floor(limit / 2))) {
        const params = new URLSearchParams({
          "filters[servers_technologies][identifier]": "proxy_ssl",
          limit: String(limit),
        });
        const globalItems = await fetchRecommendations(params).catch(() => []);
        items.push(...globalItems);
      }
    }
  } catch {
    const fallback = new URLSearchParams({
      "filters[servers_technologies][identifier]": "proxy_ssl",
      limit: String(limit),
    });
    items = await fetchRecommendations(fallback).catch(() => []);
  }

  const hostSet = new Set<string>();
  for (const it of items) {
    const host = (it && (it.hostname || it.domain)) as string | undefined;
    if (host) hostSet.add(host);
  }
  const hosts = Array.from(hostSet);
  const urls = hosts.map((h) => `https://${auth}${h}:89`);

  for (let i = urls.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = urls[i];
    const b = urls[j];
    if (a === undefined || b === undefined) continue;
    urls[i] = b;
    urls[j] = a;
  }

  setCached(cacheKey, urls, ttlMs);
  return urls;
}

export function makeNordProxyAgents(
  urls: string[],
): InstanceType<typeof ProxyAgent>[] {
  return urls.map((u) => new ProxyAgent(u));
}
