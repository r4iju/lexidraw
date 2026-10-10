import { expect, test } from "bun:test";
import { createByokSession } from "~/lib/byok/session";
import { createSuggestionSource } from "./stream-suggestion";
const input = { title: "", before: "Hello", after: "" };
test("selected BYOK hits only approved provider with session key, local browser hits no network, and app egress rejects keys", async () => {
  const requests: Request[] = [];
  const session = createByokSession(async (request) => {
    requests.push(request);
    if (request.url !== "https://openrouter.ai/api/v1/chat/completions")
      throw new Error("Unexpected network");
    return Response.json({
      choices: [{ message: { content: "Hello world." } }],
    });
  }, "http://localhost");
  session.replace("openrouter", "sk-or-v1-283-only-injected-network");
  const pro = {
    start: async () => {
      throw new Error("Unexpected Pro debit");
    },
    read: async () => {
      throw new Error("Unexpected Pro read");
    },
    cancel: async () => {
      throw new Error("Unexpected Pro cancel");
    },
  };
  const source = createSuggestionSource(
    { mode: "byok", provider: "openrouter" },
    session,
    pro,
  );
  expect(await source(input, new AbortController().signal)).toBe(" world.");
  expect(requests).toHaveLength(1);
  expect(requests[0]?.headers.get("authorization")).toBe(
    "Bearer sk-or-v1-283-only-injected-network",
  );
  expect(requests[0]?.redirect).toBe("error");
  await expect(
    session.fetch("/api/trpc/pro.autocomplete", {
      method: "POST",
      body: JSON.stringify({ before: "sk-or-v1-283-only-injected-network" }),
    }),
  ).rejects.toThrow("Credential egress blocked");
  const local = createSuggestionSource({ mode: "local" }, session, pro);
  await expect(local(input, new AbortController().signal)).rejects.toThrow(
    "unavailable",
  );
  expect(requests).toHaveLength(1);
});

test("cancellation during Pro submission waits for durable identity and cancels it before displaying anything", async () => {
  const session = createByokSession(async () => {
    throw Error("Unexpected network");
  }, "http://localhost");
  const cancelled: string[] = [];
  let reply:
    | ((result: { id: string; state: string; result: string | null }) => void)
    | undefined;
  const source = createSuggestionSource({ mode: "pro" }, session, {
    start: async () =>
      new Promise((resolve) => {
        reply = resolve;
      }),
    read: async () => {
      throw Error("Cancelled work must not poll");
    },
    cancel: async (id) => {
      cancelled.push(id);
    },
  });
  const controller = new AbortController();
  const result = source(input, controller.signal);
  controller.abort();
  expect(cancelled).toEqual([]);
  reply?.({ id: "durable-suggestion", state: "reserved", result: null });
  await expect(result).rejects.toThrow("stopped");
  expect(cancelled).toEqual(["durable-suggestion"]);
});

test("Pro unknown completion shows reconciliation without repeating paid work", async () => {
  const session = createByokSession(async () => {
    throw Error("Unexpected network");
  }, "http://localhost");
  let starts = 0;
  const states: string[] = [];
  const source = createSuggestionSource(
    { mode: "pro" },
    session,
    {
      start: async () => {
        starts++;
        return { id: "unknown", state: "unknown", result: null };
      },
      read: async () => {
        throw Error("Unexpected retry");
      },
      cancel: async () => {
        throw Error("Unknown cannot be refunded by cancellation");
      },
    },
    (state) => states.push(state),
  );
  await expect(source(input, new AbortController().signal)).rejects.toThrow(
    "reconciling",
  );
  expect(starts).toBe(1);
  expect(states).toEqual(["unknown"]);
});

test("long multilingual paragraphs retain bounded cursor context with linear encoding work", async () => {
  const Original = globalThis.TextEncoder;
  let encoded = 0;
  globalThis.TextEncoder = class extends Original {
    encode(text = "") {
      encoded += text.length;
      return super.encode(text);
    }
  };
  try {
    const session = createByokSession(async () => {
      throw Error("No network");
    }, "http://localhost");
    let context: unknown;
    const source = createSuggestionSource({ mode: "pro" }, session, {
      start: async (request) => {
        context = request;
        return { id: "done", state: "settled", result: "next" };
      },
      read: async () => {
        throw Error("No poll");
      },
      cancel: async () => {
        throw Error("No cancel");
      },
    });
    expect(
      await source(
        {
          title: "😀".repeat(100),
          before: "古".repeat(10000) + "😀".repeat(225),
          after: "😀".repeat(1000),
        },
        new AbortController().signal,
      ),
    ).toBe("next");
    expect(context).toMatchObject({
      title: "😀".repeat(25),
      before: "😀".repeat(225),
      after: "😀".repeat(37),
    });
    expect(encoded).toBeLessThan(100000);
  } finally {
    globalThis.TextEncoder = Original;
  }
});
