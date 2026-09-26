import { Resolver } from "node:dns/promises";
import { isIP } from "node:net";

export type Address = { address: string; family: number };
/** The addresses of `hostname`, given up on once `signal` aborts. */
export type Resolve = (
  hostname: string,
  signal: AbortSignal,
) => Promise<Address[]>;

/** An absolute http(s) URL without credentials, or nothing. */
export function reachable(src: string): URL | undefined {
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
export async function publicAddress(
  url: URL,
  resolve: Resolve = systemResolve,
  signal: AbortSignal = new AbortController().signal,
): Promise<Address | undefined> {
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost")) return undefined;
  const family = isIP(host);
  const addresses = family
    ? [{ address: host, family }]
    : await resolve(host, signal);
  if (addresses.length === 0) return undefined;
  if (!addresses.every(({ address }) => isPublicAddress(address)))
    return undefined;
  return addresses[0];
}

/**
 * Asks DNS directly rather than the system resolver, whose lookups hold a
 * libuv thread until they finish and cannot be cancelled.
 */
export const systemResolve: Resolve = async (hostname, signal) => {
  const resolver = new Resolver({ tries: 1 });
  const cancel = () => resolver.cancel();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const [v4, v6] = await Promise.allSettled([
      resolver.resolve4(hostname),
      resolver.resolve6(hostname),
    ]);
    return [
      ...(v4.status === "fulfilled" ? v4.value : []).map((address) => ({
        address,
        family: 4,
      })),
      ...(v6.status === "fulfilled" ? v6.value : []).map((address) => ({
        address,
        family: 6,
      })),
    ];
  } finally {
    signal.removeEventListener("abort", cancel);
  }
};

/**
 * Whether a server may reach `address`: not private, loopback, link-local
 * (the cloud metadata service among them), shared, multicast or reserved,
 * whether written as IPv4, as IPv6, or as IPv4 inside IPv6.
 */
export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) return isPublicV4(v4(address));
  if (isIP(address) !== 6) return false;
  const words = v6(address);
  const within = ([base, bits]: [string, number]) => {
    const prefix = v6(base);
    return words.every((word, index) => {
      const kept = Math.max(0, Math.min(16, bits - index * 16));
      const mask = (0xffff << (16 - kept)) & 0xffff;
      return (word & mask) === ((prefix[index] ?? 0) & mask);
    });
  };
  if (V6_CARRYING_V4.some(within))
    return isPublicV4((((words[6] ?? 0) << 16) | (words[7] ?? 0)) >>> 0);
  return within(["2000::", 3]) && !V6_BLOCKED.some(within);
}

/** Prefixes whose last 32 bits are an IPv4 address, judged as that. */
const V6_CARRYING_V4: [string, number][] = [
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
];

/**
 * The special-purpose ranges inside global unicast (2000::/3), the only
 * space a public host has. Everything outside it, IPv4-compatible,
 * IPv4-translated and local-use NAT64 included, is refused already.
 */
const V6_BLOCKED: [string, number][] = [
  ["2001::", 23], // IETF protocol assignments, Teredo among them
  ["2001:db8::", 32], // documentation
  ["2002::", 16], // 6to4
  ["3fff::", 20], // documentation
];

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
  ["192.88.99.0", 24],
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
