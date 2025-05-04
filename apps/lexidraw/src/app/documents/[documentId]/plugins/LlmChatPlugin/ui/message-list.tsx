import React, { useEffect, useRef } from "react";
import { useChatState } from "../llm-chat-context";
import type { ChatState } from "../llm-chat-context";
import { cn } from "~/lib/utils";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { theme } from "../../../themes/theme";
import { ParagraphNode, TextNode } from "lexical";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { ListNode, ListItemNode } from "@lexical/list";
import { CodeNode, CodeHighlightNode } from "@lexical/code";
import { $convertFromMarkdownString, TRANSFORMERS } from "@lexical/markdown";

type Message = ChatState["messages"][number];

// /********* helper – find the last "safe" line break *********/
function splitMarkdownSafely(raw: string) {
  let insideFence = false; // toggled by ```
  let lastSafeLineIdx = -1;

  const lines = raw.split("\n");

  lines.forEach((line, idx) => {
    // toggle when we hit the opening/closing fence
    if (/^\s*```/.test(line)) insideFence = !insideFence;
    // any line *outside* a fence is safe to render now
    if (!insideFence) lastSafeLineIdx = idx;
  });

  // slice after the lastSafeLineIdx; anything beyond is "streaming"
  const formatted = lines.slice(0, lastSafeLineIdx + 1).join("\n");
  const streaming = lines.slice(lastSafeLineIdx + 1).join("\n");

  return { formatted, streaming };
}
// /****************************************************************/

export const MessageList: React.FC<{ className?: string }> = ({
  className,
}) => {
  // Get messages from the new context hook
  const { messages, streamingMessageId } = useChatState();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when messages change or streaming starts/stops
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div
      ref={scrollRef}
      className={cn("flex-1 overflow-y-auto space-y-3 px-2", className)}
    >
      {messages.map((m: Message) => {
        const isStreaming = m.id === streamingMessageId;
        let contentElement: React.ReactNode;

        if (isStreaming) {
          const { formatted, streaming } = splitMarkdownSafely(m.content ?? "");

          const formattedElement =
            formatted.trim() !== "" ? (
              <LexicalComposer
                key={`stream-${m.id}-${formatted.length}`}
                initialConfig={{
                  namespace: `message-${m.id}-formatted`,
                  theme: theme,
                  editable: false,
                  onError: (error) => {
                    console.error("Lexical error (stream-formatted):", error);
                  },
                  editorState: () =>
                    $convertFromMarkdownString(formatted, TRANSFORMERS),
                  nodes: [
                    HeadingNode,
                    ListNode,
                    ListItemNode,
                    QuoteNode,
                    CodeNode,
                    CodeHighlightNode,
                    ParagraphNode,
                    TextNode,
                  ],
                }}
              >
                <RichTextPlugin
                  contentEditable={<ContentEditable className="outline-none" />}
                  placeholder={null}
                  ErrorBoundary={LexicalErrorBoundary}
                />
              </LexicalComposer>
            ) : null;

          const streamingElement =
            streaming.trim() !== "" ? <>{streaming}</> : null;

          contentElement =
            formattedElement || streamingElement ? (
              <>
                {formattedElement}
                {formattedElement && streamingElement && "\n"}
                {streamingElement}
              </>
            ) : (
              <span className="italic text-muted-foreground">Typing…</span>
            );
        } else if (m.content) {
          // Render using Lexical once streaming is finished
          contentElement = (
            <LexicalComposer
              key={`final-${m.id}-${m.content.length}`}
              initialConfig={{
                namespace: `message-${m.id}`,
                theme: theme,
                editable: false,
                onError: (error) => {
                  console.error(
                    "Lexical error during message rendering:",
                    error,
                  );
                },
                editorState: () =>
                  $convertFromMarkdownString(m.content ?? "", TRANSFORMERS),
                nodes: [
                  HeadingNode,
                  ListNode,
                  ListItemNode,
                  QuoteNode,
                  CodeNode,
                  CodeHighlightNode,
                  ParagraphNode,
                  TextNode,
                ],
              }}
            >
              <RichTextPlugin
                contentEditable={<ContentEditable className="outline-none" />}
                placeholder={null}
                ErrorBoundary={LexicalErrorBoundary}
              />
              <HistoryPlugin />
            </LexicalComposer>
          );
        } else {
          // Handle empty message content after streaming (or if initially empty)
          contentElement = (
            <span className="italic text-muted-foreground">Empty message</span>
          );
        }

        return (
          <div
            key={m.id}
            className={cn(
              "rounded-b-lg px-3 py-2 text-sm whitespace-pre-wrap max-w-[85%] break-words",
              m.role === "user"
                ? "bg-primary text-primary-foreground ml-auto rounded-tl-lg"
                : "bg-muted text-foreground mr-auto rounded-tr-lg",
              m.role === "system" &&
                "border border-dashed border-muted-foreground",
            )}
          >
            {contentElement}
          </div>
        );
      })}
    </div>
  );
};
