import { mock } from "bun:test";

/**
 * The blob store and the voice services as a read-aloud run reaches them:
 * asking whether a chunk exists finds it made before when `madeBefore` says
 * so, and a request for speech, through `fetch`, is recorded as paid for.
 * Anything else goes out as it would. Call it before importing what it runs.
 */
export function fakeAudioStore({
  madeBefore,
}: {
  madeBefore: (pathname: string) => boolean;
}) {
  const realFetch = globalThis.fetch;
  const store = {
    /** The chunks asked after, in order. */
    chunksAsked: [] as string[],
    /** Each request for speech. */
    paidFor: [] as string[],
    /** Runs as each chunk is asked after, before the answer. */
    beforeChunk: async () => {},
    /** Whether a chunk was made before; replaceable per test. */
    madeBefore,
    /** The voice service's answer to a request for speech. */
    speech: () => new Response(new Uint8Array([1, 2, 3])),
    restore: () => {
      globalThis.fetch = realFetch;
    },
  };
  const asked = async (pathname: string) => {
    if (!pathname.startsWith("tts/chunks/")) return false;
    await store.beforeChunk();
    store.chunksAsked.push(pathname);
    return store.madeBefore(pathname);
  };
  mock.module("~/server/tts/blob-exists", () => ({
    blobExists: (url: string) => asked(new URL(url).pathname.slice(1)),
  }));
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://relative.test");
    if (url.pathname.endsWith("/audio/speech")) {
      store.paidFor.push(String(init?.body ?? ""));
      return store.speech();
    }
    return realFetch(input, init);
  }) as typeof fetch;
  return store;
}
