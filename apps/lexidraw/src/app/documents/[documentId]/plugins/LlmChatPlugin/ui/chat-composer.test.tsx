import { afterAll, expect, test } from "bun:test";
import { installDom, render, click, button } from "~/test/dom";
import { LLMProvider } from "../../../context/llm-context";
import {
  ChatStateCtx,
  ChatDispatchCtx,
  type ChatState,
} from "../llm-chat-context";
import {
  prepareChatSelection,
  runChat,
  type ChatInput,
} from "~/lib/generation/chat";
import { ChatComposer } from "./chat-composer";
import { MessageList } from "./message-list";
installDom();
window.HTMLElement.prototype.scrollTo = () => {};
const previousFormData = globalThis.FormData;
const previousMatchMedia = globalThis.matchMedia;
globalThis.FormData = window.FormData;
globalThis.matchMedia = window.matchMedia;
afterAll(() => {
  globalThis.FormData = previousFormData;
  globalThis.matchMedia = previousMatchMedia;
});
const config = {
  provider: "openai",
  modelId: "old",
  temperature: 0,
  maxOutputTokens: 100,
};
test("D2 composer reviews finite context before dispatch while displaying the full saved archive", async () => {
  const messages: ChatState["messages"] = Array.from(
    { length: 30 },
    (_, index) => ({
      id: `turn-${index}`,
      role: index % 2 ? "assistant" : "user",
      content: index === 29 ? "a".repeat(16000) : `Saved ${index}`,
    }),
  );
  const original = JSON.stringify(messages);
  const sent: unknown[] = [];
  const send = Object.assign(
    async ({ selectedInput }: { selectedInput?: ChatInput }) => {
      if (selectedInput)
        await runChat(selectedInput, {
          async *stream(request) {
            sent.push(request);
            yield "Done.";
          },
        });
    },
    {
      review: async ({
        prompt,
        selection,
      }: {
        prompt: string;
        selection: import("~/lib/generation/chat").ChatSelection;
      }) =>
        prepareChatSelection(
          { prompt, messages, context: "Document ".repeat(200), files: [] },
          selection,
          () => {},
        ),
    },
  );
  const view = await render(
    <ChatStateCtx.Provider
      value={{
        messages,
        mode: "chat",
        sidebarOpen: true,
        streaming: false,
        streamingMessageId: null,
        maxAgentSteps: 5,
      }}
    >
      <ChatDispatchCtx.Provider value={() => {}}>
        <LLMProvider
          initialConfig={{ chat: config, agent: config, autocomplete: config }}
          chatRuntime={{
            source: "byok",
            available: true,
            run: async () => "unused",
          }}
        >
          <MessageList />
          <ChatComposer send={send} />
        </LLMProvider>
      </ChatDispatchCtx.Provider>
    </ChatStateCtx.Provider>,
  );
  try {
    expect(document.body.textContent).toContain("Saved 0");
    expect(document.body.textContent).toContain("a".repeat(16000));
    const prompt =
      document.querySelector<HTMLTextAreaElement>('[name="prompt"]');
    if (!prompt) throw new Error("No prompt");
    prompt.value = "Why?";
    expect(button("Review context")).toBeDefined();
    await click(button("Review context"));
    expect(document.body.textContent).toContain(
      "Choose fewer complete saved turns",
    );
    expect(sent).toEqual([]);
    const boxes = [
      ...document.querySelectorAll<HTMLInputElement>('[name="turn"]'),
    ];
    expect(boxes).toHaveLength(30);
    for (const box of boxes)
      box.checked = ["turn-0", "turn-1"].includes(box.value);
    await click(button("Review context"));
    expect(document.body.textContent).toContain(
      "2 complete saved turns included; 28 saved turns excluded",
    );
    expect(sent).toEqual([]);
    await click(button("Send reviewed context"));
    expect(sent).toMatchObject([
      {
        messages: [
          { content: "Saved 0" },
          { content: "Saved 1" },
          { content: "Why?" },
        ],
      },
    ]);
    expect(JSON.stringify(messages)).toBe(original);
  } finally {
    await view.unmount();
  }
});
