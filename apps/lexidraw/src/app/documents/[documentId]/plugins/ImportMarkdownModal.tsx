"use client";

import { useId, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Radio } from "~/components/ui/radio";
import { ArrowUp, ArrowDown, RefreshCw } from "lucide-react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { $convertFromMarkdownString } from "@lexical/markdown";
import { CORE_NODES } from "@packages/lexical-nodes";
import { theme } from "../themes/theme";
import { PLAYGROUND_TRANSFORMERS } from "./MarkdownTransformers";
import type { MarkdownInsertMode } from "../utils/markdown";

type Props = {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  markdown: string;
  defaultMode?: MarkdownInsertMode;
  onConfirm: (mode: MarkdownInsertMode) => void;
  canEdit: boolean;
};

const MODES = [
  { value: "start", label: "Insert at start", Icon: ArrowUp },
  { value: "end", label: "Insert at end", Icon: ArrowDown },
  { value: "replace", label: "Replace document", Icon: RefreshCw },
] as const satisfies readonly {
  value: MarkdownInsertMode;
  label: string;
  Icon: typeof ArrowUp;
}[];

export default function ImportMarkdownModal({
  isOpen,
  onOpenChange,
  markdown,
  defaultMode = "end",
  onConfirm,
  canEdit,
}: Props) {
  const [selectedMode, setSelectedMode] =
    useState<MarkdownInsertMode>(defaultMode);
  const ids = useId();
  const chosen = MODES.find((mode) => mode.value === selectedMode) ?? MODES[1];

  const handleConfirm = () => {
    onConfirm(selectedMode);
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(56rem,calc(100dvh-32px))] flex-col break-normal md:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import Markdown</DialogTitle>
        </DialogHeader>
        <section
          aria-label="Preview"
          className="document-viewport min-h-0 flex-1 overflow-y-auto rounded-md border border-border bg-background p-4"
        >
          <LexicalComposer
            initialConfig={{
              namespace: "markdown-import-preview",
              theme,
              editable: false,
              onError: (error) => {
                console.error("Lexical error in preview:", error);
              },
              editorState: () =>
                $convertFromMarkdownString(markdown, PLAYGROUND_TRANSFORMERS),
              nodes: CORE_NODES,
            }}
          >
            <RichTextPlugin
              contentEditable={
                <ContentEditable
                  className="document-content outline-hidden"
                  // The document's type and spacing, without its page frame.
                  style={{ minHeight: 0, padding: 0 }}
                />
              }
              placeholder={null}
              ErrorBoundary={LexicalErrorBoundary}
            />
          </LexicalComposer>
        </section>
        <fieldset disabled={!canEdit} className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium text-muted-foreground">
            Import as
          </legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {MODES.map(({ value, label, Icon }) => (
              <label
                key={value}
                htmlFor={`${ids}-${value}`}
                className="flex cursor-pointer items-center gap-2 rounded-md border border-input px-3 py-2 text-sm transition-colors hover:bg-accent has-checked:border-primary has-checked:bg-accent has-focus-visible:ring-2 has-focus-visible:ring-ring has-disabled:cursor-not-allowed has-disabled:opacity-50"
              >
                <Radio
                  id={`${ids}-${value}`}
                  name="markdown-import-mode"
                  value={value}
                  checked={selectedMode === value}
                  onChange={() => setSelectedMode(value)}
                />
                <Icon className="size-4 shrink-0" aria-hidden />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={
              selectedMode === "replace" ? "destructive-confirm" : "default"
            }
            onClick={handleConfirm}
            disabled={!canEdit}
          >
            {chosen.label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
