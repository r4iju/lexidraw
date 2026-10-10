"use client";
import { useLLM } from "../../../context/llm-context";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
export function ChatComposer({
  send,
}: {
  send: (input: { prompt: string; files?: FileList | null }) => Promise<void>;
}) {
  const llm = useLLM();
  return (
    <div className="space-y-3 p-3">
      <p role="status">
        AI Power: {llm.chatSource}.{" "}
        {llm.chatCapability ??
          "Bounded text chat. Saved history is included. Text attachments only."}
      </p>
      {llm.chatQuote && (
        <div role="dialog" aria-label="Review chat maximum">
          <p>
            Maximum reservation: {(llm.chatQuote.maximum / 1000000).toFixed(3)}{" "}
            credits.
          </p>
          <p>{llm.chatQuote.policy}</p>
          <Button onClick={() => llm.acceptChatQuote(true)}>
            Accept maximum
          </Button>
          <Button variant="outline" onClick={() => llm.acceptChatQuote(false)}>
            Decline
          </Button>
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const prompt = new FormData(form).get("prompt");
          const input = form.elements.namedItem("files");
          if (typeof prompt === "string" && input instanceof HTMLInputElement)
            void send({ prompt, files: input.files });
        }}
      >
        <Textarea
          name="prompt"
          aria-label="Chat input"
          placeholder="Ask about this document"
          disabled={llm.chatState.isStreaming}
        />
        <input
          type="file"
          name="files"
          aria-label="Text attachments"
          accept=".txt,.md,text/plain,text/markdown"
          multiple
          disabled={llm.chatState.isStreaming}
        />
        <Button
          type="submit"
          disabled={!!llm.chatCapability || llm.chatState.isStreaming}
        >
          Send
        </Button>
        {llm.chatState.isStreaming && (
          <Button type="button" variant="outline" onClick={llm.cancelChat}>
            Stop
          </Button>
        )}
      </form>
    </div>
  );
}
