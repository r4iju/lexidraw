import React, { useState, useCallback } from "react";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { useSendQuery } from "../use-send-query";
import { useChatState } from "../llm-chat-context";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useSerializeEditorState } from "../use-serialized-editor-state";
import { SendIcon } from "lucide-react";
import { useSidebarSize } from "~/components/ui/sidebar-wrapper";
import { cn } from "~/lib/utils";

export const MessageInput = () => {
  const [text, setText] = useState("");
  const sendQuery = useSendQuery();
  const { streaming, mode } = useChatState();
  const { width } = useSidebarSize();
  const [editor] = useLexicalComposerContext();
  const { serializeEditorStateWithKeys } = useSerializeEditorState();

  const handleSubmit = useCallback(
    async (event?: React.FormEvent<HTMLFormElement>) => {
      event?.preventDefault();
      const trimmedText = text.trim();
      if (!trimmedText || streaming) return;

      const editorState = editor.getEditorState();
      const editorStateObject = serializeEditorStateWithKeys(editorState);
      const editorJson = editorStateObject
        ? JSON.stringify(editorStateObject)
        : undefined;

      if (!editorJson) {
        console.error("Failed to serialize editor state.");
        return;
      }

      setText("");
      await sendQuery({
        prompt: trimmedText,
        editorStateJson: editorJson,
      });
    },
    [editor, sendQuery, serializeEditorStateWithKeys, streaming, text],
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSubmit();
    }
  };

  const placeholder = (() => {
    switch (mode) {
      case "chat":
        return "Ask AI about the document";
      case "agent":
        return "Ask AI to write, or change the document";
      default:
        return "";
    }
  })();

  return (
    <form
      className={cn("flex gap-2 border-t border-border p-3", {
        "flex-col items-stretch": width < 300,
        "flex-row items-end ": width >= 300,
      })}
      onSubmit={handleSubmit}
    >
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        className="flex-1 resize-none"
        rows={1}
        onKeyDown={handleKeyDown}
        disabled={streaming}
        aria-label="Chat input"
      />
      <Button type="submit" disabled={streaming || !text.trim()}>
        <SendIcon className="w-4 h-4" />
        {width < 300 || width >= 500 ? (
          <span className="ml-2">{streaming ? "Sending..." : "Send"}</span>
        ) : null}
      </Button>
    </form>
  );
};
