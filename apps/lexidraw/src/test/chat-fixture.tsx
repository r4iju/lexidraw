import { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  LLMProvider,
  useLLM,
} from "~/app/documents/[documentId]/context/llm-context";
import { ChatComposer } from "~/app/documents/[documentId]/plugins/LlmChatPlugin/ui/chat-composer";
import {
  loadMessages,
  saveMessages,
} from "~/app/documents/[documentId]/plugins/LlmChatPlugin/storage/local-chat-storage";
import { createByokSession } from "~/lib/byok/session";
import { runChat } from "~/lib/generation/chat";
import { proChatPort } from "~/lib/generation/chat-client";
import type { ChatRuntime } from "~/lib/generation/chat-runtime";
const initialConfig = {
  chat: {
    provider: "openai" as const,
    modelId: "inert-legacy-model",
    temperature: 0.5,
    maxOutputTokens: 100,
  },
  agent: {
    provider: "openai" as const,
    modelId: "inert-legacy-model",
    temperature: 0.5,
    maxOutputTokens: 100,
  },
  autocomplete: {
    provider: "openai" as const,
    modelId: "inert-legacy-model",
    temperature: 0.5,
    maxOutputTokens: 100,
  },
};
const network = window.fetch.bind(window);
const session = createByokSession(
  async (request) => {
    if (request.url !== "https://openrouter.ai/api/v1/chat/completions")
      return network(request);
    const body = await request.json();
    const content = body.messages.at(-1).content;
    if (content.includes("error"))
      throw new Error("synthetic private provider diagnostic");
    const delta = (text: string) =>
      new TextEncoder().encode(
        `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`,
      );
    return new Response(
      new ReadableStream({
        async start(controller) {
          controller.enqueue(delta("The bridge "));
          await new Promise((resolve) => setTimeout(resolve, 4000));
          if (!request.signal.aborted) {
            controller.enqueue(delta("is closed for repairs."));
            controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
          }
          controller.close();
        },
      }),
      { headers: { "Content-Type": "text/event-stream" } },
    );
  },
  window.location.origin,
  { chatFixture: true },
);
const reference = session.replace(
  "openrouter",
  "sk-or-v1-web-chat-fixture-only-123456",
);
async function rpc(path: string, value: unknown) {
  const response = await session.fetch(`/fixture/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  if (!response.ok) throw new Error("Fixture unavailable");
  return response.json();
}
function App() {
  const [source, setSource] = useState<"byok" | "pro">("byok");
  const runtime: ChatRuntime = {
    source,
    available: true,
    run(input, signal, onText, confirm) {
      return runChat(
        input,
        source === "byok"
          ? session.chat(reference)
          : proChatPort(input, {
              quote: (input) => rpc("quote", input),
              accept: (input) => rpc("accept", input),
              cancel: (id) => rpc("cancel", { id }),
              confirm,
              fetch: (request) => session.fetch(request),
              origin: window.location.origin,
              idempotencyKey: crypto.randomUUID(),
            }),
        { signal, onText, assertSafe: session.assertSafe },
      );
    },
  };
  return (
    <>
      <h1>Source-selected chat local fixture</h1>
      <p>Saved document context: The east bridge is closed for repairs.</p>
      <label>
        Fixture AI Power{" "}
        <select
          value={source}
          onChange={(event) =>
            setSource(event.target.value === "pro" ? "pro" : "byok")
          }
        >
          <option value="byok">Device key</option>
          <option value="pro">Pro trial</option>
        </select>
      </label>
      <button
        type="button"
        onClick={() => {
          saveMessages("chat-fixture", "chat", []);
          window.location.reload();
        }}
      >
        Restore saved fixture
      </button>
      <LLMProvider initialConfig={initialConfig} chatRuntime={runtime}>
        <Conversation />
      </LLMProvider>
    </>
  );
}
function Conversation() {
  const llm = useLLM();
  const [messages, setMessages] = useState(() => {
    const saved = loadMessages("chat-fixture", "chat");
    return saved.length
      ? saved
      : [
          { id: "one", role: "user" as const, content: "Which bridge?" },
          {
            id: "two",
            role: "assistant" as const,
            content: "The east bridge.",
          },
        ];
  });
  const [partial, setPartial] = useState("");
  async function send({
    prompt,
    files,
  }: {
    prompt: string;
    files?: FileList | null;
  }) {
    setPartial("");
    await llm.generateChatStream({
      prompt,
      messages: messages.map(({ role, content }) => ({ role, content })),
      context: "The east bridge is closed for repairs.",
      files,
      callbacks: {
        onTextUpdate: setPartial,
        onFinish({ text }) {
          const next = [
            ...messages,
            { id: crypto.randomUUID(), role: "user" as const, content: prompt },
            {
              id: crypto.randomUUID(),
              role: "assistant" as const,
              content: text,
            },
          ];
          setMessages(next);
          saveMessages("chat-fixture", "chat", next);
          setPartial("");
        },
        onError(error) {
          setPartial(error.message);
        },
      },
    });
  }
  return (
    <>
      <ol aria-label="Saved conversation">
        {messages.map((message) => (
          <li key={message.id}>
            {message.role}: {message.content}
          </li>
        ))}
      </ol>
      <p role="status" aria-label="Streaming response">
        {partial}
      </p>
      <ChatComposer send={send} />
    </>
  );
}
const root = document.getElementById("root");
if (!root) throw new Error("Fixture root unavailable");
createRoot(root).render(<App />);
