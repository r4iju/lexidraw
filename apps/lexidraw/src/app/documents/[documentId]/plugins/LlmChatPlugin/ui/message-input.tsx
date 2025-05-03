import React, { useState, useCallback } from "react";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { useSendQuery } from "../use-send-query";
import { useChatState } from "../llm-chat-context";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useSerializeEditorState } from "../use-serialized-editor-state";

export const MessageInput: React.FC = () => {
  const [text, setText] = useState("");
  const sendQuery = useSendQuery();
  const { streaming, mode } = useChatState();
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

      await sendQuery({
        prompt: trimmedText,
        editorStateJson: editorJson,
      });
      setText("");
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
    <form className="border-t p-3 flex gap-2 items-end" onSubmit={handleSubmit}>
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
        {streaming ? "Sending..." : "Send"}
      </Button>
    </form>
  );
};
