import * as http from "node:http";
import * as https from "node:https";
import { pipeline, type Readable } from "node:stream";
import * as zlib from "node:zlib";
import {
  type Address,
  publicAddress,
  type Resolve,
  reachable,
  systemResolve,
} from "@packages/lib/public-address";
import {
  type Dispatcher,
  type ProxyAgent,
  request as undiciRequest,
} from "undici";

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
        headers: supportedHeaders(headers),
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
        try {
          settle(
            new Response(
              empty
                ? null
                : streamOf(unpacked(message, answered.get("content-encoding"))),
              { status, headers: answered },
            ),
          );
        } catch (error) {
          message.destroy();
          fail(error);
        }
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
      body.destroy();
      await chunks.return?.();
    },
  });
}

function supportedHeaders(headers: Headers): Record<string, string> {
  const supported = new Headers(headers);
  supported.set("accept-encoding", "gzip, deflate");
  return Object.fromEntries(supported);
}

function unpacked(body: Readable, encoding: string | null): Readable {
  if (encoding?.split(",").some((part) => part.trim().toLowerCase() === "br"))
    throw new Error("Unsupported response content encoding");
  let decoder: Readable & NodeJS.WritableStream;
  switch (encoding?.trim().toLowerCase()) {
    case "gzip":
    case "x-gzip":
      decoder = zlib.createGunzip();
      break;
    case "deflate":
      decoder = zlib.createInflate();
      break;
    default:
      return body;
  }
  return pipeline(body, decoder, () => {
    // The reader sees decoder errors; pipeline also closes the upstream.
  });
}

/** Through a proxy, which looks the host up again on its own network. */
export const proxyHop =
  (dispatcher: ProxyDispatcher): Hop =>
  async (url, _address, { method, headers, signal }) => {
    // Fetch decodes upstream bodies before callers can reject an encoding.
    const upstream = await undiciRequest(url, {
      method: method as Dispatcher.HttpMethod | undefined,
      headers: supportedHeaders(headers),
      signal,
      dispatcher,
    });
    const answered = new Headers();
    for (const [name, value] of Object.entries(upstream.headers))
      for (const each of [value ?? []].flat()) answered.append(name, each);
    const status = upstream.statusCode;
    const empty = status === 204 || status === 304 || method === "HEAD";
    try {
      const body = empty
        ? null
        : streamOf(unpacked(upstream.body, answered.get("content-encoding")));
      if (empty) upstream.body.resume();
      return withResponseMetadata(
        new Response(body, {
          status,
          statusText: http.STATUS_CODES[status] ?? "",
          headers: answered,
        }),
        url.href,
      );
    } catch (error) {
      upstream.body.destroy();
      throw error;
    }
  };

function withResponseMetadata(response: Response, url: string): Response {
  return Object.defineProperties(response, {
    url: { get: () => url },
    redirected: { get: () => false },
    type: { get: () => "basic" },
    clone: {
      value: () =>
        withResponseMetadata(Response.prototype.clone.call(response), url),
    },
  });
}
