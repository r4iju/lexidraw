import { expect, test } from "bun:test";
import { nativeChatRequest, nativeLocalChatRequest } from "./chat";
test("native chat shares bounded history and task preparation without transferring credentials", () => {
  const input = {
    prompt: "Why?",
    messages: [{ role: "assistant", content: "Closed." }],
    context: "Repairs",
  };
  const request = nativeChatRequest(JSON.stringify(input));
  expect(request).toMatchObject({
    stream: true,
    model: "openai/gpt-4.1-mini",
    messages: [
      { role: "system" },
      { role: "assistant", content: "Closed." },
      { role: "user", content: "Why?\n\nDocument context:\nRepairs" },
    ],
  });
  expect(JSON.stringify(request)).not.toMatch(/credential|apiKey/);
  expect(nativeLocalChatRequest(JSON.stringify(input))).toMatchObject({
    maximumResponseTokens: 512,
    prompt: "assistant: Closed.\n\nuser: Why?\n\nDocument context:\nRepairs",
  });
  expect(() =>
    nativeChatRequest(JSON.stringify({ ...input, credential: "secret" })),
  ).toThrow();
});

test("D2 native selection separates a 30-turn archive from complete selected follow-up context", async () => {
  const { nativeChatSelection } = await import("./chat");
  const messages = Array.from({ length: 30 }, (_, index) => ({
    id: `turn-${index}`,
    role: index % 2 ? "assistant" : "user",
    content: index === 29 ? "x".repeat(16000) : `Saved ${index}`,
  }));
  const result = nativeChatSelection(
    JSON.stringify({
      prompt: "Why?",
      messages,
      context: "Document ".repeat(200),
      files: [],
    }),
    JSON.stringify({
      turnIds: ["turn-0", "turn-1"],
      documentExcerpt: "Document",
    }),
  );
  expect(result).toMatchObject({
    kind: "ready",
    input: { messages: [{ content: "Saved 0" }, { content: "Saved 1" }] },
    inclusion: { excludedTurns: 28, documentBytes: 8 },
  });
  if (result.kind !== "ready") throw new Error("not ready");
  expect(nativeChatRequest(JSON.stringify(result.input))).toMatchObject({
    messages: [
      { role: "system" },
      { content: "Saved 0" },
      { content: "Saved 1" },
      { content: "Why?\n\nDocument context:\nDocument" },
    ],
  });
  expect(messages[29]?.content).toBe("x".repeat(16000));
});
