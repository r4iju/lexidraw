import React, { useState } from "react";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { useLlmChat } from "../store";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";

export const MessageInput: React.FC = () => {
  const [prompt, setPrompt] = useState("");
  const { sendQuery } = useLlmChat();
  const [editor] = useLexicalComposerContext();

  const handleSend = () => {
    if (!prompt.trim()) return;
    // Pass selection HTML for context
    const selection = JSON.stringify(editor.getEditorState().toJSON()); // simplify
    sendQuery({ prompt, selectionHtml: selection });
    setPrompt("");
  };

  return (
    <form
      className="border-t p-3 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        handleSend();
      }}
    >
      <Textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Ask me to write, refactor, or explain…"
        className="flex-1 resize-none"
        rows={1}
      />
      <Button type="submit">Send</Button>
    </form>
  );
};
