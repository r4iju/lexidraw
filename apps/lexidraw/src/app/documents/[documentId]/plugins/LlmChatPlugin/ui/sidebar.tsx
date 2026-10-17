import { useSendQuery, DOCUMENT_ACTION_GUIDANCE } from "../use-send-query";
import Link from "next/link";
import { useEntityId } from "~/hooks/use-entity-id";
import type React from "react";
import { ModeTabs } from "./mode-tabs";
import { MessageList } from "./message-list";
import { ChatComposer } from "./chat-composer";
import { OwnedChatRecovery } from "~/lib/generation/chat-recovery";
import { Reset } from "./reset";
import { useChatState } from "../llm-chat-context";
import { DebugPanel } from "./debug-panel";
import { useDeveloperFlag } from "~/lib/developer-flag";

export const Sidebar: React.FC = () => {
  const { mode: chosen } = useChatState();
  const documentId = useEntityId();
  const developer = useDeveloperFlag();
  const send = useSendQuery();
  const mode = chosen === "debug" && !developer ? "chat" : chosen;

  return (
    <div className="flex flex-col flex-1 h-full overflow-hidden">
      <div className="p-2 flex items-center justify-between gap-2 border-b border-border">
        <ModeTabs />
        <Reset />
      </div>
      {mode === "debug" && <DebugPanel />}
      {chosen !== "chat" && (
        <div className="space-y-3 p-4">
          <p>{DOCUMENT_ACTION_GUIDANCE}</p>
          <Link href={`/documents/${encodeURIComponent(documentId)}/agent`}>
            Open document action
          </Link>
        </div>
      )}
      {mode === "chat" && (
        <>
          <MessageList />
          <OwnedChatRecovery documentId={documentId} />
          <ChatComposer send={send} />
          <Link className="p-3" href="/settings#settings-ai-power">
            Manage AI Power
          </Link>
        </>
      )}
    </div>
  );
};
