"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { debounce } from "@packages/lib";
import { MessageStructure, PublicAccess } from "@packages/types";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { AutoLinkNode, LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { HorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { MarkNode } from "@lexical/mark";
import { CodeNode, CodeHighlightNode } from "@lexical/code";
import CommentPlugin from "./plugins/CommentPlugin";
import { LayoutPlugin } from "./plugins/LayoutPlugin/LayoutPlugin";
import CollapsiblePlugin from "./plugins/CollapsiblePlugin";
import ShortcutsPlugin from "./plugins/ShortcutsPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import MarkdownShortcutPlugin from "./plugins/MarkdownShortcutPlugin";
import { TabIndentationPlugin } from "@lexical/react/LexicalTabIndentationPlugin";
import { HorizontalRulePlugin } from "@lexical/react/LexicalHorizontalRulePlugin";
import { TablePlugin } from "@lexical/react/LexicalTablePlugin";
import { ClickableLinkPlugin } from "@lexical/react/LexicalClickableLinkPlugin";
import CodeHighlightPlugin from "./plugins/code-highlight-plugin";
import CodeActionMenuPlugin from "./plugins/CodeActionMenuPlugin";
import AutocompletePlugin from "./plugins/AutocompletePlugin";
import { AutoFocusPlugin } from "@lexical/react/LexicalAutoFocusPlugin";
import AutoLinkPlugin from "./plugins/AutoLinkPlugin";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import LinkPlugin from "./plugins/LinkPlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import DraggableBlockPlugin from "./plugins/DraggableBlockPlugin";
import ToolbarPlugin from "./plugins/ToolbarPlugin";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
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
import { useLexicalEditable } from "@lexical/react/useLexicalEditable";
import { SettingsContext, useSettings } from "./context/settings-context";
import { FlashMessageContext } from "./context/flash-message-context";
import { LLMProvider } from "./context/llm-context";
import ContextMenuPlugin from "./plugins/ContextMenuPlugin";
import TableOfContentsPlugin from "./plugins/TableOfContentsPlugin";
import { LLMWidget } from "./plugins/AutocompletePlugin/LLMWidget";
import { ToolbarContext } from "./context/toolbar-context";
import ListMaxIndentLevelPlugin from "./plugins/ListMaxIndentLevelPlugin";
import PageBreakPlugin from "./plugins/PageBreakPlugin";
import { PageBreakNode } from "./nodes/PageBreakNode";
import PollPlugin from "./plugins/PollPlugin";
import { PollNode } from "./nodes/PollNode";
import { StickyNode } from "./nodes/StickyNode";
import { CollapsibleContainerNode } from "./plugins/CollapsiblePlugin/CollapsibleContainerNode";
import { CollapsibleContentNode } from "./plugins/CollapsiblePlugin/CollapsibleContentNode";
import { CollapsibleTitleNode } from "./plugins/CollapsiblePlugin/CollapsibleTitleNode";
import { LayoutContainerNode } from "./nodes/LayoutContainerNode";
import { LayoutItemNode } from "./nodes/LayoutItemNode";
import EmojiPickerPlugin from "./plugins/EmojiPickerPlugin";
import TreeViewPlugin from "./plugins/TreeViewPlugin";
import { createPortal } from "react-dom";
import { CommentNode } from "./nodes/CommentNode";
import { ThreadNode } from "./nodes/ThreadNode";
import { SessionUUIDProvider } from "./plugins/AutocompletePlugin/session-uuid-provider";
import { DisableChecklistSpacebarPlugin } from "./plugins/list-spacebar-plugin";
import {
  UnsavedChangesProvider,
  useUnsavedChanges,
} from "../../../hooks/use-unsaved-changes";
import { TooltipProvider } from "~/components/ui/tooltip";
import { LlmChatPlugin } from "./plugins/LlmChatPlugin";
import { CommentProvider } from "./context/comment-context";
import { TocProvider } from "./context/toc-context";
import { type z } from "zod";
import { LlmConfigSchema } from "~/server/api/routers/config";

type EditorProps = {
  entity: RouterOutputs["entities"]["load"];
  iceServers: RTCIceServer[];
  initialLlmConfig: z.infer<ReturnType<typeof LlmConfigSchema.partial>>;
};

function EditorHandler({ entity, iceServers, initialLlmConfig }: EditorProps) {
  const editorStateRef = useRef<EditorState>(undefined);
  const canCollaborate =
    entity.sharedWith.length > 0 ||
    entity.publicAccess !== PublicAccess.PRIVATE;
  const userId = useUserIdOrGuestId();
  const [isCollaborating, setIsCollaborating] = useState(false);
  const [isRemoteUpdate, setIsRemoteUpdate] = useState(false);
  const [editor] = useLexicalComposerContext();

  const [isLinkEditMode, setIsLinkEditMode] = useState<boolean>(false);
  const {
    settings: {
      showTreeView,
      isAutocomplete,
      shouldUseLexicalContextMenu,
      tableCellMerge,
      tableCellBackgroundColor,
    },
  } = useSettings();
  const isEditable = useLexicalEditable();

  const [floatingAnchorElem, setFloatingAnchorElem] =
    useState<HTMLDivElement | null>(null);

  const { markDirty } = useUnsavedChanges();

  const onRef = (_floatingAnchorElem: HTMLDivElement) => {
    if (_floatingAnchorElem !== null) {
      setFloatingAnchorElem(_floatingAnchorElem);
    }
  };

  const debouncedSendUpdateRef = useRef(
    debounce((parsedState: string) => {
      sendMessage({
        type: "update",
        entityId: entity.id,
        userId,
        entityType: "document",
        payload: { elements: parsedState },
      });
    }, 100),
  );

  const onChange = (editorState: EditorState) => {
    if (isRemoteUpdate) return;
    const parsedState = JSON.stringify(editorState);
    if (parsedState === JSON.stringify(editorStateRef.current)) {
      return;
    }
    markDirty();
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

  const { sendMessage, initializeConnection } = useWebRtcService(
    { drawingId: entity.id, userId, iceServers },
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
  }, [canCollaborate, initializeConnection, isCollaborating]);

  return (
    <SettingsContext>
      <FlashMessageContext>
        <TableContext>
          <ToolbarContext>
            <LLMProvider initialConfig={initialLlmConfig}>
              <CommentProvider>
                <TocProvider>
                  <div className="flex flex-col size-full">
                    <div className="bg-white sticky dark:bg-zinc-900 top-0 left-0 z-10 w-full shadow-sm">
                      <div className="flex justify-between items-start px-4 md:px-8 py-2 max-w-screen-xl rounded-md shadow-sm gap-2 mx-auto">
                        {/* Dropdown for options (hidden on small screens) */}
                        <OptionsDropdown
                          className="hidden md:flex"
                          documentId={entity.id}
                          state={editorStateRef}
                        />

                        <ShortcutsPlugin
                          editor={editor}
                          setIsLinkEditMode={setIsLinkEditMode}
                        />

                        {/* Toolbar Plugin (always visible) */}
                        <TooltipProvider>
                          <ToolbarPlugin
                            setIsLinkEditMode={setIsLinkEditMode}
                          />
                        </TooltipProvider>
                        {/* Dark Mode Toggle (hidden on small screens) */}
                        <ModeToggle className="hidden md:flex" />
                      </div>
                    </div>
                    <div className="relative size-full">
                      {/* bottom left options */}
                      <OptionsDropdown
                        className=" fixed bottom-2 left-2 z-10 md:hidden"
                        documentId={entity.id}
                        state={editorStateRef}
                      />

                      <div className="relative size-full max-w-screen-lg mx-auto">
                        <LlmChatPlugin />
                        <DisableChecklistSpacebarPlugin />
                        <CommentPlugin />
                        <EmojiPickerPlugin />
                        <LayoutPlugin />
                        <LLMWidget />
                        <ListPlugin />
                        <ListMaxIndentLevelPlugin />
                        <CheckListPlugin />
                        <MarkdownShortcutPlugin />
                        <PageBreakPlugin />
                        <CollapsiblePlugin />
                        <PollPlugin />
                        <CodeHighlightPlugin />
                        <TabIndentationPlugin />
                        <SessionUUIDProvider>
                          <AutocompletePlugin />
                        </SessionUUIDProvider>
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
                            <div
                              className="size-full border-none flex relative outline-none z-0"
                              ref={onRef}
                            >
                              <ContentEditable
                                id="lexical-content"
                                className="size-full min-h-[90vh] outline-none p-4 text-foreground border-x"
                              />
                            </div>
                          }
                          placeholder={<Placeholder />}
                          ErrorBoundary={LexicalErrorBoundary}
                        />
                        <OnChangePlugin onChange={onChange} />
                        <HistoryPlugin />
                        <AutoFocusPlugin />
                        <TableOfContentsPlugin />
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
                    {shouldUseLexicalContextMenu && <ContextMenuPlugin />}
                    {showTreeView &&
                      createPortal(
                        <div className="absolute top-[60%] left-0 h-full w-full z-10 overflow-y-auto">
                          <TreeViewPlugin />
                        </div>,
                        document.body,
                      )}
                  </div>
                </TocProvider>
              </CommentProvider>
            </LLMProvider>
          </ToolbarContext>
        </TableContext>
      </FlashMessageContext>
    </SettingsContext>
  );
}

function Placeholder() {
  return (
    <div className="absolute top-4 left-4 text-muted-foreground select-none pointer-events-none">
      Enter some rich text...
    </div>
  );
}

type Props = {
  entity: RouterOutputs["entities"]["load"];
  iceServers: RTCIceServer[];
  initialLlmConfig: z.infer<ReturnType<typeof LlmConfigSchema.partial>>;
};

export default function DocumentEditor({
  entity,
  iceServers,
  initialLlmConfig,
}: Props) {
  "use memo";
  return (
    <LexicalComposer
      initialConfig={{
        namespace: "Lexidraw",
        editorState: entity.elements,
        onError: (error: unknown) => {
          console.error("Error in LexicalComposer: ", error);
        },
        nodes: [
          CommentNode,
          ThreadNode,
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
          PageBreakNode,
          PollNode,
          StickyNode,
          CollapsibleContainerNode,
          CollapsibleContentNode,
          CollapsibleTitleNode,
          LayoutContainerNode,
          LayoutItemNode,
        ],
        theme: theme,
      }}
    >
      <UnsavedChangesProvider>
        <EditorHandler
          entity={entity}
          iceServers={iceServers}
          initialLlmConfig={initialLlmConfig}
        />
      </UnsavedChangesProvider>
    </LexicalComposer>
  );
}
