import React from "react";
import { ModeTabs } from "./mode-tabs";
import { MessageList } from "./message-list";
import { MessageInput } from "./message-input";
import { Reset } from "./reset";
import { useChatState } from "../llm-chat-context";
import { DebugPanel } from "./debug-panel";

export const Sidebar: React.FC = () => {
  const { mode } = useChatState();

  return (
    <div className="flex flex-col flex-1 h-full overflow-hidden">
      <div className="p-2 flex justify-between gap-2">
        <ModeTabs />
        <Reset />
      </div>
      {mode === "debug" ? (
        <DebugPanel />
      ) : (
        <>
          <MessageList />
          <MessageInput />
        </>
      )}
    </div>
  );
};
