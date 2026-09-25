import { lookup } from "node:dns/promises";
import * as http from "node:http";
import * as https from "node:https";
import { isIP } from "node:net";
import type { NaturalSize } from "@packages/lexical-nodes";
import { imageSizeOf } from "./image-size";

export type Address = { address: string; family: number };
export type Resolve = (hostname: string) => Promise<Address[]>;
export type Fetched = {
  status: number;
  location?: string;
  body: AsyncIterable<Uint8Array>;
  close: () => void;
};
/** A GET of `url` connected to `address`, which has been checked. */
export type Transport = (
  url: URL,
  address: Address,
  signal: AbortSignal,
) => Promise<Fetched>;

type Options = {
  resolve?: Resolve;
  transport?: Transport;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
};

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/**
 * The size of the picture at `src`, read from its first bytes, or undefined
 * when it cannot be had within the time and bytes allowed, or from where a
 * server may not reach: anything but a public http(s) address, at every hop.
 * It never throws.
 */
export async function probeImageSize(
  src: string,
  {
    resolve = systemResolve,
    transport = nodeTransport,
    timeoutMs = 3000,
    maxBytes = 128 * 1024,
    maxRedirects = 2,
  }: Options = {},
): Promise<NaturalSize | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const expired = new Promise<undefined>((settle) =>
    controller.signal.addEventListener("abort", () => settle(undefined)),
  );
  try {
    return await Promise.race([
      follow(
        src,
        { resolve, transport, maxBytes, maxRedirects },
        controller.signal,
      ),
      expired,
    ]);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function follow(
  src: string,
  {
    resolve,
    transport,
    maxBytes,
    maxRedirects,
  }: Required<Omit<Options, "timeoutMs">>,
  signal: AbortSignal,
) {
  let url = reachable(src);
  for (let hop = 0; url && hop <= maxRedirects; hop++) {
    const address = await publicAddress(url, resolve);
    if (!address || signal.aborted) return undefined;
    const response = await transport(url, address, signal);
    try {
      if (REDIRECTS.has(response.status) && response.location) {
        url = reachable(new URL(response.location, url).href);
        continue;
      }
      if (response.status < 200 || response.status >= 300) return undefined;
      return await readSize(response.body, maxBytes, signal);
    } finally {
      response.close();
    }
  }
  return undefined;
}

/** An absolute http(s) URL without credentials, or nothing. */
function reachable(src: string): URL | undefined {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  if (url.username || url.password) return undefined;
  return url;
}

/** Where to connect for `url`, when every address its host has is public. */
async function publicAddress(
  url: URL,
  resolve: Resolve,
): Promise<Address | undefined> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const family = isIP(host);
  const addresses = family ? [{ address: host, family }] : await resolve(host);
  if (addresses.length === 0) return undefined;
  if (!addresses.every(({ address }) => isPublicAddress(address)))
    return undefined;
  return addresses[0];
}

async function readSize(
  body: AsyncIterable<Uint8Array>,
  maxBytes: number,
  signal: AbortSignal,
) {
  let bytes = new Uint8Array(0);
  for await (const chunk of body) {
    if (signal.aborted) return undefined;
    const joined = new Uint8Array(bytes.length + chunk.length);
    joined.set(bytes);
    joined.set(chunk, bytes.length);
    bytes = joined.subarray(0, maxBytes);
    const size = imageSizeOf(bytes);
    if (size || bytes.length >= maxBytes) return size;
  }
  return imageSizeOf(bytes);
}

const systemResolve: Resolve = (hostname) =>
  lookup(hostname, { all: true, verbatim: true });

const nodeTransport: Transport = (url, address, signal) =>
  new Promise((settle, fail) => {
    const client = url.protocol === "https:" ? https : http;
    const request = client.get(
      url,
      {
        signal,
        agent: false,
        headers: { accept: "image/*", "user-agent": "Lexidraw image size" },
        // The connection goes to the address that was checked, so a second
        // lookup cannot hand it a private one.
        lookup: (_host, options, callback) => {
          if ((options as { all?: boolean }).all)
            (callback as (error: null, all: Address[]) => void)(null, [
              address,
            ]);
          else callback(null, address.address, address.family);
        },
      },
      (response) =>
        settle({
          status: response.statusCode ?? 0,
          location: response.headers.location,
          body: response,
          close: () => response.destroy(),
        }),
    );
    request.on("error", fail);
  });

/**
 * Whether a server may reach `address`: not private, loopback, link-local
 * (the cloud metadata service among them), shared, multicast or reserved,
 * whether written as IPv4, as IPv6, or as IPv4 inside IPv6.
 */
export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) return isPublicV4(v4(address));
  if (isIP(address) !== 6) return false;
  const words = v6(address);
  const embedded = ((words[6] ?? 0) << 16) | (words[7] ?? 0);
  const leading = (count: number, value: number[]) =>
    value.every((word, index) => words[index] === word) &&
    words.slice(value.length, count).every((word) => word === 0);
  // ::ffff:a.b.c.d and the NAT64 prefix 64:ff9b::/96 carry an IPv4 address.
  if (leading(5, []) && words[5] === 0xffff) return isPublicV4(embedded >>> 0);
  if (leading(6, [0x64, 0xff9b])) return isPublicV4(embedded >>> 0);
  const first = words[0] ?? 0;
  if (words.every((word, index) => word === (index === 7 ? word : 0)))
    return false; // ::, ::1 and the deprecated IPv4-compatible range
  if ((first & 0xfe00) === 0xfc00) return false; // unique local
  if ((first & 0xffc0) === 0xfe80) return false; // link-local
  if ((first & 0xff00) === 0xff00) return false; // multicast
  if (first === 0x2001 && words[1] === 0x0db8) return false; // documentation
  return true;
}

const v4 = (address: string) =>
  address
    .split(".")
    .reduce((value, part) => ((value << 8) | Number(part)) >>> 0, 0);

const V4_BLOCKED: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function isPublicV4(value: number) {
  return !V4_BLOCKED.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (value & mask) >>> 0 === (v4(base) & mask) >>> 0;
  });
}

/** The eight 16-bit words of an IPv6 address, a dotted IPv4 tail included. */
function v6(address: string): number[] {
  let text = address.toLowerCase().split("%")[0] ?? "";
  const dotted = text.match(/(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (dotted) {
    const value = v4(dotted);
    text = `${text.slice(0, -dotted.length)}${(value >>> 16).toString(16)}:${(value & 0xffff).toString(16)}`;
  }
  const [head = "", tail] = text.split("::");
  const parse = (part: string) =>
    part ? part.split(":").map((word) => Number.parseInt(word, 16)) : [];
  const start = parse(head);
  const end = tail === undefined ? [] : parse(tail);
  return [...start, ...Array(8 - start.length - end.length).fill(0), ...end];
}
