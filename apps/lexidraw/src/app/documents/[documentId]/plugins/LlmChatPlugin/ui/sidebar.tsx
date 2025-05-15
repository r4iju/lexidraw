import React from "react";
import { ModeTabs } from "./mode-tabs";
import { MessageList } from "./message-list";
import { MessageInput } from "./message-input";
import { Reset } from "./reset";

export const Sidebar: React.FC = () => {
  return (
    <div className="flex flex-col flex-1 h-full overflow-hidden">
      <div className="p-2 flex justify-between gap-2">
        <ModeTabs />
        <Reset />
      </div>
      <MessageList />
      <MessageInput />
    </div>
  );
};
