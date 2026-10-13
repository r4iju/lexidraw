import { expect, test } from "bun:test";
import { createByokSession } from "~/lib/byok/session";
import {
  createSuggestionSource,
  suggestionRecovery,
  type ProResult,
} from "./stream-suggestion";
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
    recover: async () => {
      throw Error("Unexpected recovery");
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
  let reply: ((result: ProResult) => void) | undefined;
  const source = createSuggestionSource({ mode: "pro" }, session, {
    start: async () =>
      new Promise((resolve) => {
        reply = resolve;
      }),
    recover: async () => {
      throw Error("Unexpected recovery");
    },
    read: async () => {
      throw Error("Cancelled work must not poll");
    },
    cancel: async (id) => {
      cancelled.push(id);
      return { id, state: "cancelled", result: null };
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
      recover: async () => {
        throw Error("Unexpected recovery");
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
      recover: async () => {
        throw Error("Unexpected recovery");
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

test("lost autocomplete reply recovers original input/key across source recreation and cancellation without a replacement start", async () => {
  const session = createByokSession(async () => {
    throw Error("No provider network");
  }, "https://app.test");
  let starts = 0;
  const submitted: unknown[] = [];
  const cancelled: string[] = [];
  let found = false;
  const pro = {
    start: async (request: unknown) => {
      starts++;
      submitted.push(request);
      throw Error("lost reply");
    },
    recover: async (request: unknown) => {
      submitted.push(request);
      if (!found) throw Error("Operation not found yet");
      return { id: "original", state: "reserved" as const, result: null };
    },
    read: async () => ({
      id: "original",
      state: "reserved" as const,
      result: null,
    }),
    cancel: async (id: string) => {
      cancelled.push(id);
      return { id, state: "cancelled" as const, result: null };
    },
  };
  const source = createSuggestionSource({ mode: "pro" }, session, pro);
  await expect(
    source({ ...input, entityId: "doc" }, new AbortController().signal),
  ).rejects.toThrow();
  found = true;
  // The sign-in/session scope survives the editor's effect being torn down for a source change.
  const switched = createSuggestionSource({ mode: "local" }, session, pro);
  await expect(
    switched({ ...input, entityId: "other-doc" }, new AbortController().signal),
  ).rejects.toThrow();
  expect(starts).toBe(1);
  expect(new Set(submitted.map((value) => JSON.stringify(value))).size).toBe(1);
  expect(cancelled).toEqual(["original"]);
});

test("only an exact typed autocomplete nonacceptance allows the next deliberate request", async () => {
  const session = createByokSession(async () => {
    throw Error("No provider network");
  }, "https://app.test");
  const keys: string[] = [];
  let reads = 0;
  const source = createSuggestionSource({ mode: "pro" }, session, {
    start: async (request) => {
      keys.push(request.idempotencyKey);
      if (keys.length === 1)
        throw {
          data: {
            proNonAcceptance: {
              kind: "not_accepted",
              feature: "autocomplete",
              idempotencyKey: request.idempotencyKey,
              reason: "request_limit",
            },
          },
        };
      return { id: "next", state: "settled", result: " next" };
    },
    recover: async () => {
      reads++;
      throw Error("Not found");
    },
    read: async () => {
      throw Error("No read");
    },
    cancel: async () => {
      throw Error("No cancel");
    },
  });
  await expect(source(input, new AbortController().signal)).rejects.toThrow();
  expect(await source(input, new AbortController().signal)).toBe(" next");
  expect(reads).toBe(0);
  expect(new Set(keys).size).toBe(2);
});

test("device BYOK stays usable while paid acceptance remains unknown without clearing its original identity", async () => {
  const providerRequests: Request[] = [];
  const session = createByokSession(async (request) => {
    providerRequests.push(request);
    return Response.json({
      choices: [{ message: { content: "Hello device." } }],
    });
  }, "https://app.test");
  session.replace("openrouter", "sk-or-v1-synthetic-recovery-device-only");
  let starts = 0;
  let reads = 0;
  let rejectStart: ((error: Error) => void) | undefined;
  const pro = {
    start: async () => {
      starts++;
      return await new Promise<ProResult>((_, reject) => {
        rejectStart = reject;
      });
    },
    recover: async () => {
      reads++;
      throw Error("Not found yet");
    },
    read: async () => {
      throw Error("No owned ID yet");
    },
    cancel: async () => {
      throw Error("No owned ID yet");
    },
  };
  const pending = createSuggestionSource(
    { mode: "pro" },
    session,
    pro,
  )(input, new AbortController().signal);
  const original = suggestionRecovery(session, pro).pending?.input;
  const device = createSuggestionSource(
    { mode: "byok", provider: "openrouter" },
    session,
    pro,
  );
  try {
    expect(await device(input, new AbortController().signal)).toBe(" device.");
    expect(providerRequests).toHaveLength(1);
    expect(providerRequests[0]?.url).toBe(
      "https://openrouter.ai/api/v1/chat/completions",
    );
    expect(reads).toBe(0);
  } finally {
    rejectStart?.(Error("lost paid acceptance"));
    await expect(pending).rejects.toThrow("Not found yet");
  }
  expect(suggestionRecovery(session, pro).pending?.input).toEqual(original);
  expect(starts).toBe(1);
});
