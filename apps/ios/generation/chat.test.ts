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
