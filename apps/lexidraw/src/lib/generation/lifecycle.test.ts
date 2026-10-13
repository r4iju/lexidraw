import { expect, test } from "bun:test";
import { createOpenAI } from "@ai-sdk/openai";
import {
  createCredentialReference,
  generateAutocomplete,
} from "./autocomplete";
import { createSdkTextTransport } from "./sdk-text-transport";

const job = {
  title: "",
  before: "Hello ",
  after: "",
  credential: createCredentialReference(),
  config: {
    provider: "openai",
    modelId: "gpt-4o",
    temperature: 0,
    maxOutputTokens: 20,
  },
};

test("provider failure is reported once without a retry or a successful result", async () => {
  const errors: unknown[] = [];
  let requests = 0;
  const stream = generateAutocomplete(job, {
    transport: createSdkTextTransport(() =>
      createOpenAI({
        apiKey: "fake-key",
        fetch: Object.assign(
          async () => {
            requests++;
            return Response.json(
              {
                error: {
                  message: "Provider unavailable",
                  type: "server_error",
                },
              },
              { status: 503 },
            );
          },
          { preconnect() {} },
        ),
      }).chat("gpt-4o"),
    ),
    execution: { run: (start) => start(new AbortController().signal) },
    persistence: {
      finish: () => {
        throw new Error("Unexpected success");
      },
      error: (error) => {
        errors.push(error);
      },
    },
  });
  expect(
    await new Response(stream.pipeThrough(new TextEncoderStream())).text(),
  ).toBe("");
  expect(errors).toHaveLength(1);
  expect(String(errors[0])).toContain("Provider unavailable");
  expect(requests).toBe(1);
});

test("runtime cancellation aborts the actual provider request and emits no continuation", async () => {
  const controller = new AbortController();
  let observedAbort = false;
  const transport = createSdkTextTransport(() =>
    createOpenAI({
      apiKey: "fake-key",
      fetch: Object.assign(
        async (_url: RequestInfo | URL, init?: RequestInit) => {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              observedAbort = true;
              reject(new DOMException("Cancelled", "AbortError"));
            });
            controller.abort();
          });
        },
        { preconnect() {} },
      ),
    }).chat("gpt-4o"),
  );
  const stream = generateAutocomplete(job, {
    transport,
    execution: { run: (start) => start(controller.signal) },
    persistence: { finish: () => {}, error: () => {} },
  });
  expect(
    await new Response(stream.pipeThrough(new TextEncoderStream())).text(),
  ).toBe("");
  expect(observedAbort).toBe(true);
});
