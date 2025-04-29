import React, { useState, useCallback } from "react";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { useSendQuery } from "../use-send-query";
import { useChatState } from "../llm-chat-context";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";

import {
  $getRoot,
  $isElementNode,
  $isTextNode,
  type EditorState,
  type LexicalNode,
  type NodeKey,
} from "lexical";
import { $isHeadingNode } from "@lexical/rich-text";
import { $convertToMarkdownString, TRANSFORMERS } from "@lexical/markdown";

interface SerializedNodeWithKey {
  type: string;
  key: NodeKey;
  // version: number; // Removed version
  // TextNode specific
  text?: string;
  detail?: number;
  format?: number;
  mode?: string; // TextModeType is string literal union
  style?: string;
  // ElementNode specific
  direction?: "ltr" | "rtl" | null;
  indent?: number;
  // ElementNode specific type tags (add more as needed)
  tag?: string; // For HeadingNode, etc.
  listType?: string; // For ListNode
  // Children
  children?: SerializedNodeWithKey[];
}

const useSerializeEditorState = () => {
  function serializeNodeWithKeys(
    node: LexicalNode,
  ): SerializedNodeWithKey | null {
    if (!node) {
      return null;
    }
    const serializedNode: Partial<SerializedNodeWithKey> = {
      type: node.getType(),
      key: node.getKey(),
    };

    if ($isTextNode(node)) {
      serializedNode.text = node.getTextContent();
      serializedNode.detail = node.getDetail();
      serializedNode.format = node.getFormat();
      serializedNode.mode = node.getMode();
      serializedNode.style = node.getStyle();
    } else if ($isElementNode(node)) {
      serializedNode.direction = node.getDirection();
      serializedNode.format = node.getFormat();
      serializedNode.indent = node.getIndent();
      const children = node.getChildren();
      serializedNode.children = children
        .map(serializeNodeWithKeys)
        .filter((child): child is SerializedNodeWithKey => child !== null);

      if ($isHeadingNode(node)) {
        serializedNode.tag = node.getTag();
      }
      // Example: Add check for ListNode (import $isListNode and ListNode from @lexical/list)
      // if ($isListNode(node)) {
      //   serializedNode.listType = node.getListType();
      //   serializedNode.start = node.getStart();
      // }
    }
    return serializedNode as SerializedNodeWithKey;
  }

  function serializeEditorStateWithKeys(editorState: EditorState): {
    root: SerializedNodeWithKey;
  } {
    let serializedRoot: SerializedNodeWithKey | null = null;
    editorState.read(() => {
      const rootNode = $getRoot();
      serializedRoot = serializeNodeWithKeys(rootNode);
    });

    const fallbackRoot: Partial<SerializedNodeWithKey> = {
      type: "root",
      key: "root",
      children: [],
      direction: null,
      format: 0,
      indent: 0,
    };
    return { root: (serializedRoot ?? fallbackRoot) as SerializedNodeWithKey };
  }

  return { serializeEditorStateWithKeys };
};

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

      let editorJson: string | undefined;
      let editorMarkdown: string | undefined;
      let editorStateObject: { root: SerializedNodeWithKey } | undefined;

      try {
        const editorState = editor.getEditorState();
        editorStateObject = serializeEditorStateWithKeys(editorState);
        console.log(
          "Inspecting CUSTOM editor state serialization:",
          editorStateObject,
        );
        editorJson = JSON.stringify(editorStateObject);

        editorState.read(() => {
          editorMarkdown = $convertToMarkdownString(TRANSFORMERS);
        });
      } catch (error) {
        console.error(
          "Failed to serialize editor state in MessageInput:",
          error,
        );
        if (editorStateObject) {
          console.log("Object that failed to stringify:", editorStateObject);
        }
      }

      try {
        await sendQuery({
          prompt: trimmedText,
          editorStateJson: editorJson,
          editorStateMarkdown: editorMarkdown,
        });
        setText("");
      } catch (error) {
        console.error("Error sending query from MessageInput:", error);
      }
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
