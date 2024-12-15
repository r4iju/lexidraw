/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

import type {
  BaseSelection,
  LexicalCommand,
  LexicalEditor,
  NodeKey,
} from "lexical";

import "./ImageNode.css";

import { HashtagNode } from "@lexical/hashtag";
import { LinkNode } from "@lexical/link";
import { AutoFocusPlugin } from "@lexical/react/LexicalAutoFocusPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HashtagPlugin } from "@lexical/react/LexicalHashtagPlugin";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LexicalNestedComposer } from "@lexical/react/LexicalNestedComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { useLexicalNodeSelection } from "@lexical/react/useLexicalNodeSelection";
import { mergeRegister } from "@lexical/utils";
import {
  $getNodeByKey,
  $getSelection,
  $isNodeSelection,
  $isRangeSelection,
  $setSelection,
  CLICK_COMMAND,
  COMMAND_PRIORITY_LOW,
  createCommand,
  DRAGSTART_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  LineBreakNode,
  ParagraphNode,
  RootNode,
  SELECTION_CHANGE_COMMAND,
  TextNode,
} from "lexical";
import * as React from "react";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSettings } from "../context/settings-context";
import { useSharedHistoryContext } from "../context/shared-history-context";
import EmojisPlugin from "../plugins/EmojisPlugin";
import KeywordsPlugin from "../plugins/KeywordsPlugin";
import LinkPlugin from "../plugins/LinkPlugin";
import MentionsPlugin from "../plugins/MentionsPlugin";
import TreeViewPlugin from "../plugins/TreeViewPlugin";
import ContentEditable from "~/components/ui/content-editable";
import ImageResizer from "~/components/ui/image-resizer";
import Placeholder from "~/components/ui/placeholder";
import { EmojiNode } from "./EmojiNode";
import { $isImageNode } from "./ImageNode";
import { KeywordNode } from "./KeywordNode";
import NextImage from "next/image";
import { ErrorBoundary } from "react-error-boundary";

export const RIGHT_CLICK_IMAGE_COMMAND: LexicalCommand<MouseEvent> =
  createCommand("RIGHT_CLICK_IMAGE_COMMAND");

function BrokenImage(): React.JSX.Element {
  return (
    <div className="flex items-center justify-center w-full h-full opacity-50">
      <NextImage
        alt="Image is broken"
        height={200}
        width={200}
        src="/images/image-broken.svg"
        draggable="false"
      />
    </div>
  );
}

function LazyImage({
  altText,
  className,
  imageRef,
  src,
  width,
  height,
  maxWidth,
  onError,
}: {
  altText: string;
  className: string | null;
  height: "inherit" | number;
  imageRef: { current: null | HTMLImageElement };
  maxWidth: number;
  src: string;
  width: "inherit" | number;
  onError: () => void;
}): React.JSX.Element {
  const computedWidth = width === "inherit" ? "auto" : `${width}px`;
  const computedHeight = height === "inherit" ? "auto" : `${height}px`;
  
  // calculate width and height based on the actual image
  

  return (
    <ErrorBoundary
      FallbackComponent={() => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={altText}
          width={width === "inherit" ? undefined : width}
          height={height === "inherit" ? undefined : height}
          className={className ?? undefined}
          ref={imageRef as React.RefObject<HTMLImageElement>}
          draggable={false}
        />
      )}
      onError={onError}
    >
      <div
        className="relative inline-block z-0"
        style={{
          maxWidth: maxWidth,
          width: computedWidth,
          height: computedHeight,
        }}
      >
        {/* Avoid using fill. Use fixed width/height or responsive layout */}
        <NextImage
          src={src}
          alt={altText}
          width={100} // or a responsive size if needed
          height={100}
          ref={imageRef as React.RefObject<HTMLImageElement>}
          className={className ?? ""}
          draggable={false}
          onError={onError}
          style={{ objectFit: "contain" }}
        />
      </div>
    </ErrorBoundary>
  );
}

