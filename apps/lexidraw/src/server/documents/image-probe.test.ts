/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import {
  type Fetched,
  isPublicAddress,
  probeImageSize,
  type Resolve,
  type Transport,
} from "./image-probe";

// A 37×23 PNG's signature and header chunk: all a probe needs of it.
const PNG_HEAD = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAACUAAAAXEAI=", "base64"),
);

const PUBLIC: Resolve = async () => [{ address: "93.184.215.14", family: 4 }];

/** A transport answering from `routes`, keeping what was asked of it. */
function network(
  routes: Record<string, (url: URL) => Partial<Fetched>>,
  asked: string[] = [],
): Transport {
  return async (url, address) => {
    asked.push(`${url.href} @ ${address.address}`);
    const route = routes[url.href];
    if (!route) throw new Error(`nothing at ${url.href}`);
    return {
      status: 200,
      body: (async function* () {})(),
      close: () => {},
      ...route(url),
    };
  };
}

const serve =
  (...chunks: Uint8Array[]) =>
  () => ({
    body: (async function* () {
      yield* chunks;
    })(),
  });

describe("which addresses a probe may reach", () => {
  test("private, loopback, link-local, metadata and reserved addresses are refused", () => {
    for (const address of [
      "0.0.0.0",
      "10.1.2.3",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.5.4",
      "172.31.255.255",
      "192.168.1.1",
      "198.18.0.1",
      "224.0.0.1",
      "255.255.255.255",
      "::",
      "::1",
      "fe80::1",
      "fc00::1",
      "fd00:ec2::254",
      "ff02::1",
      "::ffff:127.0.0.1",
      "::ffff:a9fe:a9fe",
      "64:ff9b::a9fe:a9fe",
      "2001:db8::1",
    ])
      expect([address, isPublicAddress(address)]).toEqual([address, false]);
  });

  test("public addresses are allowed", () => {
    for (const address of [
      "93.184.215.14",
      "8.8.8.8",
      "172.32.0.1",
      "2606:4700:4700::1111",
      "::ffff:8.8.8.8",
    ])
      expect([address, isPublicAddress(address)]).toEqual([address, true]);
  });
});

describe("a picture's size, probed on the network", () => {
  test("reads a public picture's size, and stops once it has it", async () => {
    let pulled = 0;
    let closed = false;
    const size = await probeImageSize("https://images.example/a.png", {
      resolve: PUBLIC,
      transport: network({
        "https://images.example/a.png": () => ({
          body: (async function* () {
            for (;;) {
              pulled++;
              yield PNG_HEAD;
            }
          })(),
          close: () => {
            closed = true;
          },
        }),
      }),
    });
    expect(size).toEqual({ width: 37, height: 23 });
    expect(pulled).toBe(1);
    expect(closed).toBe(true);
  });

  test("connects to the address it checked, not one looked up again", async () => {
    const asked: string[] = [];
    await probeImageSize("https://images.example/a.png", {
      resolve: PUBLIC,
      transport: network(
        { "https://images.example/a.png": serve(PNG_HEAD) },
        asked,
      ),
    });
    expect(asked).toEqual(["https://images.example/a.png @ 93.184.215.14"]);
  });

  test("asks nothing of a URL that is not plain http(s), or that carries credentials", async () => {
    const asked: string[] = [];
    const transport = network({}, asked);
    for (const src of [
      "file:///etc/passwd",
      "data:image/png;base64,iVBORw0KGgo=",
      "ftp://images.example/a.png",
      "https://user:secret@images.example/a.png",
      "/images/a.png",
    ])
      expect(
        await probeImageSize(src, { resolve: PUBLIC, transport }),
      ).toBeUndefined();
    expect(asked).toEqual([]);
  });

  test("asks nothing of a host that is, or resolves to, a private address", async () => {
    const asked: string[] = [];
    const transport = network({}, asked);
    const inside: Resolve = async () => [
      { address: "93.184.215.14", family: 4 },
      { address: "10.0.0.7", family: 4 },
    ];
    expect(
      await probeImageSize("https://intranet.example/a.png", {
        resolve: inside,
        transport,
      }),
    ).toBeUndefined();
    for (const src of [
      "http://169.254.169.254/latest/meta-data/",
      "http://127.0.0.1:3000/a.png",
      "http://[::1]/a.png",
      "http://[fd00:ec2::254]/a.png",
    ])
      expect(
        await probeImageSize(src, { resolve: PUBLIC, transport }),
      ).toBeUndefined();
    expect(asked).toEqual([]);
  });

  test("follows a redirect to a public host, but not to a private one, and not forever", async () => {
    const asked: string[] = [];
    const resolve: Resolve = async (host) => [
      {
        address:
          host === "metadata.example" ? "169.254.169.254" : "93.184.215.14",
        family: 4,
      },
    ];
    const moved = (location: string) => () => ({ status: 302, location });
    const transport = network(
      {
        "https://images.example/old.png": moved("/a.png"),
        "https://images.example/a.png": serve(PNG_HEAD),
        "https://images.example/sneaky.png": moved(
          "http://metadata.example/a.png",
        ),
        "https://images.example/literal.png": moved("http://169.254.169.254/"),
        "https://images.example/1": moved("/2"),
        "https://images.example/2": moved("/3"),
        "https://images.example/3": moved("/4"),
        "https://images.example/4": moved("/a.png"),
      },
      asked,
    );
    const probe = (src: string) => probeImageSize(src, { resolve, transport });
    expect(await probe("https://images.example/old.png")).toEqual({
      width: 37,
      height: 23,
    });
    expect(await probe("https://images.example/sneaky.png")).toBeUndefined();
    expect(await probe("https://images.example/literal.png")).toBeUndefined();
    expect(await probe("https://images.example/1")).toBeUndefined();
    expect(asked.some((line) => line.includes("169.254.169.254"))).toBe(false);
    expect(asked).not.toContain("https://images.example/4 @ 93.184.215.14");
  });

  test("gives up past its byte cap, its time, or on an error status", async () => {
    let pulled = 0;
    const endless = await probeImageSize("https://images.example/noise", {
      resolve: PUBLIC,
      maxBytes: 4096,
      transport: network({
        "https://images.example/noise": () => ({
          body: (async function* () {
            for (;;) {
              pulled++;
              yield new Uint8Array(1024);
            }
          })(),
        }),
      }),
    });
    expect(endless).toBeUndefined();
    expect(pulled).toBeLessThanOrEqual(5);

    const started = Date.now();
    const stalled = await probeImageSize("https://images.example/slow.png", {
      resolve: PUBLIC,
      timeoutMs: 50,
      transport: () => new Promise(() => {}),
    });
    expect(stalled).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(1000);

    const missing = await probeImageSize("https://images.example/gone.png", {
      resolve: PUBLIC,
      transport: network({
        "https://images.example/gone.png": () => ({
          status: 404,
          body: (async function* () {
            yield PNG_HEAD;
          })(),
        }),
      }),
    });
    expect(missing).toBeUndefined();
  });
});
