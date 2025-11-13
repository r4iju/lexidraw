"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { ArrowUp, ArrowDown, RefreshCw } from "lucide-react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { ParagraphNode, TextNode } from "lexical";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { ListNode, ListItemNode } from "@lexical/list";
import { CodeNode, CodeHighlightNode } from "@lexical/code";
import { $convertFromMarkdownString } from "@lexical/markdown";
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

  const handleConfirm = () => {
    onConfirm(selectedMode);
    onOpenChange(false);
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] flex flex-col max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Import Markdown</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 flex-1 min-h-0">
          {/* Preview Section */}
          <div className="border border-border rounded-md bg-muted/30 p-4 max-h-64 overflow-y-auto">
            <div className="text-sm font-medium mb-2 text-muted-foreground">
              Preview
            </div>
            <LexicalComposer
              initialConfig={{
                namespace: "markdown-import-preview",
                theme: theme,
                editable: false,
                onError: (error) => {
                  console.error("Lexical error in preview:", error);
                },
                editorState: () =>
                  $convertFromMarkdownString(markdown, PLAYGROUND_TRANSFORMERS),
                nodes: [
                  HeadingNode,
                  ListNode,
                  ListItemNode,
                  QuoteNode,
                  CodeNode,
                  CodeHighlightNode,
                  ParagraphNode,
                  TextNode,
                ],
              }}
            >
              <RichTextPlugin
                contentEditable={
                  <ContentEditable className="outline-hidden min-h-[100px]" />
                }
                placeholder={null}
                ErrorBoundary={LexicalErrorBoundary}
              />
            </LexicalComposer>
          </div>

          {/* Mode Selection */}
          <div className="flex flex-col gap-2">
            <div className="text-sm font-medium text-muted-foreground">
              Insert mode
            </div>
            <ToggleGroup
              type="single"
              value={selectedMode}
              onValueChange={(value) => {
                if (value) setSelectedMode(value as MarkdownInsertMode);
              }}
              disabled={!canEdit}
              className="justify-start"
            >
              <ToggleGroupItem
                value="start"
                aria-label="Insert at start"
                className="flex items-center gap-2"
              >
                <ArrowUp className="h-4 w-4" />
                <span>Insert at start</span>
              </ToggleGroupItem>
              <ToggleGroupItem
                value="end"
                aria-label="Insert at end"
                className="flex items-center gap-2"
              >
                <ArrowDown className="h-4 w-4" />
                <span>Insert at end</span>
              </ToggleGroupItem>
              <ToggleGroupItem
                value="replace"
                aria-label="Replace document"
                className="flex items-center gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                <span>Replace document</span>
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!canEdit}>
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
