import { expect, mock } from "bun:test";

const cases: { name: string; run: () => Promise<void> }[] = [];
let setup: () => Promise<void> = async () => {};
let cleanup: () => void = () => {};
const beforeAll = (run: () => Promise<void>) => {
  setup = run;
};
const afterAll = (run: () => void) => {
  cleanup = run;
};
const test = (name: string, run: () => Promise<void>) => {
  cases.push({ name, run });
};
import * as schema from "@packages/drizzle/drizzle-schema";
import type { NextRequest } from "next/server";
import { installServerRuntime } from "~/test/server-runtime";

const db = await installServerRuntime();
const realAuth = await import("~/server/auth");
let session: {
  user: { id: string; config?: { autocomplete: { enabled: boolean } } };
} | null = null;
mock.module("~/server/auth", () => ({ ...realAuth, auth: () => session }));
const realEnv = await import("@packages/env");
mock.module("@packages/env", () => ({
  ...realEnv,
  default: {
    ...realEnv.default,
    OPENAI_API_KEY: "fake-autocomplete-route-key",
  },
}));
const { POST } = await import("./route");
const originalFetch = globalThis.fetch;
const requests: {
  url: string;
  body: Record<string, unknown>;
  authorization: string | null;
}[] = [];
let fail = false;

beforeAll(async () => {
  await db.insert(schema.users).values({
    id: "autocomplete_tracer",
    name: "Tracer",
    email: "autocomplete-tracer@example.test",
  });
  await db.insert(schema.llmPolicies).values({
    mode: "autocomplete",
    provider: "openai",
    modelId: "gpt-4o",
    temperature: 0.4,
    maxOutputTokens: 100,
    allowedModels: [],
    enforcedCaps: { maxOutputTokensByProvider: { openai: 100, google: 100 } },
  });
  globalThis.fetch = Object.assign(
    async (url: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(url),
        body: JSON.parse(String(init?.body)),
        authorization: new Headers(init?.headers).get("authorization"),
      });
      if (fail)
        return Response.json(
          { error: { message: "Provider unavailable", type: "server_error" } },
          { status: 503 },
        );
      const events = [
        {
          type: "response.created",
          response: { id: "r1", created_at: 1, model: "gpt-4o" },
        },
        {
          type: "response.output_text.delta",
          item_id: "m1",
          output_index: 0,
          content_index: 0,
          delta: "langu",
        },
        {
          type: "response.output_text.delta",
          item_id: "m1",
          output_index: 0,
          content_index: 0,
          delta: "age is useful.",
        },
        {
          type: "response.completed",
          response: {
            id: "r1",
            created_at: 1,
            model: "gpt-4o",
            status: "completed",
            output: [],
            usage: {
              input_tokens: 20,
              output_tokens: 5,
              total_tokens: 25,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens_details: { reasoning_tokens: 0 },
            },
          },
        },
      ];
      return new Response(
        events
          .map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
          .join(""),
        { headers: { "content-type": "text/event-stream" } },
      );
    },
    { preconnect() {} },
  );
});
afterAll(() => {
  globalThis.fetch = originalFetch;
  mock.module("~/server/auth", () => realAuth);
  mock.module("@packages/env", () => realEnv);
});

function ask(body: unknown) {
  // NextRequest adds helpers unused by this standard Web request handler.
  return POST(
    new Request("https://lexidraw.test/api/autocomplete/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }) as NextRequest,
  );
}

test("anonymous, disabled and empty requests never reach the provider", async () => {
  session = null;
  expect((await ask({ before: "A langu" })).status).toBe(401);
  session = {
    user: {
      id: "autocomplete_tracer",
      config: { autocomplete: { enabled: false } },
    },
  };
  expect((await ask({ before: "A langu" })).status).toBe(204);
  session = { user: { id: "autocomplete_tracer" } };
  expect((await ask({ before: " " })).status).toBe(400);
  expect(requests).toHaveLength(0);
});

test("authenticated autocomplete retains its streamed response and bounded provider request", async () => {
  session = { user: { id: "autocomplete_tracer" } };
  const response = await ask({ title: "Notes", before: "A langu", after: "" });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe(
    "text/plain; charset=utf-8",
  );
  expect(await response.text()).toBe("age is useful.");
  expect(requests.at(-1)).toEqual({
    url: "https://api.openai.com/v1/responses",
    authorization: "Bearer fake-autocomplete-route-key",
    body: expect.objectContaining({
      model: "gpt-4o",
      temperature: 0.4,
      max_output_tokens: 64,
    }),
  });
});

test("upstream errors retain the existing empty-stream response without retries", async () => {
  fail = true;
  const count = requests.length;
  const response = await ask({ before: "Hello " });
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("");
  expect(requests.length - count).toBe(1);
});

try {
  await setup();
  for (const scenario of cases) {
    await scenario.run();
    console.log(scenario.name);
  }
} finally {
  cleanup();
}
