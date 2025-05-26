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
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { AppToolCall, AppToolResult } from "../../../context/llm-context";

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

const ToolCallDisplay: React.FC<{
  toolCall: AppToolCall;
  toolResult?: AppToolResult;
}> = ({ toolCall, toolResult }) => {
  let statusIcon = (
    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
  );
  let statusColor = "text-muted-foreground";
  let statusText = "Running...";

  if (toolResult) {
    if (toolResult.ok) {
      statusIcon = <CheckCircle className="h-4 w-4 text-green-500" />;
      statusColor = "text-green-500";
      statusText = "Success";
    } else {
      statusIcon = <AlertCircle className="h-4 w-4 text-red-500" />;
      statusColor = "text-red-500";
      statusText = "Error";
    }
  }

  return (
    <Card className="mt-2">
      <CardHeader className="flex flex-row items-center justify-between p-3">
        <CardTitle className="text-sm font-medium">
          {toolCall.toolName}
        </CardTitle>
        <div className={`flex items-center text-xs ${statusColor}`}>
          {statusIcon}
          <span className="ml-1">{statusText}</span>
        </div>
      </CardHeader>
      <CardContent className="p-3 text-xs">
        <div className="font-mono bg-muted p-2 rounded">
          <p className="font-semibold">Arguments:</p>
          <pre className="whitespace-pre-wrap break-all">
            {JSON.stringify(toolCall.args, null, 2)}
          </pre>
        </div>
        {toolResult && (
          <div className="mt-2 font-mono bg-muted p-2 rounded">
            <p className="font-semibold">Result:</p>
            <pre className="whitespace-pre-wrap break-all">
              {String(toolResult.result)}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export const MessageList: React.FC<{ className?: string }> = ({
  className,
}) => {
  // Get messages from the new context hook
  const { messages, streamingMessageId, streaming, mode } = useChatState();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when messages change or streaming starts/stops or mode changes
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streaming, mode]);

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
                  contentEditable={
                    <ContentEditable className="outline-hidden" />
                  }
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
                contentEditable={<ContentEditable className="outline-hidden" />}
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
            {m.toolCalls && m.toolCalls.length > 0 && (
              <div className="mt-2 space-y-2">
                {m.toolCalls.map((toolCall) => {
                  const toolResult = m.toolResults?.find(
                    (res) => res.toolCallId === toolCall.toolCallId,
                  );
                  return (
                    <ToolCallDisplay
                      key={toolCall.toolCallId}
                      toolCall={toolCall}
                      toolResult={toolResult}
                    />
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {/* Agent Working Indicator */}
      {streaming && mode === "agent" && (
        <div
          key="agent-working-indicator"
          className={cn(
            "rounded-b-lg px-3 py-2 text-sm whitespace-pre-wrap max-w-[85%] break-words",
            "bg-muted text-muted-foreground mr-auto rounded-tr-lg opacity-75",
            "flex items-center",
          )}
        >
          <Loader2 className="h-4 w-4 mr-2 animate-spin flex-shrink-0" />
          <span>Agent is working...</span>
        </div>
      )}
    </div>
  );
};
