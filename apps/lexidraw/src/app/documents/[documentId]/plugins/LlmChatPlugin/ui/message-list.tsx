import React, { useEffect, useRef } from "react";
import { useChatState } from "../context/llm-chat-context";
import type { ChatState } from "../context/llm-chat-context";
import { cn } from "~/lib/utils";

// Define the message type explicitly based on ChatState
type Message = ChatState["messages"][number];

export const MessageList: React.FC<{ className?: string }> = ({
  className,
}) => {
  // Get messages from the new context hook
  const { messages, streaming } = useChatState();
  const scrollRef = useRef<HTMLDivElement>(null); // Ref for scrolling

  // Scroll to bottom when messages change or streaming starts/stops
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streaming]);

  return (
    <div
      ref={scrollRef}
      className={cn("flex-1 overflow-y-auto space-y-3 p-4", className)} // Added padding and flex-1
    >
      {messages.map((m: Message) => (
        <div
          key={m.id}
          className={cn(
            "rounded-lg px-3 py-2 text-sm whitespace-pre-wrap max-w-[85%] break-words", // Adjusted styling
            m.role === "user"
              ? "bg-primary text-primary-foreground ml-auto" // User messages align right
              : "bg-muted text-muted-foreground mr-auto", // Assistant/System messages align left
            m.role === "system" &&
              "border border-dashed border-muted-foreground", // System message styling
          )}
        >
          {/* Simple content display: Show content or 'Empty message' placeholder */}
          {m.content || (
            <span className="italic text-muted-foreground">Empty message</span>
          )}
        </div>
      ))}

      {streaming && (
        <div
          className={cn(
            "rounded-lg px-3 py-2 text-sm whitespace-pre-wrap max-w-[85%] break-words",
            "bg-muted text-muted-foreground mr-auto", // Style like an assistant message
          )}
        >
          <span className="italic text-muted-foreground">Typing…</span>
        </div>
      )}
    </div>
  );
};
