import Link from "next/link";
import { useEntityId } from "~/hooks/use-entity-id";
import type React from "react";
import { ModeTabs } from "./mode-tabs";
import { MessageList } from "./message-list";
import { MessageInput } from "./message-input";
import { Reset } from "./reset";
import { useChatState } from "../llm-chat-context";
import { DebugPanel } from "./debug-panel";
import { useDeveloperFlag } from "~/lib/developer-flag";

export const Sidebar: React.FC = () => {
  const { mode: chosen } = useChatState();
  const documentId = useEntityId();
  const developer = useDeveloperFlag();
  const mode = chosen === "debug" && !developer ? "chat" : chosen;

  return (
    <div className="flex flex-col flex-1 h-full overflow-hidden">
      <div className="p-2 flex items-center justify-between gap-2 border-b border-border">
        <ModeTabs />
        <Reset />
      </div>
      {mode === "debug" && <DebugPanel />}
      {mode === "agent" && (
        <div className="space-y-3 p-4">
          <p>
            Pro uses a bounded server document action. Save your document before
            opening it. Images and sandbox tools are unavailable.
          </p>
          <Link href={`/documents/${encodeURIComponent(documentId)}/agent`}>
            Open Pro document action
          </Link>
        </div>
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
