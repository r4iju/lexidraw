import { expect, test } from "bun:test";
import { createByokSession } from "./session";
import { runChat } from "../generation/chat";

const key = "sk-or-v1-distinctive-chat-fixture-key-123456";
const encode = (content: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
test("direct chat sends saved conversation only to the fixed provider and streams before completion", async () => {
  let request: Request | undefined;
  let finish!: () => void;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const session = createByokSession(
    async (value) => {
      request = value;
      return new Response(
        new ReadableStream({
          async start(c) {
            c.enqueue(new TextEncoder().encode(encode("Repairs ")));
            await done;
            c.enqueue(
              new TextEncoder().encode(
                encode("closed it.") + "data: [DONE]\n\n",
              ),
            );
            c.close();
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    },
    "https://app.test",
    { chatFixture: true },
  );
  const reference = session.replace("openrouter", key);
  const updates: string[] = [];
  const running = runChat(
    {
      prompt: "Why?",
      messages: [{ role: "assistant", content: "It is closed." }],
    },
    session.chat(reference),
    { assertSafe: session.assertSafe, onText: (text) => updates.push(text) },
  );
  await Bun.sleep(10);
  expect(updates).toEqual(["Repairs "]);
  expect(request?.url).toBe("https://openrouter.ai/api/v1/chat/completions");
  expect(request?.redirect).toBe("error");
  expect(request?.headers.get("Authorization")).toBe(`Bearer ${key}`);
  expect(await request?.clone().json()).toMatchObject({
    stream: true,
    model: "openai/gpt-4.1-mini",
    messages: [
      { role: "system" },
      { role: "assistant", content: "It is closed." },
      { role: "user", content: "Why?" },
    ],
  });
  finish();
  expect(await running).toBe("Repairs closed it.");
});

test("provider SSE accepts CRLF framing and blocks split credential echoes before callbacks or app egress", async () => {
  const updates: string[] = [];
  let calls = 0;
  const session = createByokSession(
    async () => {
      calls++;
      return new Response(
        encode("A safe answer ").replaceAll("\n", "\r\n") +
          "data: [DONE]\r\n\r\n",
        { headers: { "Content-Type": "text/event-stream" } },
      );
    },
    "https://app.test",
    { chatFixture: true },
  );
  const reference = session.replace("openrouter", key);
  expect(
    await runChat({ prompt: "Hi" }, session.chat(reference), {
      onText: (text) => updates.push(text),
    }),
  ).toBe("A safe answer ");
  expect(updates).toEqual(["A safe answer "]);
  const echoed: string[] = [];
  const unsafe = createByokSession(
    async () =>
      new Response(
        encode(key.slice(0, 15)) + encode(key.slice(15)) + "data: [DONE]\n\n",
        { headers: { "Content-Type": "text/event-stream" } },
      ),
    "https://app.test",
    { chatFixture: true },
  );
  const ref = unsafe.replace("openrouter", key);
  await expect(
    runChat({ prompt: "Hi" }, unsafe.chat(ref), {
      onText: (text) => echoed.push(text),
    }),
  ).rejects.toThrow("uncertain");
  expect(echoed).toEqual([]);
  await expect(
    unsafe.fetch("https://app.test/api/document", {
      method: "POST",
      body: JSON.stringify({ text: encodeURIComponent(key) }),
    }),
  ).rejects.toThrow("Credential egress blocked");
  expect(calls).toBe(1);
});
