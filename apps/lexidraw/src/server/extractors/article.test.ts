/// <reference types="bun" />
import { describe, expect, mock, test } from "bun:test";
import type { Resolve } from "@packages/lib/public-address";
import type { Hop } from "~/server/net/public-fetch";

mock.module("server-only", () => ({}));
const { extractAndSanitizeArticle } = await import("./article");

const resolve: Resolve = async (host) => [
  {
    address: host === "metadata.example" ? "169.254.169.254" : "93.184.215.14",
    family: 4,
  },
];

/** A site answering from `pages`, keeping each request's URL and cookie. */
function site(pages: Record<string, string>) {
  const asked: { url: string; cookie: string | null }[] = [];
  const hop: Hop = async (url, _address, init) => {
    asked.push({ url: url.href, cookie: init.headers.get("cookie") });
    const page = pages[url.href];
    return page === undefined
      ? new Response("gone", { status: 404 })
      : new Response(page, { headers: { "content-type": "text/html" } });
  };
  return { asked, network: { resolve, hop } };
}

const LONG = `<article><h1>Post</h1>${"<p>A sentence of the post, long enough to read. </p>".repeat(40)}</article>`;
const short = (head: string) =>
  `<html><head>${head}</head><body><p>Subscribe.</p></body></html>`;

describe("distilling a link", () => {
  test("refuses a link to a private address, however it is written, asking nothing", async () => {
    const { asked, network } = site({});
    for (const url of [
      "http://169.254.169.254/latest/meta-data/",
      "http://2130706433/",
      "http://0xa9fea9fe/",
      "http://[::ffff:10.0.0.1]/",
      "http://[fc00::1]/",
      "http://metadata.example/",
    ])
      await expect(
        extractAndSanitizeArticle({ url, network, timeoutMs: 200 }),
      ).rejects.toThrow("Only public http(s) addresses may be fetched");
    expect(asked).toEqual([]);
  });

  test("follows no AMP, canonical or frame link that leads inside", async () => {
    const { asked, network } = site({
      "https://news.example/post": short(
        '<link rel="amphtml" href="http://169.254.169.254/amp"><link rel="canonical" href="http://metadata.example/post">',
      ),
      "https://news.example/framed": `<html><body><iframe src="http://10.0.0.1/frame"></iframe></body></html>`,
    });
    await extractAndSanitizeArticle({
      url: "https://news.example/post",
      network,
    }).catch(() => undefined);
    await extractAndSanitizeArticle({
      url: "https://news.example/framed",
      network,
    }).catch(() => undefined);
    expect(asked.map(({ url }) => url)).toEqual([
      "https://news.example/post",
      "https://news.example/framed",
    ]);
  });

  test("sends a site's cookies to that site alone", async () => {
    const { asked, network } = site({
      "https://news.example/post": short(
        '<link rel="amphtml" href="https://amp.elsewhere.example/post">',
      ),
      "https://amp.elsewhere.example/post": LONG,
    });
    await extractAndSanitizeArticle({
      url: "https://news.example/post",
      cookiesHeader: "session=1",
      network,
    });
    expect(asked).toEqual([
      { url: "https://news.example/post", cookie: "session=1" },
      { url: "https://amp.elsewhere.example/post", cookie: null },
    ]);
  });
});
