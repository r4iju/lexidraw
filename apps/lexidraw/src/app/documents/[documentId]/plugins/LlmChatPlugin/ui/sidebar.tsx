// ui/Sidebar.tsx
// import { Card, CardContent } from "~/components/ui/card";
// import { Button } from "~/components/ui/button";
// import { X } from "lucide-react";
// import clsx from "clsx";
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
      // Optional: specify width if needed, defaults to w-[360px]
      // widthClass="w-[380px] sm:w-[420px]"
    >
      {/* Render the specific content directly */}
      <div className="flex flex-col flex-1 overflow-hidden -m-4">
        {" "}
        {/* Add negative margin to counteract wrapper padding if needed */}
        <ModeTabs />
        <MessageList className="flex-1 overflow-y-auto px-4 py-3" />
        <MessageInput />
      </div>
    </SidebarWrapper>
  );
};
