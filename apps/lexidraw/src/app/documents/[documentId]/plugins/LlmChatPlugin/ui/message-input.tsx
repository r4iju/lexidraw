import React, { useRef } from "react";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { useLlmChat } from "../store";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  EXECUTE_LLM_TOOL_CALL_COMMAND,
  type ExecuteLlmToolCallPayload,
} from "../llm-tool-calls";

export const MessageInput: React.FC = () => {
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const { sendQuery } = useLlmChat();
  const [editor] = useLexicalComposerContext();

  const handleSend = async () => {
    const promptValue = promptRef.current?.value;
    if (!promptValue || !promptValue.trim()) return;

    // Always get full document state as JSON string for context
    let fullDocumentStateJson: string | undefined;
    editor.getEditorState().read(() => {
      try {
        fullDocumentStateJson = JSON.stringify(
          editor.getEditorState().toJSON(),
        );
      } catch (error) {
        console.error("Failed to serialize editor state:", error);
      }
    });

    console.log("Sending query with prompt:", promptValue);
    console.log(
      "Full Document State JSON Preview:",
      fullDocumentStateJson
        ? `${fullDocumentStateJson.substring(0, 100)}...`
        : "(undefined)",
    );

    if (!fullDocumentStateJson) {
      console.error("Cannot send query without valid editor state JSON.");
      return; // Don't proceed if serialization failed
    }

    if (promptRef.current) {
      promptRef.current.value = "";
    }

    // Pass full document JSON state string as context
    const toolCalls = await sendQuery({
      prompt: promptValue,
      selectionHtml: fullDocumentStateJson,
    });

    // Dispatch commands (Executor needs update)
    if (toolCalls && toolCalls.length > 0) {
      console.log("Received processed tool calls:", toolCalls);
      console.log(
        "Dispatching commands (execution logic needs rework for JSON)",
      );
      for (const toolCall of toolCalls) {
        const payload: ExecuteLlmToolCallPayload = {
          toolCall: toolCall,
        };
        editor.dispatchCommand(EXECUTE_LLM_TOOL_CALL_COMMAND, payload);
      }
    }
  };

  return (
    <form
      className="border-t p-3 flex gap-2 items-end"
      onSubmit={(e) => {
        e.preventDefault();
        void handleSend();
      }}
    >
      <Textarea
        ref={promptRef}
        placeholder="Ask me to write, refactor, or explain…"
        className="flex-1 resize-none"
        rows={1}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void handleSend();
          }
        }}
      />
      <Button type="submit">Send</Button>
    </form>
  );
};
