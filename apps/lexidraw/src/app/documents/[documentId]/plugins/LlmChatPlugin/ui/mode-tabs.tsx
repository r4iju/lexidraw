import React from "react";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { useChatState, useChatDispatch } from "../context/LlmChatContext";
import type { ChatState } from "../context/LlmChatContext"; // Import ChatState type

export const ModeTabs: React.FC = () => {
  const { mode } = useChatState();
  const dispatch = useChatDispatch();

  // Type assertion for safety, although reducer should handle validation
  const handleValueChange = (value: string) => {
    dispatch({ type: "setMode", mode: value as ChatState["mode"] });
  };

  return (
    <Tabs value={mode} onValueChange={handleValueChange} className="p-2">
      <TabsList className="w-full rounded-sm">
        {/* Use 'as const' for literal types */}
        {(["chat", "agent"] as const).map((m) => (
          <TabsTrigger
            key={m}
            value={m}
            className="flex-1 rounded-sm"
            aria-label={`Switch to ${m} mode`}
          >
            <span className="text-xs capitalize">{m}</span>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
};
