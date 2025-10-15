import type React from "react";
import { ModeTabs } from "./mode-tabs";
import { MessageList } from "./message-list";
import { MessageInput } from "./message-input";
import { Reset } from "./reset";
import { useChatState } from "../llm-chat-context";
import { DebugPanel } from "./debug-panel";
import { AgentSettings } from "./agent-settings";
import { SlideGenerationForm } from "./slide-generation-form";
import { ScrollArea } from "~/components/ui/scroll-area";

export const Sidebar: React.FC = () => {
  const { mode } = useChatState();

  return (
    <div className="flex flex-col flex-1 h-full overflow-hidden">
      <div className="p-2 flex justify-between gap-2 border-b border-border">
        <ModeTabs />
        <Reset />
      </div>
      {mode === "debug" && <DebugPanel />}
      {mode === "agent" && (
        <>
          <ScrollArea className="flex-1 w-full">
            <AgentSettings />
            <MessageList />
          </ScrollArea>
          <MessageInput />
        </>
      )}
      {mode === "slide-agent" && (
        <ScrollArea className="flex-1 w-full">
          <SlideGenerationForm />
          <MessageList />
        </ScrollArea>
      )}
      {mode === "chat" && (
        <>
          <MessageList />
          <MessageInput />
        </>
      )}
    </div>
  );
};
