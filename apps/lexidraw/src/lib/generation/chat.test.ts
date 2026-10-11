import { expect, test } from "bun:test";
import { CHAT_STOP, runChat } from "./chat";

test("chat preserves saved turns, document context and bounded text attachments and emits real partial updates", async () => {
  const input = {
    prompt: "Why?",
    context: "The bridge is closed.",
    messages: [
      { role: "user", content: "Which bridge?" },
      { role: "assistant", content: "The east bridge." },
    ],
    files: [{ name: "note.txt", type: "text/plain", text: "Repairs." }],
  };
  let sent: unknown;
  const updates: string[] = [];
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const running = runChat(
    input,
    {
      async *stream(request) {
        sent = request;
        yield "Because";
        await barrier;
        yield " of repairs.";
      },
    },
    { onText: (text) => updates.push(text) },
  );
  await Bun.sleep(5);
  expect(updates).toEqual(["Because"]);
  expect(sent).toMatchObject({
    messages: [
      { role: "user", content: "Which bridge?" },
      { role: "assistant", content: "The east bridge." },
      {
        role: "user",
        content:
          "Why?\n\nDocument context:\nThe bridge is closed.\n\nAttachment note.txt:\nRepairs.",
      },
    ],
  });
  release();
  expect(await running).toBe("Because of repairs.");
  expect(updates).toEqual(["Because", "Because of repairs."]);
});

test("unsupported turns, media and oversized context stop before any transport and cancellation never retries", async () => {
  let calls = 0;
  const port = {
    async *stream() {
      calls++;
      yield "unused";
    },
  };
  for (const input of [
    {
      prompt: "read",
      files: [{ name: "private.pdf", type: "application/pdf", text: "secret" }],
    },
    { prompt: "read", messages: [{ role: "tool", content: "result" }] },
    { prompt: "read", context: "long".repeat(400) },
    { prompt: "read", tools: { search: true } },
  ])
    await expect(runChat(input, port)).rejects.toThrow(
      "Chat supports bounded text",
    );
  const controller = new AbortController();
  controller.abort(CHAT_STOP);
  await expect(
    runChat({ prompt: "hello" }, port, { signal: controller.signal }),
  ).rejects.toThrow("Chat stopped");
  expect(calls).toBe(0);
});
