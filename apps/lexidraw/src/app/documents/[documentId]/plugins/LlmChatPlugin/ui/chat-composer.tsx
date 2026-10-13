"use client";
import { useContext, useLayoutEffect, useState, useRef } from "react";
import {
  chatInclusionSummary,
  type ChatPreparation,
  type ChatInput,
} from "~/lib/generation/chat";
import { ChatStateCtx } from "../llm-chat-context";
import type { useSendQuery } from "../use-send-query";
import { Input } from "~/components/ui/input";
import { useLLM } from "../../../context/llm-context";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
export function ChatComposer({
  send,
}: {
  send: ((input: {
    prompt: string;
    files?: FileList | null;
    selectedInput?: ChatInput;
  }) => Promise<void>) & {
    review?: ReturnType<typeof useSendQuery>["review"];
    scope?: object;
    invalidateReview?: () => void;
  };
}) {
  const llm = useLLM();
  const messages = useContext(ChatStateCtx)?.messages ?? [];
  const [reviewState, setReviewState] = useState<{
    scope: object | undefined;
    result: ChatPreparation | { kind: "idle" | "preparing" };
  }>({ scope: send.scope, result: { kind: "idle" } });
  const currentScope = useRef(send.scope);
  useLayoutEffect(() => {
    currentScope.current = send.scope;
  }, [send.scope]);
  const revision = useRef(0);
  const review =
    reviewState.scope === send.scope
      ? reviewState.result
      : { kind: "idle" as const };
  const setReview = (result: typeof reviewState.result) =>
    setReviewState({ scope: send.scope, result });
  return (
    <div className="space-y-3 p-3">
      <p role="status">
        AI Power: {llm.chatSource}.{" "}
        {llm.chatCapability ??
          "Finite text context. Review selected complete saved turns before sending. Text attachments only."}
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
        onChange={() => {
          revision.current++;
          send.invalidateReview?.();
          setReview({ kind: "idle" });
        }}
        onSubmit={async (event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          const prompt = data.get("prompt");
          const documentExcerpt = data.get("excerpt");
          const input = form.elements.namedItem("files");
          if (
            typeof prompt !== "string" ||
            typeof documentExcerpt !== "string" ||
            !(input instanceof HTMLInputElement)
          )
            return;
          if (!send.review) {
            setReview({
              kind: "needs_selection",
              message:
                "Context review is unavailable on this surface. Saved history is preserved.",
            });
            return;
          }
          const scope = send.scope;
          const version = ++revision.current;
          setReview({ kind: "preparing" });
          try {
            const result = await send.review({
              prompt,
              files: input.files,
              selection: {
                turnIds: data
                  .getAll("turn")
                  .filter(
                    (value): value is string => typeof value === "string",
                  ),
                documentExcerpt,
              },
            });
            if (currentScope.current === scope && revision.current === version)
              setReview(result);
          } catch {
            if (currentScope.current !== scope || revision.current !== version)
              return;
            setReview({
              kind: "needs_selection",
              message:
                "Context could not be reviewed. Check device credential ownership and choose supported text context. Saved history is preserved.",
            });
          }
        }}
      >
        <Textarea
          name="prompt"
          aria-label="Chat input"
          placeholder="Ask about this document"
          disabled={llm.chatState.isStreaming || review.kind === "preparing"}
        />
        <Input
          type="file"
          name="files"
          aria-label="Text attachments"
          accept=".txt,.md,text/plain,text/markdown"
          multiple
          disabled={llm.chatState.isStreaming || review.kind === "preparing"}
        />
        <fieldset
          key={messages.at(-1)?.id ?? "empty"}
          disabled={llm.chatState.isStreaming || review.kind === "preparing"}
        >
          <legend>Complete saved turns (default: two most recent)</legend>
          <p>
            Choose up to 24 complete turns. Older saved turns remain available.
            Oversized replies may be explicitly excluded here.
          </p>
          {messages.length === 0 && <p>No saved turns.</p>}
          {messages.map((message, index) => (
            <label key={message.id} className="block">
              <input
                type="checkbox"
                name="turn"
                value={message.id}
                defaultChecked={index >= messages.length - 2}
              />
              {message.role}: {message.content.length} characters (saved turn{" "}
              {index + 1})
            </label>
          ))}
        </fieldset>
        <Textarea
          name="excerpt"
          aria-label="Document excerpt"
          placeholder="Paste an exact document excerpt to include, or leave empty to omit document context"
          disabled={llm.chatState.isStreaming || review.kind === "preparing"}
        />
        <p>
          Current prompt and text attachments are included in full. Document
          context is excluded unless you choose an exact excerpt. Saved history
          remains intact.
        </p>
        <Button
          type="submit"
          disabled={
            !!llm.chatCapability ||
            llm.chatState.isStreaming ||
            review.kind === "preparing"
          }
        >
          Review context
        </Button>
        {review.kind === "needs_selection" && (
          <p role="alert">{review.message}</p>
        )}
        {review.kind === "ready" && (
          <div role="status">
            <p>{chatInclusionSummary(review.inclusion)}</p>
            <p>
              Selected turns: {review.inclusion.turnIds.join(", ") || "none"}.
            </p>
            <Button
              type="button"
              disabled={!!llm.chatCapability || llm.chatState.isStreaming}
              onClick={() => {
                const input = review.input;
                setReview({ kind: "idle" });
                void send({ prompt: input.prompt, selectedInput: input });
              }}
            >
              Send reviewed context
            </Button>
          </div>
        )}
        {llm.chatState.isStreaming && (
          <Button type="button" variant="outline" onClick={llm.cancelChat}>
            Stop
          </Button>
        )}
      </form>
    </div>
  );
}