type ImageComponentProps = {
  altText: string;
  caption: LexicalEditor;
  height: "inherit" | number;
  maxWidth: number;
  nodeKey: NodeKey;
  resizable: boolean;
  showCaption: boolean;
  src: string;
  width: "inherit" | number;
  captionsEnabled: boolean;
};

export default function ImageComponent({
  src,
  altText,
  nodeKey,
  width,
  height,
  maxWidth,
  resizable,
  showCaption,
  caption,
  captionsEnabled,
}: ImageComponentProps): React.JSX.Element {
  const imageRef = useRef<null | HTMLImageElement>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [isSelected, setSelected, clearSelection] =
    useLexicalNodeSelection(nodeKey);
  const [isResizing, setIsResizing] = useState<boolean>(false);
  const [editor] = useLexicalComposerContext();
  const [selection, setSelection] = useState<BaseSelection | null>(null);
  const activeEditorRef = useRef<LexicalEditor | null>(null);
  const [isLoadError, setIsLoadError] = useState<boolean>(false);

  const $onDelete = useCallback(
    (payload: KeyboardEvent) => {
      if (isSelected && $isNodeSelection($getSelection())) {
        const event: KeyboardEvent = payload;
        event.preventDefault();
        const node = $getNodeByKey(nodeKey);
        if ($isImageNode(node)) {
          node.remove();
          return true;
        }
      }
      return false;
    },
    [isSelected, nodeKey],
  );

  const $onEnter = useCallback(
    (event: KeyboardEvent) => {
      const latestSelection = $getSelection();
      const buttonElem = buttonRef.current;
      if (
        isSelected &&
        $isNodeSelection(latestSelection) &&
        latestSelection.getNodes().length === 1
      ) {
        if (showCaption) {
          // Move focus into nested editor
          $setSelection(null);
          event.preventDefault();
          caption.focus();
          return true;
        } else if (
          buttonElem !== null &&
          buttonElem !== document.activeElement
        ) {
          event.preventDefault();
          buttonElem.focus();
          return true;
        }
      }
      return false;
    },
    [caption, isSelected, showCaption],
  );

  const $onEscape = useCallback(
    (event: KeyboardEvent) => {
      if (
        activeEditorRef.current === caption ||
        buttonRef.current === event.target
      ) {
        $setSelection(null);
        editor.update(() => {
          setSelected(true);
          const parentRootElement = editor.getRootElement();
          if (parentRootElement !== null) {
            parentRootElement.focus();
          }
        });
        return true;
      }
      return false;
    },
    [caption, editor, setSelected],
  );

  const onClick = useCallback(
    (payload: MouseEvent) => {
      const event = payload;

      if (isResizing) {
        return true;
      }
      if (event.target === imageRef.current) {
        if (event.shiftKey) {
          setSelected(!isSelected);
        } else {
          clearSelection();
          setSelected(true);
        }
        return true;
      }

      return false;
    },
    [isResizing, isSelected, setSelected, clearSelection],
  );

  const onRightClick = useCallback(
    (event: MouseEvent): void => {
      editor.getEditorState().read(() => {
        const latestSelection = $getSelection();
        const domElement = event.target as HTMLElement;
        if (
          domElement.tagName === "IMG" &&
          $isRangeSelection(latestSelection) &&
          latestSelection.getNodes().length === 1
        ) {
          editor.dispatchCommand(
            RIGHT_CLICK_IMAGE_COMMAND,
            event as MouseEvent,
          );
        }
      });
    },
    [editor],
  );

  useEffect(() => {
    let isMounted = true;
    const rootElement = editor.getRootElement();
    const unregister = mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        if (isMounted) {
          setSelection(editorState.read(() => $getSelection()));
        }
      }),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        (_, activeEditor) => {
          activeEditorRef.current = activeEditor;
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand<MouseEvent>(
        CLICK_COMMAND,
        onClick,
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand<MouseEvent>(
        RIGHT_CLICK_IMAGE_COMMAND,
        onClick,
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        DRAGSTART_COMMAND,
        (event) => {
          if (event.target === imageRef.current) {
            // TODO This is just a temporary workaround for FF to behave like other browsers.
            // Ideally, this handles drag & drop too (and all browsers).
            event.preventDefault();
            return true;
          }
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_DELETE_COMMAND,
        $onDelete,
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_BACKSPACE_COMMAND,
        $onDelete,
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(KEY_ENTER_COMMAND, $onEnter, COMMAND_PRIORITY_LOW),
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        $onEscape,
        COMMAND_PRIORITY_LOW,
      ),
    );

    rootElement?.addEventListener("contextmenu", onRightClick);

    return () => {
      isMounted = false;
      unregister();
      rootElement?.removeEventListener("contextmenu", onRightClick);
    };
  }, [
    clearSelection,
    editor,
    isResizing,
    isSelected,
    nodeKey,
    $onDelete,
    $onEnter,
    $onEscape,
    onClick,
    onRightClick,
    setSelected,
  ]);

  const setShowCaption = () => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isImageNode(node)) {
        node.setShowCaption(true);
      }
    });
  };

  const onResizeEnd = (
    nextWidth: "inherit" | number,
    nextHeight: "inherit" | number,
  ) => {
    // Delay hiding the resize bars for click case
    setTimeout(() => {
      setIsResizing(false);
    }, 200);

    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if ($isImageNode(node)) {
        node.setWidthAndHeight(nextWidth, nextHeight);
      }
    });
  };

  const onResizeStart = () => {
    setIsResizing(true);
  };

  const { historyState } = useSharedHistoryContext();
  const {
    settings: { showNestedEditorTreeView },
  } = useSettings();

  const draggable = isSelected && $isNodeSelection(selection) && !isResizing;
  const isFocused = isSelected || isResizing;
  return (
    <Suspense fallback={null}>
      {/* Common parent with relative positioning */}
      <div
        className={`relative inline-block ${draggable ? "cursor-move" : ""}`}
        draggable={draggable}
      >
        {isLoadError ? (
          <BrokenImage />
        ) : (
          <LazyImage
            className={isFocused ? "ring-2 ring-ring rounded-sm" : null}
            src={src}
            altText={altText}
            imageRef={imageRef}
            width={width}
            height={height}
            maxWidth={maxWidth}
            onError={() => setIsLoadError(true)}
          />
        )}

        {resizable && $isNodeSelection(selection) && isFocused && (
          // Position the resizer absolutely within the same container as the image
          <div className="absolute top-0 left-0 w-full h-full z-50">
            <ImageResizer
              showCaption={showCaption}
              setShowCaption={setShowCaption}
              editor={editor}
              buttonRef={buttonRef}
              imageRef={imageRef}
              maxWidth={maxWidth}
              onResizeStart={onResizeStart}
              onResizeEnd={onResizeEnd}
              captionsEnabled={!isLoadError && captionsEnabled}
            />
          </div>
        )}
      </div>

      {showCaption && (
        <div className="mt-2">
          <LexicalNestedComposer
            initialEditor={caption}
            initialNodes={[
              RootNode,
              TextNode,
              LineBreakNode,
              ParagraphNode,
              LinkNode,
              EmojiNode,
              HashtagNode,
              KeywordNode,
            ]}
          >
            <AutoFocusPlugin />
            <MentionsPlugin />
            <LinkPlugin />
            <EmojisPlugin />
            <HashtagPlugin />
            <KeywordsPlugin />
            <HistoryPlugin externalHistoryState={historyState} />
            <RichTextPlugin
              contentEditable={
                <ContentEditable className="border p-2 text-sm w-full rounded" />
              }
              placeholder={
                <Placeholder className="text-muted-foreground text-sm">
                  Enter a caption...
                </Placeholder>
              }
              ErrorBoundary={LexicalErrorBoundary}
            />
            {showNestedEditorTreeView && <TreeViewPlugin />}
          </LexicalNestedComposer>
        </div>
      )}
    </Suspense>
  );
}
