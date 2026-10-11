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

test("D2 follow-up sends a complete 2000-byte prior reply and full permitted attachment separately", async () => {
  for (const input of [
    {
      prompt: "Why?",
      messages: [
        { role: "user", content: "Explain" },
        { role: "assistant", content: "a".repeat(2000) },
      ],
    },
    {
      prompt: "Read",
      files: [{ name: "note.txt", type: "text/plain", text: "b".repeat(1500) }],
    },
  ]) {
    const sent: import("./chat").ChatRequest[] = [];
    const updates: string[] = [];
    expect(
      await runChat(
        input,
        {
          async *stream(request) {
            sent.push(request);
            yield "Yes ";
            yield "indeed.";
          },
        },
        { onText: (text) => updates.push(text) },
      ),
    ).toBe("Yes indeed.");
    expect(sent[0]?.maxOutputTokens).toBe(512);
    if ("messages" in input)
      expect(sent[0]?.messages[1]?.content).toBe("a".repeat(2000));
    else
      expect(sent[0]?.messages[0]?.content).toBe(
        "Read\n\nAttachment note.txt:\n" + "b".repeat(1500),
      );
    expect(updates).toEqual(["Yes ", "Yes indeed."]);
  }
});

test("D2 finite selection guards the full source before omissions and retains the archive", async () => {
  const { prepareChatSelection } = await import("./chat");
  const archive = Array.from({ length: 30 }, (_, index) => ({
    id: `turn-${index}`,
    role: index % 2 ? ("assistant" as const) : ("user" as const),
    content: index === 29 ? "a".repeat(16000) : `Saved ${index}`,
  }));
  const original = JSON.stringify(archive);
  const source = {
    prompt: "Why?",
    messages: archive,
    context: "Document ".repeat(200),
    files: [],
  };
  const selection = {
    turnIds: ["turn-0", "turn-1"],
    documentExcerpt: "Document",
  };
  const ready = prepareChatSelection(source, selection, () => {});
  expect(ready).toMatchObject({
    kind: "ready",
    input: {
      prompt: "Why?",
      messages: [
        { role: "user", content: "Saved 0" },
        { role: "assistant", content: "Saved 1" },
      ],
      context: "Document",
    },
    inclusion: {
      turnIds: ["turn-0", "turn-1"],
      excludedTurns: 28,
      documentBytes: 8,
      attachmentNames: [],
    },
  });
  expect(
    prepareChatSelection(
      source,
      { turnIds: ["turn-29"], documentExcerpt: "" },
      () => {},
    ),
  ).toMatchObject({ kind: "needs_selection" });
  expect(
    prepareChatSelection(
      source,
      { turnIds: archive.map((turn) => turn.id), documentExcerpt: "" },
      () => {},
    ),
  ).toMatchObject({ kind: "needs_selection" });
  expect(JSON.stringify(archive)).toBe(original);
  expect(() =>
    prepareChatSelection(source, selection, (text) => {
      if (text.includes("Saved 28")) throw new Error("Configured key");
    }),
  ).toThrow("Configured key");
});
