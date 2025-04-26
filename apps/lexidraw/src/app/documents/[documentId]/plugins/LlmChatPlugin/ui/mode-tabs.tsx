import React from "react";
import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { useLlmChat, type ChatMode } from "../store";

export const ModeTabs: React.FC = () => {
  const { mode, setMode } = useLlmChat();

  return (
    <Tabs
      value={mode}
      onValueChange={(v) => setMode(v as ChatMode)}
      className="border-b px-4 py-2"
    >
      <TabsList>
        {(["chat", "edit", "agent"] satisfies ChatMode[]).map((m) => (
          <TabsTrigger key={m} value={m}>
            {m}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
};
