import React, { useState, useCallback, useRef } from "react";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { useSendQuery } from "../use-send-query";
import { useChatState } from "../llm-chat-context";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useKeyedSerialization } from "../use-serialized-editor-state";
import { SendIcon, PaperclipIcon, XIcon, FileIcon } from "lucide-react";
import { useSidebarSize } from "~/components/ui/sidebar-wrapper";
import { cn } from "~/lib/utils";

export const MessageInput = () => {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[] | null>(null);
  const sendQuery = useSendQuery();
  const { streaming, mode } = useChatState();
  const { width } = useSidebarSize();
  const [editor] = useLexicalComposerContext();
  const { serializeEditorStateWithKeys } = useKeyedSerialization();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = event.target.files;
    if (selectedFiles) {
      setFiles(Array.from(selectedFiles));
    }
  };

  const handleRemoveFile = (index: number) => {
    if (!files) return;
    const newFiles = Array.from(files).filter((_, i) => i !== index);
    setFiles(newFiles.length > 0 ? newFiles : null);
    if (newFiles.length === 0 && fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSubmit = useCallback(
    async (event?: React.FormEvent<HTMLFormElement>) => {
      event?.preventDefault();
      const trimmedText = text.trim();
      if (!trimmedText && !files) return;
      if (streaming) return;

      const editorState = editor.getEditorState();
      const editorStateObject = serializeEditorStateWithKeys(editorState);
      const editorJson = editorStateObject
        ? JSON.stringify(editorStateObject)
        : undefined;

      setText("");
      setFiles(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      await sendQuery({
        prompt: trimmedText,
        editorStateJson: editorJson,
        files,
      });
    },
    [editor, sendQuery, serializeEditorStateWithKeys, streaming, text, files],
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
        return "Ask AI about the document, or upload a PDF";
      case "agent":
        return "Ask AI to write, or change the document";
      default:
        return "";
    }
  })();

  return (
    <>
      {files && (
        <div className="flex flex-wrap gap-2 mx-2 mb-1">
          {files.map((file, index) => (
            <div
              key={index}
              className="flex items-center gap-2 px-2 py-1 rounded-md bg-muted"
            >
              <FileIcon className="size-5 flex-shrink-0" />
              <span className="text-sm truncate max-w-[150px]">
                {file.name}
              </span>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => handleRemoveFile(index)}
                className="hover:bg-background size-8 flex-shrink-0"
              >
                <XIcon className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <form
        className={cn("flex gap-2 border-t border-border p-3", {
          "flex-col items-stretch": width < 300,
          "flex-row items-end ": width >= 300,
        })}
        onSubmit={handleSubmit}
      >
        <input
          type="file"
          accept=".pdf"
          ref={fileInputRef}
          onChange={handleFileChange}
          className="hidden"
          id="file-upload-input"
          multiple
        />
        <div className="flex-1 flex flex-col">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={placeholder}
            className="flex-1 resize-none"
            rows={4}
            onKeyDown={handleKeyDown}
            disabled={streaming}
            aria-label="Chat input"
          />
        </div>
        <div
          className={cn("flex flex-col gap-2 items-end", {
            "flex-row justify-between": width < 300,
            "flex-col gap-3": width >= 300,
          })}
        >
          <Button
            type="button"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={streaming}
          >
            <PaperclipIcon className="w-4 h-4" />
            {width < 300 || width >= 500 ? (
              <span className="ml-2">{"Files"}</span>
            ) : null}
          </Button>
          <Button
            type="submit"
            disabled={streaming || (!text.trim() && !files)}
          >
            <SendIcon className="w-4 h-4" />
            {width < 300 || width >= 500 ? (
              <span className="ml-2">{streaming ? "Sending..." : "Send"}</span>
            ) : null}
          </Button>
        </div>
      </form>
    </>
  );
};
