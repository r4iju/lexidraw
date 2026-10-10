import { expect, mock, test } from "bun:test";
mock.module("server-only", () => ({}));
import { prepareChat } from "~/lib/generation/chat";
import { PRICEBOOK } from "./contracts";
const { createProChatTransport } = await import("./chat-provider");
test("Pro provider emits actual response deltas and records measured usage without exposing SDK envelopes", async () => {
  const updates: string[] = [];
  let calls = 0;
  const transport = createProChatTransport({
    authorize: async () => {},
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
        feature: "chat",
        book: PRICEBOOK,
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
