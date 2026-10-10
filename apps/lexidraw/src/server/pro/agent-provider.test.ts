import { test, expect, mock } from "bun:test";
mock.module("server-only", () => ({}));
const { createAgentProvider } = await import("./agent-provider");
test("approved paid search uses bound server scope and injected exact endpoint; forged operation ID cannot resolve keys", async () => {
  let keys = 0,
    calls = 0;
  const adapter = createAgentProvider({
    authorize: async (scope) => {
      if (scope.attemptId !== "fenced" || scope.accountId !== "alice")
        throw new Error("No parent authorization");
    },
    resolveKey: () => {
      keys++;
      return "fixture-not-a-live-key";
    },
    resolveSearchEngine: () => "fixture-engine",
    fetch: Object.assign(
      async (url: RequestInfo | URL, options?: RequestInit) => {
        calls++;
        expect(
          String(url).startsWith("https://www.googleapis.com/customsearch/v1?"),
        ).toBe(true);
        expect(options?.redirect).toBe("error");
        expect(new URL(String(url)).searchParams.get("num")).toBe("5");
        return new Response(
          JSON.stringify({
            items: [
              {
                title: "Trees",
                link: "https://example.test",
                snippet: "Trees grow",
              },
            ],
          }),
        );
      },
      { preconnect: () => {} },
    ),
  });
  const request = {
    phase: "search" as const,
    prompt: "trees",
    context: "doc",
    query: "trees",
  };
  await expect(
    adapter(request, new AbortController().signal, {
      accountId: "alice",
      operationId: "supplied",
      attemptId: "forged",
    }),
  ).rejects.toThrow("authorization");
  expect(keys).toBe(0);
  expect(calls).toBe(0);
  const output = await adapter(request, new AbortController().signal, {
    accountId: "alice",
    operationId: "parent",
    attemptId: "fenced",
  });
  expect(output).toMatchObject({
    kind: "completed",
    completion: {
      phase: "search",
      estimatedCostNanoUsd: 5_000_000,
      output: {
        results: [
          {
            title: "Trees",
            url: "https://example.test",
            snippet: "Trees grow",
          },
        ],
      },
    },
  });
  expect(calls).toBe(1);
});

test("search list pricing is an estimate, never fabricated actual invoice usage", async () => {
  const adapter = createAgentProvider({
    authorize: async () => {},
    resolveKey: () => "fixture-only",
    resolveSearchEngine: () => "fixture",
    fetch: Object.assign(async () => Response.json({ items: [] }), {
      preconnect: () => {},
    }),
  });
  const result = await adapter(
    { phase: "search", prompt: "trees", context: "document", query: "trees" },
    new AbortController().signal,
    { accountId: "alice", operationId: "one", attemptId: "fenced" },
  );
  expect(result.kind).toBe("completed");
  if (result.kind === "completed") {
    expect(result.completion.actualCostNanoUsd).toBeUndefined();
    expect(result.completion.estimatedCostNanoUsd).toBe(5000000);
  }
});

test("supplier rejection does not fabricate an actual zero invoice cost", async () => {
  const adapter = createAgentProvider({
    authorize: async () => {},
    resolveKey: () => "fixture-only",
    resolveSearchEngine: () => "fixture",
    fetch: Object.assign(
      async () => new Response("rate limited", { status: 429 }),
      { preconnect: () => {} },
    ),
  });
  expect(
    await adapter(
      { phase: "search", prompt: "trees", context: "document", query: "trees" },
      new AbortController().signal,
      { accountId: "alice", operationId: "one", attemptId: "fenced" },
    ),
  ).toEqual({ kind: "failed" });
});

test("eligibility is checked again at actual SDK dispatch after credential resolution", async () => {
  let eligible = true,
    calls = 0;
  const provider = createAgentProvider({
    authorize: async () => {
      if (!eligible) throw Error("Revoked");
    },
    resolveKey: () => {
      eligible = false;
      return "fixture-only";
    },
    resolveSearchEngine: () => "fixture",
    fetch: Object.assign(
      async () => {
        calls++;
        return new Response("{}");
      },
      { preconnect() {} },
    ),
  });
  expect(
    await provider(
      { phase: "plan", prompt: "write", context: "doc" },
      new AbortController().signal,
      { accountId: "alice", operationId: "parent", attemptId: "fenced" },
    ),
  ).toEqual({ kind: "unknown" });
  expect(calls).toBe(0);
});
