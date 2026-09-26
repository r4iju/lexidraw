import * as http from "node:http";
import * as https from "node:https";
import type { Readable } from "node:stream";
import * as zlib from "node:zlib";
import {
  type Address,
  publicAddress,
  type Resolve,
  reachable,
  systemResolve,
} from "@packages/lib/public-address";
import { type ProxyAgent, fetch as undiciFetch } from "undici";

export type ProxyDispatcher = InstanceType<typeof ProxyAgent>;

export type HopInit = {
  method?: string;
  headers: Headers;
  signal?: AbortSignal;
};
/**
 * One request to `url`, whose host was checked to be `address`, answering
 * redirects rather than following them.
 */
export type Hop = (
  url: URL,
  address: Address,
  init: HopInit,
) => Promise<Response>;

/** Refused because it leads somewhere a server may not reach. */
export class NotPublic extends Error {
  constructor(src: string) {
    super(`Only public http(s) addresses may be fetched, not ${src}`);
    this.name = "NotPublic";
  }
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
/** Headers that belong to the site they were given for. */
const SITE_BOUND = ["cookie", "authorization"];

/**
 * A GET of `src` on a user's behalf, refused with NotPublic unless it and
 * every redirect after it lead to a public http(s) address.
 */
export async function fetchPublic(
  src: string,
  init: { method?: string; headers?: HeadersInit; signal?: AbortSignal } = {},
  {
    resolve = systemResolve,
    hop = directHop,
    maxRedirects = 5,
  }: { resolve?: Resolve; hop?: Hop; maxRedirects?: number } = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  let url = reachable(src);
  for (let hops = 0; hops <= maxRedirects; hops++) {
    if (!url) throw new NotPublic(src);
    const address = await publicAddress(url, resolve, init.signal);
    if (!address) throw new NotPublic(url.href);
    const response = await hop(url, address, { ...init, headers });
    const location = REDIRECTS.has(response.status)
      ? response.headers.get("location")
      : null;
    if (!location) return response;
    await response.body?.cancel();
    const next = reachable(new URL(location, url).href);
    if (next?.origin !== url.origin)
      for (const name of SITE_BOUND) headers.delete(name);
    url = next;
  }
  throw new Error(`Too many redirects from ${src}`);
}

/** Connects to the checked address itself, so no second lookup can move it. */
export const directHop: Hop = (url, address, { method, headers, signal }) =>
  new Promise((settle, fail) => {
    const client = url.protocol === "https:" ? https : http;
    const request = client.request(
      url,
      {
        method: method ?? "GET",
        headers: Object.fromEntries(headers),
        signal,
        agent: false,
        lookup: (_host, options, callback) => {
          if ((options as { all?: boolean }).all)
            (callback as (error: null, all: Address[]) => void)(null, [
              address,
            ]);
          else callback(null, address.address, address.family);
        },
      },
      (message) => {
        const status = message.statusCode ?? 0;
        const answered = new Headers();
        for (const [name, value] of Object.entries(message.headers))
          for (const each of [value ?? []].flat()) answered.append(name, each);
        const empty = status === 204 || status === 304 || method === "HEAD";
        settle(
          new Response(
            empty
              ? null
              : streamOf(unpacked(message, answered.get("content-encoding"))),
            { status, headers: answered },
          ),
        );
      },
    );
    request.on("error", fail);
    request.end();
  });

function streamOf(body: Readable): ReadableStream<Uint8Array> {
  const chunks: AsyncIterator<Uint8Array> = body[Symbol.asyncIterator]();
  return new ReadableStream({
    async pull(stream) {
      const { done, value } = await chunks.next();
      if (done) stream.close();
      else stream.enqueue(value);
    },
    cancel: async () => {
      await chunks.return?.();
    },
  });
}

function unpacked(body: Readable, encoding: string | null): Readable {
  switch (encoding?.trim().toLowerCase()) {
    case "gzip":
    case "x-gzip":
      return body.pipe(zlib.createGunzip());
    case "deflate":
      return body.pipe(zlib.createInflate());
    case "br":
      return body.pipe(zlib.createBrotliDecompress());
    default:
      return body;
  }
}

/** Through a proxy, which looks the host up again on its own network. */
export const proxyHop =
  (dispatcher: ProxyDispatcher): Hop =>
  async (url, _address, { method, headers, signal }) =>
    undiciFetch(url, {
      method,
      headers,
      signal,
      redirect: "manual",
      dispatcher,
    });
