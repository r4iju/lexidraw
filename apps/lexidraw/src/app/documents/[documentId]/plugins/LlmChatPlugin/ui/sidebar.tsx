import { ModeTabs } from "./mode-tabs";
import { MessageList } from "./message-list";
import { MessageInput } from "./message-input";
import { useLlmChat } from "../store";
import React from "react";
import { SidebarWrapper } from "~/components/ui/sidebar-wrapper";

export const Sidebar: React.FC = () => {
  const { isSidebarOpen, toggleSidebar } = useLlmChat();

  return (
    <SidebarWrapper
      isOpen={isSidebarOpen}
      onClose={toggleSidebar}
      title="LLM Assistant"
    >
      <div className="flex flex-col flex-1 overflow-hidden">
        {" "}
        <ModeTabs />
        <MessageList className="flex-1 overflow-y-auto px-4 py-3" />
        <MessageInput />
      </div>
    </SidebarWrapper>
  );
};
