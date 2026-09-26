/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import type { Resolve } from "@packages/lib/public-address";
import { directHop, fetchPublic, type Hop, NotPublic } from "./public-fetch";

const resolve: Resolve = async (host) => [
  {
    address: host === "metadata.example" ? "169.254.169.254" : "93.184.215.14",
    family: 4,
  },
];

/** A network answering from `routes`, keeping what was asked of it. */
function network(
  routes: Record<string, () => Response>,
  asked: { at: string; cookie?: string | null }[] = [],
): Hop {
  return async (url, address, init) => {
    asked.push({
      at: `${url.href} @ ${address.address}`,
      cookie: init.headers.get("cookie"),
    });
    const route = routes[url.href];
    if (!route) throw new Error(`nothing at ${url.href}`);
    return route();
  };
}
const moved = (location: string) => () =>
  new Response(null, { status: 302, headers: { location } });

describe("fetching for a user", () => {
  test("reads a public page from the address it checked", async () => {
    const asked: { at: string }[] = [];
    const response = await fetchPublic(
      "https://news.example/post",
      {},
      {
        resolve,
        hop: network(
          { "https://news.example/post": () => new Response("the post") },
          asked,
        ),
      },
    );
    expect(await response.text()).toBe("the post");
    expect(asked.map(({ at }) => at)).toEqual([
      "https://news.example/post @ 93.184.215.14",
    ]);
  });

  test("asks nothing of a private address, however it is written", async () => {
    const asked: { at: string }[] = [];
    for (const src of [
      "http://169.254.169.254/latest/meta-data/",
      "http://0xa9fea9fe/",
      "http://2130706433/",
      "http://[::ffff:10.0.0.1]/",
      "http://[fe80::1]/",
      "http://metadata.example/",
      "file:///etc/passwd",
    ])
      await expect(
        fetchPublic(src, {}, { resolve, hop: network({}, asked) }),
      ).rejects.toBeInstanceOf(NotPublic);
    expect(asked).toEqual([]);
  });

  test("follows a redirect only while each hop is public", async () => {
    const asked: { at: string }[] = [];
    const hop = network(
      {
        "https://news.example/old": moved("/post"),
        "https://news.example/post": () => new Response("the post"),
        "https://news.example/to-metadata": moved("http://169.254.169.254/"),
        "https://news.example/to-hex": moved("http://0x7f000001/admin"),
        "https://news.example/to-name": moved("http://metadata.example/"),
        "https://news.example/to-v6": moved("http://[fc00::1]/"),
      },
      asked,
    );
    const read = (src: string) => fetchPublic(src, {}, { resolve, hop });

    expect(await (await read("https://news.example/old")).text()).toBe(
      "the post",
    );
    for (const src of [
      "https://news.example/to-metadata",
      "https://news.example/to-hex",
      "https://news.example/to-name",
      "https://news.example/to-v6",
    ])
      await expect(read(src)).rejects.toBeInstanceOf(NotPublic);
    expect(asked.every(({ at }) => at.endsWith("@ 93.184.215.14"))).toBe(true);
  });

  test("gives up on a redirect loop", async () => {
    const hop = network({
      "https://news.example/a": moved("/b"),
      "https://news.example/b": moved("/a"),
    });
    await expect(
      fetchPublic("https://news.example/a", {}, { resolve, hop }),
    ).rejects.toThrow("Too many redirects");
  });

  test("sends a site's cookies to that site alone", async () => {
    const asked: { at: string; cookie: string | null }[] = [];
    const hop = network(
      {
        "https://news.example/a": moved("/b"),
        "https://news.example/b": moved("https://elsewhere.example/c"),
        "https://elsewhere.example/c": () => new Response("elsewhere"),
      },
      asked,
    );
    await fetchPublic(
      "https://news.example/a",
      { headers: { cookie: "session=1" } },
      { resolve, hop },
    );
    expect(asked.map(({ cookie }) => cookie)).toEqual([
      "session=1",
      "session=1",
      null,
    ]);
  });
});

describe("a direct hop", () => {
  test("connects to the address checked, whatever the name resolves to now, and unpacks the body", async () => {
    const server = createServer((request, response) => {
      response.writeHead(200, { "content-encoding": "gzip" });
      response.end(gzipSync(`host ${request.headers.host}`));
    }).listen(0, "127.0.0.1");
    await new Promise((listening) => server.once("listening", listening));
    const { port } = server.address() as { port: number };
    try {
      const response = await directHop(
        new URL(`http://pinned.example:${port}/`),
        { address: "127.0.0.1", family: 4 },
        { headers: new Headers({ "accept-encoding": "gzip" }) },
      );
      expect(await response.text()).toBe(`host pinned.example:${port}`);
    } finally {
      server.close();
    }
  });
});
