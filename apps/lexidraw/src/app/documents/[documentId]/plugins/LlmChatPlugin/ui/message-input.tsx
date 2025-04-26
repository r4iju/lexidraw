import React, { useState } from "react";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { useSendQuery } from "../actions/use-send-query";
import { useChatState } from "../context/llm-chat-context";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";

export const MessageInput: React.FC = () => {
  const [text, setText] = useState("");
  const sendQuery = useSendQuery();
  const { streaming, mode } = useChatState();
  const [editor] = useLexicalComposerContext();

  const handleSubmit = async (event?: React.FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const trimmedText = text.trim();
    if (!trimmedText || streaming) return;

    let editorJson: string | undefined;

    try {
      editorJson = JSON.stringify(editor.getEditorState().toJSON());
    } catch (error) {
      console.error("Failed to serialize editor state in MessageInput:", error);
    }

    try {
      await sendQuery(trimmedText, editorJson);
      setText("");
    } catch (error) {
      console.error("Error sending query from MessageInput:", error);
    }
  };

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
