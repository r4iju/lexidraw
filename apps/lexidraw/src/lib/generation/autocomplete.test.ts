import { expect, test } from "bun:test";
import { createOpenAI } from "@ai-sdk/openai";
import {
  generateAutocomplete,
  createCredentialReference,
} from "./autocomplete";
import { createSdkTextTransport } from "./sdk-text-transport";

const sse = `${[
  {
    id: "chat-1",
    object: "chat.completion.chunk",
    created: 1,
    model: "gpt-4o",
    choices: [
      {
        index: 0,
        delta: { role: "assistant", content: "lan" },
        finish_reason: null,
      },
    ],
  },
  {
    id: "chat-1",
    object: "chat.completion.chunk",
    created: 1,
    model: "gpt-4o",
    choices: [
      {
        index: 0,
        delta: { content: "guage is useful." },
        finish_reason: null,
      },
    ],
  },
  {
    id: "chat-1",
    object: "chat.completion.chunk",
    created: 1,
    model: "gpt-4o",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
  },
]
  .map((event) => `data: ${JSON.stringify(event)}\n\n`)
  .join("")}data: [DONE]\n\n`;

for (const runtime of ["server", "device"]) {
  test(`${runtime} execution streams the same continuation through the provider boundary without credentials in the job`, async () => {
    const credential = createCredentialReference();
    const job = {
      title: "Notes",
      before: "A langu",
      after: "",
      config: {
        provider: "openai",
        modelId: "gpt-4o",
        temperature: 0.4,
        maxOutputTokens: 500,
      },
      credential,
    };
    const requests: {
      url: string;
      authorization: string | null;
      body: unknown;
    }[] = [];
    const usage: unknown[] = [];
    const transport = createSdkTextTransport((reference, config) => {
      if (reference !== credential)
        throw new Error("Unknown credential reference");
      return createOpenAI({
        apiKey: `fake-${runtime}-provider-secret`,
        fetch: Object.assign(
          async (url: RequestInfo | URL, init?: RequestInit) => {
            requests.push({
              url: String(url),
              authorization: new Headers(init?.headers).get("authorization"),
              body: JSON.parse(String(init?.body)),
            });
            return new Response(sse, {
              headers: { "content-type": "text/event-stream" },
            });
          },
          { preconnect() {} },
        ),
      }).chat(config.modelId);
    });
    const controller = new AbortController();
    const output = generateAutocomplete(job, {
      transport,
      execution: { run: (start) => start(controller.signal) },
      persistence: {
        finish: (value) => {
          usage.push(value);
        },
        error: () => {},
      },
    });
    expect(
      await new Response(output.pipeThrough(new TextEncoderStream())).text(),
    ).toBe("age is useful.");
    expect(requests).toEqual([
      {
        url: "https://api.openai.com/v1/chat/completions",
        authorization: `Bearer fake-${runtime}-provider-secret`,
        body: expect.objectContaining({
          model: "gpt-4o",
          temperature: 0.4,
          max_tokens: 64,
          messages: [
            expect.objectContaining({ role: "system" }),
            {
              role: "user",
              content:
                "Document title: Notes\n\nA langu<cursor/>\n\n<fragment>langu</fragment>",
            },
          ],
          stream: true,
        }),
      },
    ]);
    expect(usage).toEqual([
      { inputTokens: 20, outputTokens: 5, totalTokens: 25 },
    ]);
    expect(JSON.stringify(job)).not.toContain("provider-secret");
  });
}
