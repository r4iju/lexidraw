import type React from "react";
import { useEffect, useRef } from "react";
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
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "~/components/ui/accordion";
import { CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import type { AppToolCall, AppToolResult } from "../../../context/llm-context";

type Message = ChatState["messages"][number];

// Styling constants
const toolCallContainerStyles =
  "bg-muted/50 border border-border rounded-lg p-2";

/**
 * Type guard to check if a tool result is a success result.
 */
function isSuccessResult(
  tr: AppToolResult,
): tr is AppToolResult & { ok: true } {
  return "ok" in tr && tr.ok === true;
}

/**
 * Creates a Map of tool results by toolCallId for O(1) lookup.
 */
function createToolResultsMap(
  toolResults: AppToolResult[] | undefined,
): Map<string, AppToolResult> {
  return new Map(
    toolResults?.map((tr) => [(tr as { toolCallId: string }).toolCallId, tr]) ??
      [],
  );
}

// /********* helper – find the last "safe" line break *********/
function splitMarkdownSafely(raw: string) {
  let insideFence = false; // toggled by ```
  let lastSafeLineIdx = -1;

  const lines = raw.split("\n");

  for (const line of lines) {
    // toggle when we hit the opening/closing fence
    if (/^\s*```/.test(line)) insideFence = !insideFence;
    // any line *outside* a fence is safe to render now
    if (!insideFence) lastSafeLineIdx = lines.indexOf(line);
  }

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
  let statusIcon: React.ReactNode;
  let statusColor = "text-muted-foreground";
  let statusText = "Running...";

  if (toolResult) {
    if (isSuccessResult(toolResult)) {
      statusIcon = <CheckCircle className="h-4 w-4 text-primary" />;
      statusColor = "text-primary";
      statusText = "Success";
    } else {
      statusIcon = <AlertCircle className="h-4 w-4 text-destructive" />;
      statusColor = "text-destructive";
      statusText = "Error";
    }
  } else {
    statusIcon = (
      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
    );
  }

  return (
    <Accordion type="single" collapsible className="w-full">
      <AccordionItem value={toolCall.toolCallId} className="border-none">
        <AccordionTrigger className="py-2 hover:no-underline">
          <div className="flex items-center justify-between w-full pr-4">
            <span className="text-sm font-medium">{toolCall.toolName}</span>
            <div className={`flex items-center text-xs ${statusColor}`}>
              {statusIcon}
              <span className="ml-1">{statusText}</span>
            </div>
          </div>
        </AccordionTrigger>
        <AccordionContent className="pt-0 pb-2">
          <div className="space-y-2 text-xs">
            <div className="font-mono bg-muted p-2 rounded">
              <p className="font-semibold mb-1">Arguments:</p>
              <pre className="whitespace-pre-wrap break-all text-xs">
                {JSON.stringify(toolCall.input, null, 2)}
              </pre>
            </div>
            {toolResult && (
              <div className="font-mono bg-muted p-2 rounded">
                <p className="font-semibold mb-1">Result:</p>
                <pre className="whitespace-pre-wrap break-all text-xs">
                  {typeof toolResult.result === "string"
                    ? toolResult.result
                    : JSON.stringify(toolResult.result, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
};

export const MessageList: React.FC<{ className?: string }> = ({
  className,
}) => {
  const { messages, streamingMessageId, streaming, mode } = useChatState();
  const messageListDivRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!messageListDivRef.current) return;

    const messageListElement = messageListDivRef.current;
    let scrollableContainer: HTMLElement = messageListElement;

    if (mode === "agent" || mode === "slide-agent") {
      const viewport = messageListElement.closest<HTMLElement>(
        "[data-radix-scroll-area-viewport]",
      );
      if (viewport) {
        scrollableContainer = viewport;
      }
    }

    scrollableContainer.scrollTo({
      top: scrollableContainer.scrollHeight,
      behavior: "smooth",
    });
  }, [mode]);

  return (
    <div
      ref={messageListDivRef}
      className={cn(
        "space-y-3 px-2 py-2",
        mode === "chat" && "flex-1 overflow-y-auto",
        className,
      )}
    >
      {messages
        .filter((m: Message) => {
          // Filter messages: include if they have content OR tool calls
          const hasContent = Boolean(m.content?.trim());
          const hasToolCalls = Boolean(m.toolCalls?.length);
          return hasContent || hasToolCalls;
        })
        .map((m: Message) => {
          const isStreaming = m.id === streamingMessageId;
          const hasContent = Boolean(m.content?.trim());
          const hasToolCalls = Boolean(m.toolCalls?.length);
          const toolResultsMap = createToolResultsMap(m.toolResults);

          // If message has only tool calls and no content, render tool calls standalone
          if (!hasContent && hasToolCalls && m.toolCalls) {
            return (
              <div key={m.id} className="space-y-2">
                {m.toolCalls.map((toolCall) => {
                  const toolResult = toolResultsMap.get(toolCall.toolCallId);
                  return (
                    <div
                      key={toolCall.toolCallId}
                      className={toolCallContainerStyles}
                    >
                      <ToolCallDisplay
                        toolCall={toolCall}
                        toolResult={toolResult}
                      />
                    </div>
                  );
                })}
              </div>
            );
          }

          // Otherwise, render message content (if exists) and tool calls below
          let contentElement: React.ReactNode;

          if (isStreaming) {
            const { formatted, streaming } = splitMarkdownSafely(
              m.content ?? "",
            );

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

            const streamingElement = streaming.trim() !== "" ? streaming : null;

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
                  contentEditable={
                    <ContentEditable className="outline-hidden" />
                  }
                  placeholder={null}
                  ErrorBoundary={LexicalErrorBoundary}
                />
                <HistoryPlugin />
              </LexicalComposer>
            );
          }

          return (
            <div key={m.id}>
              <div
                className={cn(
                  "rounded-b-lg px-3 py-1 text-sm whitespace-pre-wrap max-w-[85%] break-words",
                  // Force Lexical descendants to inherit the bubble's text color only
                  "[&_[data-lexical-editor]]:text-inherit [&_[data-lexical-editor]_*]:text-inherit",
                  {
                    "bg-primary text-primary-foreground ml-auto rounded-tl-lg":
                      m.role === "user",
                    "bg-muted text-foreground mr-auto rounded-tr-lg":
                      m.role !== "user",
                    "border border-border": m.role === "system",
                  },
                )}
              >
                {contentElement}
              </div>
              {hasToolCalls && m.toolCalls && (
                <div className="mt-2 space-y-2">
                  {m.toolCalls.map((toolCall) => {
                    const toolResult = toolResultsMap.get(toolCall.toolCallId);
                    return (
                      <div
                        key={toolCall.toolCallId}
                        className={`${toolCallContainerStyles} max-w-[85%]`}
                      >
                        <ToolCallDisplay
                          toolCall={toolCall}
                          toolResult={toolResult}
                        />
                      </div>
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
          className="rounded-b-lg px-3 py-2 text-sm whitespace-pre-wrap max-w-[85%] break-words bg-muted text-muted-foreground mr-auto rounded-tr-lg opacity-75 flex items-center"
        >
          <Loader2 className="h-4 w-4 mr-2 animate-spin flex-shrink-0" />
          <span>Agent is working...</span>
        </div>
      )}
    </div>
  );
};
