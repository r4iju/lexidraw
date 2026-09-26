/**
 * The blob store and the voice services as a read-aloud run reaches them,
 * through `fetch`: a HEAD of a chunk finds it made before when `madeBefore`
 * says so, and a request for speech is recorded as paid for. Anything else
 * goes out as it would.
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
    restore: () => {
      globalThis.fetch = realFetch;
    },
  };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://relative.test");
    if (init?.method === "HEAD") {
      const pathname = url.pathname.slice(1);
      if (!pathname.startsWith("tts/chunks/"))
        return new Response(null, { status: 404 });
      await store.beforeChunk();
      store.chunksAsked.push(pathname);
      return new Response(null, { status: madeBefore(pathname) ? 200 : 404 });
    }
    if (url.pathname.endsWith("/audio/speech")) {
      store.paidFor.push(String(init?.body ?? ""));
      return new Response(new Uint8Array([1, 2, 3]));
    }
    return realFetch(input, init);
  }) as typeof fetch;
  return store;
}
