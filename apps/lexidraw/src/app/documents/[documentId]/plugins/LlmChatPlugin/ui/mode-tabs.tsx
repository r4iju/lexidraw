import type React from "react";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { useDeveloperFlag } from "~/lib/developer-flag";
import { useChatState, useChatDispatch } from "../llm-chat-context";
import type { ChatState } from "../llm-chat-context";

const MODES: { mode: ChatState["mode"]; label: string }[] = [
  { mode: "chat", label: "Chat" },
  { mode: "agent", label: "Agent" },
  { mode: "slide-agent", label: "Slide agent" },
];

export const ModeTabs: React.FC = () => {
  const { mode } = useChatState();
  const dispatch = useChatDispatch();
  const developer = useDeveloperFlag();
  const modes = developer
    ? [...MODES, { mode: "debug" as const, label: "Debug" }]
    : MODES;

  return (
    <Tabs
      value={mode}
      onValueChange={(value) =>
        dispatch({ type: "setMode", mode: value as ChatState["mode"] })
      }
      className="w-full"
    >
      <TabsList className="w-full rounded-sm">
        {modes.map(({ mode, label }) => (
          <TabsTrigger key={mode} value={mode} className="flex-1 rounded-sm">
            <span className="text-xs">{label}</span>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
};
