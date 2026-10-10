import { describe, expect, test } from "bun:test";
import { createByokSession } from "./session";

const key = "sk-or-v1-distinctive-browser-boundary-secret";
describe("device credential network boundary", () => {
  test("only the fixed provider transport can dispatch a credential", async () => {
    const sent: Request[] = [];
    const session = createByokSession(async (request) => {
      sent.push(new Request(request));
      return Response.json({ choices: [{ message: { content: "Hello" } }] });
    }, "https://lexidraw.test");
    const credential = session.replace("openrouter", key);
    expect(await session.text(credential, "Say hello")).toBe("Hello");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(sent[0]?.headers.get("authorization")).toBe(`Bearer ${key}`);
    expect(sent[0]?.redirect).toBe("error");
    await expect(
      session.fetch("/api/upload", { method: "POST", body: key }),
    ).rejects.toThrow("Credential egress blocked");
    expect(sent).toHaveLength(1);
  });
});

for (const secret of [
  key,
  "sk-ant-distinctive-browser-secret",
  "sk-proj-distinctive-browser-secret",
]) {
  test("blocks known credentials and recoverable representations across egress", async () => {
    let dispatches = 0;
    const session = createByokSession(async () => {
      dispatches++;
      return new Response();
    }, "https://lexidraw.test");
    session.replace("openrouter", secret);
    const representations = [
      secret,
      encodeURIComponent(secret),
      btoa(secret),
      JSON.stringify({ error: secret }),
      [...secret]
        .map((c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)
        .join(""),
      [...secret].map((c) => `%${c.charCodeAt(0).toString(16)}`).join(""),
      btoa(JSON.stringify({ error: secret })),
      [...secret].map((c) => c.charCodeAt(0).toString(16)).join(""),
      [...secret].map((c) => `&#${c.charCodeAt(0)};`).join(""),
    ];
    for (const value of representations) {
      await expect(session.fetch(`/api/log?error=${value}`)).rejects.toThrow(
        "Credential egress blocked",
      );
      await expect(
        session.fetch("https://analytics.test/events", {
          headers: { "x-debug": value },
        }),
      ).rejects.toThrow("Credential egress blocked");
      await expect(
        session.fetch("https://bucket.test/upload", {
          method: "POST",
          body: new Blob([value]),
        }),
      ).rejects.toThrow("Credential egress blocked");
    }
    expect(dispatches).toBe(0);
  });
}

test("replacement and removal invalidate queued use while old echoed output stays guarded", async () => {
  let dispatches = 0;
  let release: (response: Response) => void = () => {};
  const session = createByokSession(() => {
    dispatches++;
    return new Promise((resolve) => {
      release = resolve;
    });
  }, "https://lexidraw.test");
  const old = session.replace("openrouter", key);
  const inFlight = session.text(old, "hello");
  session.replace("openrouter", "sk-or-replacement-secret");
  await expect(session.text(old, "queued")).rejects.toThrow("unavailable");
  session.remove();
  release(Response.json({ choices: [{ message: { content: key } }] }));
  await expect(inFlight).rejects.toThrow("unavailable");
  await expect(
    session.fetch("/api/errors", { method: "POST", body: key }),
  ).rejects.toThrow("Credential egress blocked");
  expect(dispatches).toBe(1);
});

test("provider failures and redirects never expose raw envelopes or fallback", async () => {
  for (const response of [
    new Response(key, { status: 401 }),
    new Response(null, {
      status: 302,
      headers: { location: "https://evil.test" },
    }),
  ]) {
    const requests: Request[] = [];
    const session = createByokSession(async (request) => {
      requests.push(request);
      return response;
    }, "https://lexidraw.test");
    const credential = session.replace("openrouter", key);
    await expect(session.text(credential, "hello")).rejects.toThrow(
      "Direct provider access unavailable",
    );
    expect(requests).toHaveLength(1);
    expect(requests[0]?.redirect).toBe("error");
  }
});

test("runtime provider selection and egress shapes cannot carry arbitrary provider configuration", async () => {
  let calls = 0;
  const session = createByokSession(async () => {
    calls++;
    return new Response();
  }, "https://lexidraw.test");
  // A forged runtime value must not bypass the provider contract.
  expect(() =>
    session.replace("https://evil.test" as "openrouter", key),
  ).toThrow("unavailable");
  session.replace("openrouter", key);
  for (const field of [
    "apiKey",
    "baseURL",
    "providerOptions",
    "rawResponse",
    "providerConfig",
  ]) {
    await expect(
      session.fetch("/api/preferences", {
        method: "POST",
        body: JSON.stringify({ [field]: "unsafe SDK data" }),
      }),
    ).rejects.toThrow("Credential egress blocked");
  }
  expect(calls).toBe(0);
});

test("device autocomplete uses shared generation without an app operation or credit debit", async () => {
  const requests: Request[] = [];
  const session = createByokSession(async (request) => {
    requests.push(request);
    return Response.json({
      choices: [{ message: { content: " world" } }],
      usage: { prompt_tokens: 12, completion_tokens: 2, total_tokens: 14 },
    });
  }, "https://lexidraw.test");
  const reference = session.replace("openrouter", key);
  expect(await session.autocomplete(reference, "Hello ")).toBe(" world");
  expect(requests).toHaveLength(1);
  const body = await requests[0]?.json();
  expect(body.messages[0].role).toBe("system");
  expect(body.messages[1].content).toContain("Hello <cursor/>");
  expect(body.max_tokens).toBe(64);
});

test("non-secret artifact uploads remain usable in a protected session", async () => {
  let dispatched = 0;
  const session = createByokSession(async () => {
    dispatched++;
    return new Response();
  }, "https://lexidraw.test");
  session.replace("openrouter", key);
  const metadata = Array.from({ length: 400 }, (_, index) =>
    btoa(
      `Completed audio part ${index}, safe non-secret artifact metadata with a stable revision.`,
    ),
  );
  await session.fetch("https://bucket.test/upload", {
    method: "POST",
    body: JSON.stringify({ parts: metadata }),
  });
  expect(dispatched).toBe(1);
});
