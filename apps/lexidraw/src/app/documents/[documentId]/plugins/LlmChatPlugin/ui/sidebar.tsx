import React from "react";
import { ModeTabs } from "./mode-tabs";
import { MessageList } from "./message-list";
import { MessageInput } from "./message-input";
import { useChatState, useChatDispatch } from "../llm-chat-context";
import { SidebarWrapper } from "~/components/ui/sidebar-wrapper";
import { Reset } from "./reset";

export const Sidebar: React.FC = () => {
  const { sidebarOpen } = useChatState();
  const dispatch = useChatDispatch();

  const handleClose = () => {
    dispatch({ type: "toggleSidebar" });
  };

  return (
    <SidebarWrapper
      isOpen={sidebarOpen}
      onClose={handleClose}
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
