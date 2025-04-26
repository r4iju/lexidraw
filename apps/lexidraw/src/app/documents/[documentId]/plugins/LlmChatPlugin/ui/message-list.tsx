import React from "react";
import { useLlmChat } from "../store";
import { cn } from "~/lib/utils";

export const MessageList: React.FC<{ className?: string }> = ({
  className,
}) => {
  const { messages } = useLlmChat();
  return (
    <div className={cn("space-y-3", className)}>
      {messages.map((m) => (
        <div
          key={m.id}
          className={cn(
            "rounded-xl px-4 py-2 text-sm whitespace-pre-wrap",
            m.role === "user"
              ? "bg-primary text-primary-foreground self-end ml-auto"
              : "bg-secondary text-secondary-foreground",
          )}
        >
          {m.content || <span className="italic text-muted-foreground">…</span>}
        </div>
      ))}
    </div>
  );
};
