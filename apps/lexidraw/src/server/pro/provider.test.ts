import { expect, mock, test } from "bun:test";
mock.module("server-only", () => ({}));
mock.module("@packages/env", () => ({ default: {} }));
const { createProProviderTransport } = await import("./provider");
test("approved Pro adapter uses the tuned bounded provider request and measured cached/reasoning usage through injected HTTP only", async () => {
  let dispatched = 0;
  const transport = createProProviderTransport({
    resolveServerKey: () => "fake-server-fixture-only",
    fetch: async (url, options) => {
      dispatched++;
      expect(String(url)).toBe("https://api.openai.com/v1/responses");
      expect(new Headers(options?.headers).get("X-Client-Request-Id")).toBe(
        "attempt-fixture",
      );
      const body = JSON.parse(String(options?.body));
      expect(body.model).toBe("gpt-5.4-mini");
      expect(body.max_output_tokens).toBeLessThanOrEqual(512);
      return Response.json({
        id: "response-fixture",
        object: "response",
        created_at: 1000,
        model: "gpt-5.4-mini",
        status: "completed",
        output: [
          {
            id: "message",
            type: "message",
            role: "assistant",
            status: "completed",
            content: [
              {
                type: "output_text",
                text: "hello continuation",
                annotations: [],
              },
            ],
          },
        ],
        usage: {
          input_tokens: 10,
          input_tokens_details: { cached_tokens: 4 },
          output_tokens: 2,
          output_tokens_details: { reasoning_tokens: 1 },
          total_tokens: 12,
        },
      });
    },
  });
  expect(
    await transport("hello", new AbortController().signal, {
      attemptId: "attempt-fixture",
      operationId: "operation-fixture",
    }),
  ).toEqual({
    kind: "completed",
    completion: {
      text: " continuation",
      usage: { input: 10, cachedInput: 4, output: 2 },
      actualCostNanoUsd: 13800,
      providerResponseId: "response-fixture",
    },
  });
  expect(dispatched).toBe(1);
});

test("confirmed provider rejection is a technical failure with no generated result, while network uncertainty is never guessed free", async () => {
  const refused = createProProviderTransport({
    resolveServerKey: () => "fixture-only",
    fetch: async () =>
      Response.json(
        {
          error: {
            message: "Rejected",
            type: "invalid_request_error",
            code: "invalid_api_key",
          },
        },
        { status: 401 },
      ),
  });
  expect(
    await refused("text", new AbortController().signal, {
      attemptId: "attempt-fixture",
      operationId: "operation-fixture",
    }),
  ).toEqual({
    kind: "failed",
    retryable: false,
    actualCostNanoUsd: 0,
  });
  const uncertain = createProProviderTransport({
    resolveServerKey: () => "fixture-only",
    fetch: async () => {
      throw Error("network interrupted");
    },
  });
  expect(
    await uncertain("text", new AbortController().signal, {
      attemptId: "attempt-fixture",
      operationId: "operation-fixture",
    }),
  ).toEqual({
    kind: "unknown",
  });
});
