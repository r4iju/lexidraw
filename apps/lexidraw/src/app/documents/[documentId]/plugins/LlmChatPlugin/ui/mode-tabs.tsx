import type React from "react";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { useChatState, useChatDispatch } from "../llm-chat-context";
import type { ChatState } from "../llm-chat-context";

export const ModeTabs: React.FC = () => {
  const { mode } = useChatState();
  const dispatch = useChatDispatch();

  const handleValueChange = (value: string) => {
    dispatch({ type: "setMode", mode: value as ChatState["mode"] });
  };

  return (
    <Tabs value={mode} onValueChange={handleValueChange} className="w-full">
      <TabsList className="w-full rounded-sm">
        {(["chat", "agent", "slide-agent", "debug"] as const).map((m) => (
          <TabsTrigger
            key={m}
            value={m}
            className="flex-1 rounded-sm"
            aria-label={`Switch to ${m} mode`}
          >
            <span className="text-xs capitalize">
              {m === "slide-agent" ? "Slide Agent" : m}
            </span>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
};
