import React from "react";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { useLlmChat, type ChatMode } from "../store";

export const ModeTabs: React.FC = () => {
  const { mode, setMode } = useLlmChat();

  return (
    <Tabs
      value={mode}
      onValueChange={(v) => setMode(v as ChatMode)}
      className="p-2"
    >
      <TabsList className="w-full rounded-sm">
        {(["chat", "agent"] satisfies ChatMode[]).map((m) => (
          <TabsTrigger key={m} value={m} className="flex-1">
            <span className="text-xs capitalize">{m}</span>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
};
