import { makeSupplierContract } from "./supplier-contract";
import { expect, mock, test } from "bun:test";
mock.module("server-only", () => ({}));
import { prepareChat } from "~/lib/generation/chat";
import { PRICEBOOK } from "./contracts";
const { createProChatTransport } = await import("./chat-provider");
test("Pro provider emits actual response deltas and records measured usage without exposing SDK envelopes", async () => {
  const updates: string[] = [];
  let calls = 0;
  const transport = createProChatTransport({
    authorize: async (scope) =>
      makeSupplierContract(
        scope.feature === "autocomplete" ? "autocomplete" : "chat",
        PRICEBOOK,
        "test-injection",
      ),
    resolveServerKey: () => "fake-system-key",
    fetch: async (request) => {
      calls++;
      expect(request.url).toBe("https://api.openai.com/v1/responses");
      expect(request.redirect).toBe("error");
      const body = await request.json();
      expect(body.input).toEqual([{ role: "user", content: "Hello" }]);
      expect(body.stream).toBe(true);
      const events = [
        { type: "response.output_text.delta", delta: "Hi " },
        { type: "response.output_text.delta", delta: "there." },
        {
          type: "response.completed",
          response: {
            id: "fixture",
            status: "completed",
            usage: {
              input_tokens: 100,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens: 4,
            },
          },
        },
      ];
      return new Response(
        events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    },
  });
  expect(
    await transport(
      JSON.stringify(prepareChat({ prompt: "Hello" })),
      new AbortController().signal,
      {
        accountId: "alice",
        operationId: "op",
        attemptId: "attempt",
        supplier: makeSupplierContract("chat", PRICEBOOK, "test-injection"),
        feature: "chat",
        onText: (text) => updates.push(text),
      },
    ),
  ).toMatchObject({
    kind: "completed",
    completion: {
      text: "Hi there.",
      usage: { input: 100, cachedInput: 0, output: 4 },
      actualCostNanoUsd: 93000,
    },
  });
  expect(updates).toEqual(["Hi ", "Hi there."]);
  expect(calls).toBe(1);
});
test("validated failed and incomplete terminals stop retries, while malformed identity or usage and bare disconnect stay uncertain", async () => {
  const cases: {
    events: unknown[];
    expected: import("./operation").ProviderOutcome;
  }[] = [
    {
      events: [
        {
          type: "response.failed",
          response: {
            id: "failed",
            status: "failed",
            usage: {
              input_tokens: 100,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens: 4,
            },
          },
        },
      ],
      expected: { kind: "failed", retryable: false, actualCostNanoUsd: 93000 },
    },
    {
      events: [
        {
          type: "response.incomplete",
          response: { id: "incomplete", status: "incomplete", usage: null },
        },
      ],
      expected: { kind: "failed", retryable: false },
    },
    {
      events: [
        {
          type: "response.created",
          response: { id: "error-response", status: "in_progress" },
        },
        {
          type: "error",
          code: "server_error",
          message: "Private SDK detail",
          param: null,
          sequence_number: 1,
        },
      ],
      expected: { kind: "failed", retryable: false },
    },
    {
      events: [
        {
          type: "error",
          code: "server_error",
          message: "Private SDK detail",
          param: null,
          sequence_number: 0,
        },
      ],
      expected: { kind: "failed", retryable: false },
    },
    {
      events: [
        {
          type: "response.failed",
          response: { id: "", status: "failed", usage: null },
        },
      ],
      expected: { kind: "unknown" },
    },
    {
      events: [
        {
          type: "response.failed",
          response: { id: "bad", status: "completed", usage: null },
        },
      ],
      expected: { kind: "unknown" },
    },
    {
      events: [
        {
          type: "response.failed",
          response: {
            id: "bad",
            status: "failed",
            usage: {
              input_tokens: 1,
              input_tokens_details: { cached_tokens: 2 },
              output_tokens: 4,
            },
          },
        },
      ],
      expected: { kind: "unknown" },
    },
    {
      events: [
        {
          type: "response.created",
          response: { id: "one", status: "in_progress" },
        },
        {
          type: "response.failed",
          response: { id: "two", status: "failed", usage: null },
        },
      ],
      expected: { kind: "unknown" },
    },
    {
      events: [{ type: "response.output_text.delta", delta: "Partial " }],
      expected: { kind: "unknown" },
    },
  ];
  for (const item of cases) {
    const transport = createProChatTransport({
      authorize: async (scope) =>
        makeSupplierContract(
          scope.feature === "autocomplete" ? "autocomplete" : "chat",
          PRICEBOOK,
          "test-injection",
        ),
      resolveServerKey: () => "fake-system-key",
      fetch: async () =>
        new Response(
          item.events
            .map((event) => `data: ${JSON.stringify(event)}\n\n`)
            .join(""),
          { headers: { "Content-Type": "text/event-stream" } },
        ),
    });
    const outcome = await transport(
      JSON.stringify(prepareChat({ prompt: "Hello" })),
      new AbortController().signal,
      {
        accountId: "alice",
        operationId: "op",
        attemptId: "attempt",
        supplier: makeSupplierContract("chat", PRICEBOOK, "test-injection"),
      },
    );
    expect(outcome).toEqual(item.expected);
    expect(JSON.stringify(outcome)).not.toContain("Private SDK detail");
  }
});
