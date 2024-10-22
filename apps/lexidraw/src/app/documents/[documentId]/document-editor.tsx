"use client";

import { useCallback, useEffect, useRef, useState } from "react";
// packages
import { debounce } from "@packages/lib";
import { TRANSFORMERS } from "@lexical/markdown";
import { MessageStructure } from "@packages/types";
// nodes
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { AutoLinkNode, LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { HorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { MarkNode } from "@lexical/mark";
import { CodeNode, CodeHighlightNode } from "@lexical/code";
// plugins
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { TabIndentationPlugin } from "@lexical/react/LexicalTabIndentationPlugin";
import { HorizontalRulePlugin } from "@lexical/react/LexicalHorizontalRulePlugin";
import { TablePlugin } from "@lexical/react/LexicalTablePlugin";
import { ClickableLinkPlugin } from "@lexical/react/LexicalClickableLinkPlugin";
import CodeHighlightPlugin from "./plugins/code-highlight-plugin";
import CodeActionMenuPlugin from "./plugins/CodeActionMenuPlugin";
import AutocompletePlugin from "./plugins/AutocompletePlugin";
import { AutoFocusPlugin } from "@lexical/react/LexicalAutoFocusPlugin";
import ActionsPlugin from "./plugins/ActionsPlugin";
import AutoLinkPlugin from "./plugins/AutoLinkPlugin";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import LinkPlugin from "./plugins/LinkPlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
// import ToolbarPlugin from "./_plugins/toolbar-plugin";
import DraggableBlockPlugin from "./plugins/DraggableBlockPlugin";
import ToolbarPlugin from "./plugins/ToolbarPlugin";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import LexicalErrorBoundary from "@lexical/react/LexicalErrorBoundary";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
// shadcnui
// import { theme } from "./_themes/playground-theme";
import { theme } from "./themes/theme";
import ModeToggle from "~/components/theme/dark-mode-toggle";
import OptionsDropdown from "./plugins/options-dropdown";
import { EditorState } from "lexical";
import { useWebRtcService } from "~/hooks/communication-service/use-web-rtc";
import { RouterOutputs } from "~/trpc/shared";
import { useUserIdOrGuestId } from "~/hooks/use-user-id-or-guest-id";
import FloatingLinkEditorPlugin from "./plugins/FloatingLinkEditorPlugin";
import TableActionMenuPlugin from "./plugins/TableActionMenuPlugin";
import AutoEmbedPlugin from "./plugins/AutoEmbedPlugin";
import FloatingTextFormatToolbarPlugin from "./plugins/FloatingTextFormatToolbarPlugin";
import { TableCellNode, TableNode, TableRowNode } from "@lexical/table";
import { TableContext } from "./plugins/TablePlugin";
import TableCellResizer from "./plugins/TableCellResizer";
import { ImageNode } from "./nodes/ImageNode";
import ImagesPlugin from "./plugins/ImagesPlugin";
import InlineImagePlugin from "./plugins/InlineImagePlugin";
import { InlineImageNode } from "./nodes/InlineImageNode/InlineImageNode";
import { AutocompleteNode } from "./nodes/AutocompleteNode";
import TwitterPlugin from "./plugins/TwitterPlugin";
import YouTubePlugin from "./plugins/YouTubePlugin";
import { TweetNode } from "./nodes/TweetNode";
import { YouTubeNode } from "./nodes/YouTubeNode";
import ExcalidrawPlugin from "./plugins/ExcalidrawPlugin";
import { ExcalidrawNode } from "./nodes/ExcalidrawNode";
import { FigmaNode } from "./nodes/FigmaNode";
import { EquationNode } from "./nodes/EquationNode";
import FigmaPlugin from "./plugins/FigmaPlugin";
import EquationsPlugin from "./plugins/EquationsPlugin";
import useLexicalEditable from "@lexical/react/useLexicalEditable";
import { SettingsContext, useSettings } from "./context/settings-context";
import { FlashMessageContext } from "./context/flash-message-context";
import ContextMenuPlugin from "./plugins/ContextMenuPlugin";
import TableOfContentsPlugin from "./plugins/TableOfContentsPlugin";

type EditorProps = {
  revalidate: () => void;
  entity: RouterOutputs["entities"]["load"];
  iceServers: RTCIceServer[];
};

function EditorHandler({ revalidate, entity, iceServers }: EditorProps) {
  const editorStateRef = useRef<EditorState>();
  const canCollaborate =
    entity.sharedWith.length > 0 || entity.publicAccess !== "private";
  const userId = useUserIdOrGuestId();
  const [isCollaborating, setIsCollaborating] = useState(false);
  const [isRemoteUpdate, setIsRemoteUpdate] = useState(false);
  const [editor] = useLexicalComposerContext();
  const [isLinkEditMode, setIsLinkEditMode] = useState<boolean>(false);
  const {
    settings: {
      isAutocomplete,
      isRichText,
      showTableOfContents,
      shouldUseLexicalContextMenu,
      shouldPreserveNewLinesInMarkdown,
      tableCellMerge,
      tableCellBackgroundColor,
    },
  } = useSettings();
  const isEditable = useLexicalEditable();

  const [floatingAnchorElem, setFloatingAnchorElem] =
    useState<HTMLDivElement | null>(null);

  const onRef = (_floatingAnchorElem: HTMLDivElement) => {
    if (_floatingAnchorElem !== null) {
      setFloatingAnchorElem(_floatingAnchorElem);
    }
  };

  useEffect(() => {
    console.log("floatingAnchorElem", floatingAnchorElem);
  }, [floatingAnchorElem]);

  const debouncedSendUpdateRef = useRef(
    debounce((parsedState: string) => {
      sendMessage({
        type: "update",
        entityId: entity.id,
        userId,
        entityType: "document",
        payload: {
          elements: parsedState,
        },
      });
    }, 100),
  );

  const onChange = (editorState: EditorState) => {
    if (isRemoteUpdate) return;
    const parsedState = JSON.stringify(editorState);
    if (parsedState === JSON.stringify(editorStateRef.current)) {
      return;
    }
    editorStateRef.current = editorState;
    debouncedSendUpdateRef.current(parsedState);
  };

  const applyUpdate = useCallback(
    (message: MessageStructure) => {
      if (message.entityType === "document") {
        setIsRemoteUpdate(true);
        const editorState = editor.parseEditorState(message.payload.elements);
        editorStateRef.current = editorState;
        editor.setEditorState(editorState);
        setIsRemoteUpdate(false);
      }
    },
    [editor],
  );

  const { sendMessage, initializeConnection, closeConnection } =
    useWebRtcService(
      {
        drawingId: entity.id,
        userId,
        iceServers,
      },
      {
        onMessage: applyUpdate,
        onConnectionClose: () => setIsCollaborating(false),
        onConnectionOpen: () => setIsCollaborating(true),
      },
    );

  useEffect(() => {
    if (!isCollaborating && canCollaborate) {
      initializeConnection()
        .then(() => {
          console.log("connection initialized");
        })
        .catch((err) => {
          console.error("error initializing connection", err);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // cleanup on unmount
  useEffect(() => {
    return () => {
      revalidate();
      closeConnection(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SettingsContext>
      <FlashMessageContext>
        <TableContext>
          <>
            <div className="relative w-full h-screen bg-zinc-50 dark:bg-zinc-950">
              {/* Toolbar with semi-transparent background floating over the content */}
              <div className="fixed top-0 left-0 right-0 z-10 w-full">
                <div className="flex justify-center md:justify-between md:px-8 items-center py-2 max-w-screen-lg mx-auto">
                  <OptionsDropdown
                    className="hidden md:flex"
                    documentId={entity.id}
                    state={editorStateRef}
                  />
                  {/* <ToolbarPlugin /> */}
                  <ToolbarPlugin setIsLinkEditMode={setIsLinkEditMode} />
                  <ModeToggle className="hidden md:flex" />
                </div>
              </div>
              {/* bottom left options */}

              <OptionsDropdown
                className=" fixed bottom-2 left-2 z-10 md:hidden"
                documentId={entity.id}
                state={editorStateRef}
              />

              {/* ContentEditable allowing content to scroll behind the toolbar */}
              <div className="w-full h-full overflow-y-auto max-w-screen-lg border-x border-x-zinc-200 mx-auto">
                <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
                <CodeHighlightPlugin />
                <TabIndentationPlugin />
                <AutocompletePlugin />
                <AutoEmbedPlugin />
                <AutoLinkPlugin />
                <HorizontalRulePlugin />
                <TablePlugin
                  hasCellMerge={tableCellMerge}
                  hasCellBackgroundColor={tableCellBackgroundColor}
                />
                <TableCellResizer />
                <ImagesPlugin />
                <InlineImagePlugin />
                <LinkPlugin />
                <ClickableLinkPlugin disabled={isEditable} />
                <TwitterPlugin />
                <YouTubePlugin />
                <ExcalidrawPlugin />
                <FigmaPlugin />
                <EquationsPlugin />
                <RichTextPlugin
                  contentEditable={
                    <div className="editor-scroller">
                      <div className="editor" ref={onRef}>
                        <ContentEditable
                          id="lexical-content"
                          className="resize-none outline-none pt-20 px-6 text-black dark:text-white "
                        />
                      </div>
                    </div>
                  }
                  placeholder={<Placeholder />}
                  ErrorBoundary={LexicalErrorBoundary}
                />
                <OnChangePlugin onChange={onChange} />
                <HistoryPlugin />
                <AutoFocusPlugin />
              </div>
            </div>
            {floatingAnchorElem && (
              <>
                <DraggableBlockPlugin anchorElem={floatingAnchorElem} />
                <CodeActionMenuPlugin anchorElem={floatingAnchorElem} />
                <FloatingLinkEditorPlugin
                  anchorElem={floatingAnchorElem}
                  isLinkEditMode={isLinkEditMode}
                  setIsLinkEditMode={setIsLinkEditMode}
                />
                <TableActionMenuPlugin
                  anchorElem={floatingAnchorElem}
                  cellMerge={true}
                />
                <FloatingTextFormatToolbarPlugin
                  anchorElem={floatingAnchorElem}
                  setIsLinkEditMode={setIsLinkEditMode}
                />
              </>
            )}
            {isAutocomplete && <AutocompletePlugin />}
            <div>{showTableOfContents && <TableOfContentsPlugin />}</div>
            {shouldUseLexicalContextMenu && <ContextMenuPlugin />}
            <ActionsPlugin
              isRichText={isRichText}
              shouldPreserveNewLinesInMarkdown={
                shouldPreserveNewLinesInMarkdown
              }
            />
          </>
        </TableContext>
      </FlashMessageContext>
    </SettingsContext>
  );
}

function Placeholder() {
  return (
    <div className="px-6 text-gray-600 mt-[-32px] dark:text-gray-100 select-none pointer-events-none">
      Enter some rich text...
    </div>
  );
}

type Props = {
  revalidate: () => void;
  entity: RouterOutputs["entities"]["load"];
  iceServers: RTCIceServer[];
};

export default function DocumentEditor({
  revalidate,
  entity,
  iceServers,
}: Props) {
  return (
    <LexicalComposer
      initialConfig={{
        namespace: "Lexidraw",
        editorState: entity.elements,
        onError: (error: unknown) => {
          console.error("Error in LexicalComposer: ", error);
        },
        nodes: [
          HeadingNode,
          QuoteNode,
          ListItemNode,
          ListNode,
          HorizontalRuleNode,
          MarkNode,
          CodeNode,
          CodeHighlightNode,
          TableNode,
          TableCellNode,
          TableRowNode,
          ImageNode,
          InlineImageNode,
          AutocompleteNode,
          LinkNode,
          AutoLinkNode,
          TweetNode,
          YouTubeNode,
          ExcalidrawNode,
          FigmaNode,
          EquationNode,
        ],
        theme: theme,
      }}
    >
      <EditorHandler
        revalidate={revalidate}
        entity={entity}
        iceServers={iceServers}
      />
    </LexicalComposer>
  );
}
