import React from "react";
import { ModeTabs } from "./mode-tabs";
import { MessageList } from "./message-list";
import { MessageInput } from "./message-input";
// import { useChatState, useChatDispatch } from "../llm-chat-context";
import { SidebarWrapper } from "~/components/ui/sidebar-wrapper";
import { Reset } from "./reset";
import { useSidebarManager } from "~/context/sidebar-manager-context";

export const Sidebar: React.FC = () => {
  const { activeSidebar, toggleSidebar } = useSidebarManager();

  return (
    <SidebarWrapper
      isOpen={activeSidebar === "llm"}
      onClose={() => toggleSidebar("llm")}
      title="LLM Assistant"
    >
      <div className="flex flex-col flex-1 h-full overflow-hidden">
        <div className="p-2 flex justify-between gap-2">
          <ModeTabs />
          <Reset />
        </div>
        <MessageList />
        <MessageInput />
      </div>
    </SidebarWrapper>
  );
};
