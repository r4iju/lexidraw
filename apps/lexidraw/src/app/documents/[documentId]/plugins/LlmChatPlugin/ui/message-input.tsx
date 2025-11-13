import type React from "react";
import { useState, useCallback, useEffect, useRef, useId } from "react";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { useSendQuery } from "../use-send-query";
import { useChatState } from "../llm-chat-context";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useKeyedSerialization } from "../use-serialized-editor-state";
import { SendIcon, PaperclipIcon, XIcon, FileIcon } from "lucide-react";
import { useSidebarSize } from "~/components/ui/sidebar-wrapper";
import { cn } from "~/lib/utils";
import { useEntityId } from "~/hooks/use-entity-id";
import { useDebounce } from "~/lib/client-utils";
import { loadInput, saveInput } from "../storage/local-chat-storage";

export const MessageInput = () => {
  const documentId = useEntityId();
  const { streaming, mode, messages } = useChatState();

  // Initialize text from localStorage if available
  const initializeText = useCallback((): string => {
    if (!documentId || typeof window === "undefined") return "";
    return loadInput(documentId, mode);
  }, [documentId, mode]);

  const [text, setText] = useState(initializeText);
  const [files, setFiles] = useState<File[] | null>(null);
  const sendQuery = useSendQuery();
  const { width } = useSidebarSize();
  const [editor] = useLexicalComposerContext();
  const { serializeEditorStateWithKeys } = useKeyedSerialization();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileUploadInputId = useId();
  const prevModeRef = useRef<typeof mode | null>(null);
  const textRef = useRef(text);
  const isInitialMountRef = useRef(true);

  // Keep textRef in sync with text state
  useEffect(() => {
    textRef.current = text;
  }, [text]);

  // Debounced save for input text (2.5s delay)
  const saveInputFn = useCallback(
    (docId: string, currentMode: typeof mode, inputText: string) => {
      saveInput(docId, currentMode, inputText);
    },
    [],
  );
  const { run: saveInputDebounced, cancel: cancelSaveInput } = useDebounce(
    saveInputFn as (...args: unknown[]) => void,
    2500,
  );

  // Track if we just reset to avoid clearing input on normal typing
  const wasResetRef = useRef(false);
  const prevMessagesLengthRef = useRef(messages.length);

  // Detect reset: messages went from non-zero to zero
  useEffect(() => {
    if (prevMessagesLengthRef.current > 0 && messages.length === 0) {
      wasResetRef.current = true;
    }
    prevMessagesLengthRef.current = messages.length;
  }, [messages.length]);

  const prevDocumentIdRef = useRef<string | undefined>(undefined);

  // Load input text when documentId changes (initial load handled by useState initializer)
  useEffect(() => {
    if (!documentId) return;
    const documentIdChanged = prevDocumentIdRef.current !== documentId;

    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      prevModeRef.current = mode;
      prevDocumentIdRef.current = documentId;
      return;
    }

    // Only reload if documentId changed
    if (documentIdChanged) {
      const loaded = loadInput(documentId, mode);
      setText(loaded);
      prevModeRef.current = mode;
      prevDocumentIdRef.current = documentId;
    }
  }, [documentId, mode]);

  // Handle mode changes: save previous mode's input, load new mode's input
  useEffect(() => {
    if (!documentId) return;
    const prevMode = prevModeRef.current;

    // Skip on initial mount (handled by documentId effect)
    if (prevMode === null) {
      return;
    }

    // Only handle mode changes, not documentId changes
    if (prevMode === mode) return;

    // Save previous mode's input immediately if mode changed
    cancelSaveInput(); // Cancel any pending debounced save
    saveInput(documentId, prevMode, textRef.current);

    // Load new mode's input
    const loaded = loadInput(documentId, mode);
    setText(loaded);
    prevModeRef.current = mode;
    wasResetRef.current = false; // Reset flag after mode change
  }, [documentId, mode, cancelSaveInput]);

  // Clear input text only when reset is detected (not on every messages.length === 0)
  useEffect(() => {
    if (wasResetRef.current && messages.length === 0) {
      // Messages were reset, clear input text
      setText("");
      wasResetRef.current = false; // Clear flag after handling reset
    }
  }, [messages.length]);

  // Save input text with debounce when it changes (skip if loading)
  useEffect(() => {
    if (!documentId) return;
    // Skip on initial mount
    if (prevModeRef.current === null) return;

    // Save with debounce
    saveInputDebounced(documentId, mode, text);
  }, [documentId, mode, text, saveInputDebounced]);

  // Cleanup: save current input on unmount or mode change
  useEffect(() => {
    return () => {
      if (!documentId) return;
      cancelSaveInput();
      if (prevModeRef.current !== null) {
        saveInput(documentId, prevModeRef.current, textRef.current);
      }
    };
  }, [documentId, cancelSaveInput]);
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
              key={`${file.name}-${index}`}
              className="flex items-center gap-2 px-2 py-1 rounded-md bg-muted"
            >
              <FileIcon className="size-5 shrink-0" />
              <span className="text-sm truncate max-w-[150px]">
                {file.name}
              </span>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => handleRemoveFile(index)}
                className="hover:bg-background size-8 shrink-0"
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
          id={fileUploadInputId}
          type="file"
          accept=".pdf"
          ref={fileInputRef}
          onChange={handleFileChange}
          className="hidden"
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
