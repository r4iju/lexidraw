import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { MockAgent } from "undici";
import { directHop, fetchPublic, proxyHop } from "./public-fetch.ts";

// Bun replaces Undici with its own transport. Run this file with node --test
// to exercise the transport used by production functions.
test("a proxy refuses Brotli before Fetch can decode the origin body", {
  skip: Boolean(process.versions.bun),
}, async () => {
  const dispatcher = new MockAgent();
  dispatcher.disableNetConnect();
  dispatcher
    .get("https://news.example")
    .intercept({ path: "/post" })
    .reply(200, brotliCompressSync("an ordinary article"), {
      headers: { "content-encoding": "br" },
    });
  try {
    const read = async () => {
      const response = await fetchPublic(
        "https://news.example/post",
        {},
        {
          resolve: async () => [{ address: "93.184.215.14", family: 4 }],
          hop: proxyHop(dispatcher),
        },
      );
      return response.text();
    };
    await assert.rejects(read, /Unsupported response content encoding/);
  } finally {
    await dispatcher.close();
  }
});

test("a direct hop negotiates supported encodings and still reads gzip", {
  skip: Boolean(process.versions.bun),
}, async () => {
  let advertised;
  const server = createServer((request, response) => {
    advertised = request.headers["accept-encoding"];
    response.writeHead(200, { "content-encoding": "gzip" });
    response.end(gzipSync("an ordinary article"));
  }).listen(0, "127.0.0.1");
  await new Promise((listening) => server.once("listening", listening));
  const { port } = server.address();
  try {
    const response = await directHop(
      new URL(`http://pinned.example:${port}/`),
      { address: "127.0.0.1", family: 4 },
      { headers: new Headers({ "accept-encoding": "gzip, deflate, br" }) },
    );
    assert.equal(await response.text(), "an ordinary article");
    assert.equal(advertised, "gzip, deflate");
  } finally {
    server.close();
  }
});

test("a proxy negotiates supported encodings and still reads gzip", {
  skip: Boolean(process.versions.bun),
}, async () => {
  const dispatcher = new MockAgent();
  dispatcher.disableNetConnect();
  dispatcher
    .get("https://news.example")
    .intercept({
      path: "/post",
      headers: { "accept-encoding": "gzip, deflate" },
    })
    .reply(200, gzipSync("an ordinary article"), {
      headers: { "content-encoding": "gzip" },
    });
  try {
    const response = await fetchPublic(
      "https://news.example/post",
      {
        headers: { "accept-encoding": "gzip, deflate, br" },
      },
      {
        resolve: async () => [{ address: "93.184.215.14", family: 4 }],
        hop: proxyHop(dispatcher),
      },
    );
    assert.equal(await response.text(), "an ordinary article");
  } finally {
    await dispatcher.close();
  }
});

test("discarding a compressed response closes the upstream connection", {
  skip: Boolean(process.versions.bun),
}, async () => {
  let closed = false;
  const server = createServer((_request, response) => {
    response.once("close", () => {
      closed = true;
    });
    response.writeHead(200, { "content-encoding": "gzip" });
    response.write(gzipSync("an ordinary article"));
  }).listen(0, "127.0.0.1");
  await new Promise((listening) => server.once("listening", listening));
  const { port } = server.address();
  try {
    const response = await directHop(
      new URL(`http://pinned.example:${port}/`),
      { address: "127.0.0.1", family: 4 },
      { headers: new Headers() },
    );
    const reader = response.body.getReader();
    assert.equal(
      new TextDecoder().decode((await reader.read()).value),
      "an ordinary article",
    );
    assert.equal(
      await Promise.race([
        reader.cancel().then(() => true),
        delay(100).then(() => false),
      ]),
      true,
      "cancellation must finish even while the origin is still sending",
    );
    await delay(20);
    assert.equal(closed, true);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
