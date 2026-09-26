/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { Resolve } from "@packages/lib/public-address";
import type { Hop } from "~/server/net/public-fetch";
import { probeImageSize } from "./image-probe";

// A 37×23 PNG's signature and header chunk: all a probe needs of it.
const PNG_HEAD = Uint8Array.from(
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAACUAAAAXEAI=", "base64"),
);

const PUBLIC: Resolve = async () => [{ address: "93.184.215.14", family: 4 }];

type Served = {
  status?: number;
  body?: AsyncIterable<Uint8Array>;
  close?: () => void;
};

/** A network answering from `routes`. */
function network(routes: Record<string, () => Served>): Hop {
  return async (url) => {
    const route = routes[url.href];
    if (!route) throw new Error(`nothing at ${url.href}`);
    const { status = 200, body, close } = route();
    const chunks = (body ?? (async function* () {})())[Symbol.asyncIterator]();
    return new Response(
      new ReadableStream<Uint8Array>({
        async pull(stream) {
          const { done, value } = await chunks.next();
          if (done) stream.close();
          else stream.enqueue(value);
        },
        cancel: () => close?.(),
      }),
      { status },
    );
  };
}

describe("a picture's size, probed on the network", () => {
  test("reads a public picture's size, and stops once it has it", async () => {
    let pulled = 0;
    let closed = false;
    const size = await probeImageSize("https://images.example/a.png", {
      resolve: PUBLIC,
      hop: network({
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

  test("gives up past its byte cap, its time, or on an error status", async () => {
    let pulled = 0;
    const endless = await probeImageSize("https://images.example/noise", {
      resolve: PUBLIC,
      maxBytes: 4096,
      hop: network({
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
      hop: () => new Promise(() => {}),
    });
    expect(stalled).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(1000);

    let lookup: AbortSignal | undefined;
    const unanswered = await probeImageSize("https://images.example/dns.png", {
      resolve: (_host, signal) => {
        lookup = signal;
        return new Promise(() => {});
      },
      timeoutMs: 50,
      hop: network({}),
    });
    expect(unanswered).toBeUndefined();
    expect(lookup?.aborted).toBe(true);

    const missing = await probeImageSize("https://images.example/gone.png", {
      resolve: PUBLIC,
      hop: network({
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
