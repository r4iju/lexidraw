"use client";

import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { debounce } from "@packages/lib";
import { type MessageStructure, PublicAccess } from "@packages/types";
import CommentPluginProvider, {
  CommentUI,
  useCommentPlugin,
} from "./plugins/CommentPlugin";
import { LayoutPlugin } from "./plugins/LayoutPlugin/LayoutPlugin";
import CollapsiblePlugin from "./plugins/CollapsiblePlugin";
import CalloutPlugin from "./plugins/CalloutPlugin";
import ShortcutsPlugin from "./plugins/ShortcutsPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { CheckListPlugin } from "@lexical/react/LexicalCheckListPlugin";
import MarkdownShortcutPlugin from "./plugins/MarkdownShortcutPlugin";
import { TabIndentationPlugin } from "@lexical/react/LexicalTabIndentationPlugin";
import { HorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { HorizontalRulePlugin } from "@lexical/react/LexicalHorizontalRulePlugin";
import { DocumentTablesPlugin } from "./plugins/DocumentTablesPlugin";
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
import OptionsDropdown from "./plugins/options-dropdown";
import type { EditorState, Klass, LexicalNode } from "lexical";
import { $getRoot, COLLABORATION_TAG } from "lexical";
import { useWebRtcService } from "~/hooks/communication-service/use-web-rtc";
import type { RouterOutputs } from "~/trpc/shared";
import { useUserIdOrGuestId } from "~/hooks/use-user-id-or-guest-id";
import FloatingLinkEditorPlugin from "./plugins/FloatingTextFormatToolbarPlugin/FloatingLinkEditorPlugin";
import AutoEmbedPlugin from "./plugins/AutoEmbedPlugin";
import FloatingTextFormatToolbarPlugin from "./plugins/FloatingTextFormatToolbarPlugin";
import TableCellResizer from "./plugins/TableCellResizer";
import TableActionMenuPlugin from "./plugins/TableActionMenuPlugin";
import { ImageNode } from "./nodes/ImageNode/ImageNode";
import ImagePlugin from "./plugins/ImagePlugin";
import InlineImagePlugin from "./plugins/InlineImagePlugin";
import { InlineImageNode } from "./nodes/InlineImageNode/InlineImageNode";
import { CORE_NODES } from "@packages/lexical-nodes";
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
import { SettingsProvider, useSettings } from "./context/settings-context";
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
import EmojiPickerPlugin from "./plugins/EmojiPickerPlugin";
import TreeViewPlugin from "./plugins/TreeViewPlugin";
import { SlidePlugin } from "./plugins/SlidePlugin";
import { SlideNode } from "./nodes/SlideNode/SlideNode";
import { CommentNode } from "./nodes/CommentNode";
import { ThreadNode } from "./nodes/ThreadNode";
import { SessionUUIDProvider } from "./plugins/AutocompletePlugin/session-uuid-provider";
import { DisableChecklistSpacebarPlugin } from "./plugins/list-spacebar-plugin";
import {
  UnsavedChangesProvider,
  useUnsavedChanges,
} from "../../../hooks/use-unsaved-changes";
import { TooltipProvider } from "~/components/ui/tooltip";
import { Button } from "~/components/ui/button";
import {
  ListTreeIcon,
  type LucideIcon,
  MessageSquareTextIcon,
} from "lucide-react";
import {
  EntityAppBar,
  type EntityFrame,
} from "~/components/app-bar/entity-frame";
import { ShareButton, ShareDialog } from "~/components/app-bar/share-button";
import { useSaveShortcut } from "~/hooks/use-save-shortcut";
import { cn } from "~/lib/utils";
import { EditReadSwitch } from "./edit-read-switch";
import { DocumentTitleProvider } from "./context/document-title-context";
import { EditabilityPlugin, mayEdit, type RenderMode } from "./editability";
import RenderReadyPlugin from "./plugins/RenderReadyPlugin";
import { LlmChatPlugin } from "./plugins/LlmChatPlugin";
import type { StoredLlmConfig } from "~/server/api/routers/config";
import {
  SidebarManagerProvider,
  useSidebarManager,
  type ActiveSidebar,
} from "~/context/sidebar-manager-context";
import {
  LexicalImageGenerationProvider,
  ImageGenerationProvider,
} from "~/hooks/use-image-generation";
import { useAutoSave } from "~/hooks/use-auto-save";
import {
  OpenEntityContext,
  useOpenEntity,
  useOpenEntityContext,
  useOpenEntitySync,
} from "~/hooks/use-open-entity-sync";
import type { SyncedEditor } from "~/lib/open-entity-sync";
import { useSyncedLexicalEditor } from "./use-synced-lexical-editor";
import {
  LexicalImageProvider,
  ImageProvider,
} from "~/hooks/use-image-insertion";
import VideoPlugin from "./plugins/VideoPlugin";
import { VideoNode } from "./nodes/VideoNode/VideoNode";
import {
  documentFont,
  documentLanguage,
  documentSettings,
} from "~/lib/document-fonts";
import { FontResources } from "./document-typography";
import { DocumentFontsPlugin } from "./plugins/DocumentFontsPlugin";
import {
  type SentSettings,
  useSaveAndExportDocument,
} from "./context/save-and-export";
import { SidebarWrapper } from "~/components/ui/sidebar-wrapper";
import { CommentInputBox } from "./plugins/CommentPlugin";
import MermaidPlugin from "./plugins/MermaidPlugin";
import { MermaidNode } from "./nodes/MermaidNode";
import { useMarkdownTools, type MarkdownInsertMode } from "./utils/markdown";
import {
  DocumentSettingsProvider,
  useDocumentSettings,
} from "./context/document-settings-context";
import { EditorRegistryProvider } from "./context/editors-context";
import { SignedInProvider, useSignedIn } from "./context/signed-in-context";
import ChartPlugin from "./plugins/ChartPlugin";
import { ChartNode } from "./nodes/ChartNode";
import MobileCheckListPlugin from "./plugins/MobileCheckListPlugin";
import ArticlePlugin from "./plugins/ArticlePlugin";
import { ArticleNode } from "./nodes/ArticleNode/ArticleNode";

const SIDEBAR_WIDTH = 360;

type EditorProps = {
  entity: RouterOutputs["entities"]["load"];
  iceServers: RTCIceServer[];
  initialLlmConfig: StoredLlmConfig;
  /** The app bar's; absent where nothing is on screen to frame. */
  frame?: EntityFrame;
};

type ExtendedEditorProps = EditorProps & {
  handleSave: (onSaveSuccessCallback?: (sent: SentSettings) => void) => void;
  handleSilentSave: (
    onSaveSuccessCallback?: (sent: SentSettings) => void,
  ) => void;
  exportMarkdown: () => void;
  editorStateRef: RefObject<EditorState | undefined>;
  setEditorStateRef: (editorState: EditorState) => void;
};

function getSidebarTitle(sidebar: ActiveSidebar): string {
  if (!sidebar) return "";
  switch (sidebar) {
    case "llm":
      return "LLM Chat";
    case "comments":
      return "Comments";
    case "toc":
      return "Table of Contents";
    case "tree":
      return "Document Tree";
    default: {
      const _exhaustiveCheck: never = sidebar;
      if (process.env.NODE_ENV === "development" && _exhaustiveCheck) {
        console.warn("Unexpected sidebar state:", _exhaustiveCheck);
      }
      return "Sidebar";
    }
  }
}

const ConditionalCommentInputBoxRenderer = () => {
  const context = useCommentPlugin();

  const { editor, showCommentInput, cancelAddComment, submitAddComment } =
    context;

  if (showCommentInput && editor) {
    return (
      <CommentInputBox
        editor={editor}
        cancelAddComment={cancelAddComment}
        submitAddComment={submitAddComment}
      />
    );
  }
  return null;
};

/**
 * Whether the editor holds edits the server lacks; yes while it cannot tell,
 * as when its edits are not tracked yet.
 */
function holdsLocalEdits(editor: SyncedEditor): boolean {
  try {
    return editor.hasLocalEdits();
  } catch {
    return true;
  }
}

function EditorHandler({
  entity,
  iceServers,
  initialLlmConfig,
  handleSave,
  handleSilentSave,
  exportMarkdown,
  editorStateRef,
  setEditorStateRef,
  renderMode,
  frame,
}: ExtendedEditorProps & { renderMode: RenderMode }) {
  const onScreen = renderMode === "view";
  const canEdit = mayEdit(renderMode, entity.accessLevel);
  const [reading, setReading] = useState(false);
  const canCollaborate =
    onScreen &&
    (entity.sharedWith.length > 0 ||
      entity.publicAccess !== PublicAccess.PRIVATE);
  const userId = useUserIdOrGuestId();
  const [isCollaborating, setIsCollaborating] = useState(false);
  const [editor] = useLexicalComposerContext();
  // Metadata can change before Lexical emits its first content update.
  useEffect(() => {
    setEditorStateRef(editor.getEditorState());
  }, [editor, setEditorStateRef]);

  const { insertMarkdown } = useMarkdownTools();

  const [isLinkEditMode, setIsLinkEditMode] = useState<boolean>(false);
  const {
    settings: { autocomplete },
  } = useSettings();

  const isEditable = useLexicalEditable();
  const signedIn = useSignedIn();

  const [floatingAnchorElem, setFloatingAnchorElem] =
    useState<HTMLDivElement | null>(null);

  const { activeSidebar, setActiveSidebar, toggleSidebar } =
    useSidebarManager();
  const [sharing, setSharing] = useState(false);
  const [currentSidebarWidth, setCurrentSidebarWidth] = useState(SIDEBAR_WIDTH);
  const sidebarRef = useRef<HTMLElement>(null);

  const { markDirty, markPristine, dirty } = useUnsavedChanges();
  const debouncedAutoSaveRef = useRef<ReturnType<typeof debounce> | null>(null);
  const onSyncReplace = useCallback(
    (editorState: EditorState) => {
      // A save still waiting would write the stored state back over whatever
      // lands next.
      debouncedAutoSaveRef.current?.cancel();
      setEditorStateRef(editorState);
      markPristine();
    },
    [setEditorStateRef, markPristine],
  );
  const syncedEditor = useSyncedLexicalEditor(editor, onSyncReplace);
  const onSavesResumed = useCallback(() => {
    // Autosave held the edits while the question stood; without autosave
    // they stay for the user to save.
    if (dirty.current) debouncedAutoSaveRef.current?.();
  }, [dirty]);
  const openDocument = useOpenEntityContext();
  const { holdsSaves } = useOpenEntitySync(openDocument, {
    editor: onScreen ? syncedEditor : null,
    onSavesResumed,
  });
  const { defaultFontFamily, lang } = useDocumentSettings();
  const detectedLanguage = useMemo(
    () => documentLanguage(entity.elements, lang),
    [entity.elements, lang],
  );
  const { enabled: autoSaveEnabled } = useAutoSave({ enabled: canEdit });

  const handleImportMarkdown = useCallback(
    (markdown: string, mode: MarkdownInsertMode) => {
      try {
        insertMarkdown(editor, markdown, mode);
      } catch (error) {
        console.error("[handleImportMarkdown] import error:", error);
        throw error;
      }
    },
    [editor, insertMarkdown],
  );
  const toolbarRef = useRef<HTMLDivElement | null>(null);

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

  // Typing on, or changing the document's font or language, while a save is
  // out leaves edits the save did not take.
  const settings = useRef<SentSettings>({ defaultFontFamily, lang });
  useEffect(() => {
    settings.current = { defaultFontFamily, lang };
  }, [defaultFontFamily, lang]);
  const markSavedIfCaughtUp = useCallback(
    (sent: SentSettings) => {
      const now = settings.current;
      if (
        !holdsLocalEdits(syncedEditor) &&
        sent.defaultFontFamily === now.defaultFontFamily &&
        sent.lang === now.lang
      )
        markPristine();
    },
    [syncedEditor, markPristine],
  );

  // One timer for the session, saving what the latest render holds: a timer
  // made by an earlier render would send its settings over newer ones.
  const autoSave = useRef(() => {});
  useEffect(() => {
    autoSave.current = () => {
      if (holdsSaves()) return;
      handleSilentSave(markSavedIfCaughtUp);
    };
  }, [handleSilentSave, holdsSaves, markSavedIfCaughtUp]);
  useEffect(() => {
    if (!autoSaveEnabled) return;
    const debounced = debounce(() => autoSave.current(), 1000);
    debouncedAutoSaveRef.current = debounced;
    return () => {
      debounced.cancel();
      debouncedAutoSaveRef.current = null;
    };
  }, [autoSaveEnabled]);

  const saveNow = useCallback(() => {
    debouncedAutoSaveRef.current?.cancel();
    handleSave(markSavedIfCaughtUp);
  }, [handleSave, markSavedIfCaughtUp]);
  useSaveShortcut(onScreen && canEdit ? saveNow : null);

  const onChange = (
    editorState: EditorState,
    _editor: unknown,
    tags: Set<string>,
  ) => {
    // A collaborator's state: theirs to send and to save.
    if (tags.has(COLLABORATION_TAG)) return;
    // Someone who cannot edit changes nothing worth keeping or sending: what
    // moves here is a block measuring itself, or a poll vote, which saves on
    // its own.
    if (!canEdit) {
      setEditorStateRef(editorState);
      return;
    }
    const parsedState = JSON.stringify(editorState);
    if (parsedState === JSON.stringify(editorStateRef.current)) {
      return;
    }
    // The first change after loading has nothing to compare with above.
    if (holdsLocalEdits(syncedEditor)) markDirty();
    else markPristine();
    setEditorStateRef(editorState);
    debouncedSendUpdateRef.current(parsedState);
    if (autoSaveEnabled && debouncedAutoSaveRef.current) {
      debouncedAutoSaveRef.current();
    }
  };

  const applyUpdate = useCallback(
    (message: MessageStructure) => {
      if (message.entityType === "document") {
        const editorState = editor.parseEditorState(message.payload.elements);
        setEditorStateRef(editorState);
        editor.setEditorState(editorState, { tag: COLLABORATION_TAG });
      }
    },
    [editor, setEditorStateRef],
  );

  const {
    sendMessage,
    initializeConnection,
    connected: peersConnected,
  } = useWebRtcService(
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

  // External system: the open document's sync, which lets peers' saves pass.
  useEffect(() => {
    openDocument.sync.setPeersConnected(peersConnected);
  }, [openDocument, peersConnected]);

  // Default viewport and caret to the top on initial open (unless deep-linked)
  useEffect(() => {
    if (!window.location.hash) {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    }
    if (!editor.isEditable()) return;
    editor.update(() => {
      $getRoot().selectStart();
    });
  }, [editor]);

  // External system: the page's scroll root. Scrolling to a heading or a
  // hash, and pinning the sidebar, land under the sticky toolbar.
  useEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;
    const root = document.documentElement;
    const observer = new ResizeObserver(() => {
      root.style.setProperty(
        "--page-toolbar-height",
        `${toolbar.getBoundingClientRect().height}px`,
      );
    });
    observer.observe(toolbar);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--page-toolbar-height");
    };
  }, []);

  return (
    <FlashMessageContext>
      <FontResources
        lang={detectedLanguage}
        fonts={[defaultFontFamily || "sans"]}
      />
      <EditorRegistryProvider>
        <ToolbarContext>
          <LLMProvider initialConfig={initialLlmConfig}>
            <ImageGenerationProvider entityId={entity.id} signedIn={signedIn}>
              <LexicalImageGenerationProvider>
                <ImageProvider>
                  <LexicalImageProvider>
                    <CommentPluginProvider>
                      <DocumentFontsPlugin lang={detectedLanguage} />
                      <SlidePlugin />
                      <EditabilityPlugin editable={canEdit && !reading} />
                      {!onScreen && <RenderReadyPlugin />}
                      {/* The page itself scrolls: see globals.css. */}
                      <div
                        data-scroll-root="page"
                        className="page-frame flex min-h-dvh flex-col overflow-x-clip pb-[env(safe-area-inset-bottom)]"
                      >
                        {onScreen && (
                          <div
                            ref={toolbarRef}
                            className="ui-toolbar sticky top-0 left-0 z-10 w-full shrink-0 bg-card pt-[env(safe-area-inset-top)] print:hidden"
                            data-component-name="Toolbar"
                          >
                            {frame && (
                              <EntityAppBar
                                frame={frame}
                                entity={entity}
                                canRename={canEdit}
                                actions={
                                  <>
                                    {frame.isOwner && (
                                      <ShareButton
                                        onClick={() => setSharing(true)}
                                        className="h-9 gap-1.5 px-2.5 max-sm:hidden"
                                      />
                                    )}
                                    <SidebarToggle
                                      label="Comments"
                                      Icon={MessageSquareTextIcon}
                                      on={activeSidebar === "comments"}
                                      onClick={() => toggleSidebar("comments")}
                                    />
                                    <SidebarToggle
                                      label="Table of contents"
                                      Icon={ListTreeIcon}
                                      on={activeSidebar === "toc"}
                                      onClick={() => toggleSidebar("toc")}
                                    />
                                    {canEdit && (
                                      <EditReadSwitch
                                        reading={reading}
                                        onChange={setReading}
                                      />
                                    )}
                                    <OptionsDropdown
                                      className="size-9"
                                      onSave={saveNow}
                                      onShare={
                                        frame.isOwner
                                          ? () => setSharing(true)
                                          : undefined
                                      }
                                      onExportMarkdown={exportMarkdown}
                                      onImportMarkdown={handleImportMarkdown}
                                      entity={{
                                        id: entity.id,
                                        title: entity.title,
                                        accessLevel: entity.accessLevel,
                                      }}
                                    />
                                  </>
                                }
                              />
                            )}
                            {/* The formatting strip is for editing; a
                                reader signed in keeps listening (#93). */}
                            <div
                              className={cn(
                                "flex items-start justify-center gap-2 overflow-x-auto whitespace-nowrap border-b border-border py-2 pl-[max(--spacing(4),env(safe-area-inset-left))] pr-[max(--spacing(4),env(safe-area-inset-right))] md:pl-[max(--spacing(8),env(safe-area-inset-left))] md:pr-[max(--spacing(8),env(safe-area-inset-right))]",
                                !(canEdit && !reading) && !signedIn && "hidden",
                              )}
                            >
                              <ShortcutsPlugin
                                editor={editor}
                                setIsLinkEditMode={setIsLinkEditMode}
                              />
                              <TooltipProvider>
                                <ToolbarPlugin
                                  setIsLinkEditMode={setIsLinkEditMode}
                                />
                              </TooltipProvider>
                            </div>
                            {frame?.isOwner && (
                              <ShareDialog
                                entity={{
                                  id: entity.id,
                                  title: entity.title,
                                  entityType: entity.entityType,
                                  publicAccess: entity.publicAccess,
                                  parentId: frame.parentId,
                                  // Only the owner is offered Share.
                                  userId: frame.account?.id ?? "",
                                }}
                                open={sharing}
                                onOpenChange={setSharing}
                              />
                            )}
                          </div>
                        )}

                        {/* editor + sidebar container */}
                        <div className="flex flex-1 items-start bg-background">
                          {/* editor */}
                          <div className="min-w-0 flex-1 self-stretch flex flex-col">
                            <DisableChecklistSpacebarPlugin />
                            <EmojiPickerPlugin />
                            <LayoutPlugin />
                            {onScreen && <LLMWidget />}
                            <ListPlugin />
                            <ListMaxIndentLevelPlugin />
                            <CheckListPlugin />
                            <MobileCheckListPlugin />
                            <MarkdownShortcutPlugin />
                            <PageBreakPlugin />
                            <CollapsiblePlugin />
                            <CalloutPlugin />
                            <PollPlugin />
                            <CodeHighlightPlugin />
                            <TabIndentationPlugin />
                            {isEditable && autocomplete && signedIn && (
                              <SessionUUIDProvider>
                                <AutocompletePlugin />
                              </SessionUUIDProvider>
                            )}
                            <AutoEmbedPlugin />
                            <AutoLinkPlugin />
                            <HorizontalRulePlugin />
                            <DocumentTablesPlugin />
                            {isEditable && <TableCellResizer />}
                            <ImagePlugin />
                            <InlineImagePlugin />
                            <VideoPlugin />
                            <LinkPlugin />
                            <ClickableLinkPlugin disabled={isEditable} />
                            <TwitterPlugin />
                            <YouTubePlugin />
                            <ExcalidrawPlugin />
                            <MermaidPlugin />
                            <ChartPlugin />
                            <FigmaPlugin />
                            <EquationsPlugin />
                            <ArticlePlugin />
                            <RichTextPlugin
                              contentEditable={
                                <main
                                  id="main-content"
                                  tabIndex={-1}
                                  ref={onRef}
                                  className="relative document-viewport outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                                >
                                  <ContentEditable
                                    id={`lexical-content-${entity.id}`}
                                    aria-label="Document content"
                                    aria-placeholder={PLACEHOLDER}
                                    placeholder={(editable) =>
                                      editable ? (
                                        <div
                                          className="document-placeholder"
                                          style={{
                                            fontFamily:
                                              documentFont(defaultFontFamily)
                                                .family,
                                          }}
                                        >
                                          <div>{PLACEHOLDER}</div>
                                        </div>
                                      ) : null
                                    }
                                    lang={detectedLanguage}
                                    style={{
                                      fontFamily:
                                        documentFont(defaultFontFamily).family,
                                    }}
                                    className="document-content document-typography outline-none"
                                  />
                                </main>
                              }
                              ErrorBoundary={LexicalErrorBoundary}
                            />
                            <OnChangePlugin onChange={onChange} />
                            <HistoryPlugin />
                            {isEditable && <AutoFocusPlugin />}
                            <CodeActionMenuPlugin />
                            {isEditable && floatingAnchorElem && (
                              <>
                                <DraggableBlockPlugin
                                  anchorElem={floatingAnchorElem}
                                />
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
                            {isEditable && <ContextMenuPlugin />}
                          </div>
                          {/* A chat left open by an earlier sign-in stays shut. */}
                          {onScreen &&
                            activeSidebar &&
                            (signedIn || activeSidebar !== "llm") && (
                              <SidebarWrapper
                                key={activeSidebar}
                                ref={sidebarRef}
                                className="print:hidden"
                                onClose={() => {
                                  setActiveSidebar(null);
                                }}
                                title={getSidebarTitle(activeSidebar)}
                                // Reading tools keep one width; the chat's
                                // width is the reader's to choose.
                                resizable={activeSidebar === "llm"}
                                initialWidth={
                                  activeSidebar === "llm"
                                    ? currentSidebarWidth
                                    : SIDEBAR_WIDTH
                                }
                                minWidth={200}
                                maxWidth={800}
                                onWidthChange={
                                  activeSidebar === "llm"
                                    ? setCurrentSidebarWidth
                                    : undefined
                                }
                              >
                                {activeSidebar === "llm" && <LlmChatPlugin />}
                                {activeSidebar === "comments" && <CommentUI />}
                                {activeSidebar === "toc" && (
                                  <TableOfContentsPlugin />
                                )}
                                {activeSidebar === "tree" && <TreeViewPlugin />}
                              </SidebarWrapper>
                            )}
                        </div>

                        {onScreen && <ConditionalCommentInputBoxRenderer />}
                      </div>
                    </CommentPluginProvider>
                  </LexicalImageProvider>
                </ImageProvider>
              </LexicalImageGenerationProvider>
            </ImageGenerationProvider>
          </LLMProvider>
        </ToolbarContext>
      </EditorRegistryProvider>
    </FlashMessageContext>
  );
}

const PLACEHOLDER = "Start writing…";

/** Opens or closes a reading tool's sidebar; in the ⋯ menu on phones. */
function SidebarToggle({
  label,
  Icon,
  on,
  onClick,
}: {
  label: string;
  Icon: LucideIcon;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant={on ? "on" : "ghost"}
      size="icon"
      aria-label={label}
      aria-pressed={on}
      title={label}
      onClick={onClick}
      className="size-9 max-sm:hidden"
    >
      <Icon className="size-5" aria-hidden />
    </Button>
  );
}

type Props = {
  entity: RouterOutputs["entities"]["load"];
  iceServers: RTCIceServer[];
  initialLlmConfig: StoredLlmConfig;
  signedIn: boolean;
  renderMode?: RenderMode;
  frame?: EntityFrame;
};

function EditorScaffold({
  entity,
  editorStateRef,
  setEditorStateRef,
  iceServers,
  initialLlmConfig,
  nodes,
  renderMode,
  frame,
}: {
  frame?: EntityFrame;
  entity: RouterOutputs["entities"]["load"];
  editorStateRef: RefObject<EditorState | undefined>;
  setEditorStateRef: (editorState: EditorState) => void;
  iceServers: RTCIceServer[];
  initialLlmConfig: StoredLlmConfig;
  nodes: Klass<LexicalNode>[];
  renderMode: RenderMode;
}) {
  const openDocument = useOpenEntity(entity, "document");
  const saveAndExport = useSaveAndExportDocument({
    entity,
    editorStateRef,
    openDocument,
  });
  const canEdit = mayEdit(renderMode, entity.accessLevel);
  const saveBeforeLeaving = canEdit
    ? saveAndExport.saveBeforeLeaving
    : undefined;
  const handleSave = canEdit ? saveAndExport.handleSave : () => {};
  const handleSilentSave = canEdit ? saveAndExport.handleSilentSave : () => {};

  return (
    <SettingsProvider>
      <LexicalComposer
        initialConfig={{
          namespace: "Lexidraw",
          editorState: entity.elements,
          onError: (error: unknown) => {
            console.error("Error in LexicalComposer: ", error);
          },
          nodes,
          theme,
          editable: canEdit,
        }}
      >
        <OpenEntityContext value={openDocument}>
          <UnsavedChangesProvider saveBeforeLeaving={saveBeforeLeaving}>
            <SidebarManagerProvider>
              <EditorHandler
                entity={entity}
                iceServers={iceServers}
                initialLlmConfig={initialLlmConfig}
                handleSave={handleSave}
                handleSilentSave={handleSilentSave}
                exportMarkdown={saveAndExport.exportMarkdown}
                editorStateRef={editorStateRef}
                setEditorStateRef={setEditorStateRef}
                renderMode={renderMode}
                frame={frame}
              />
            </SidebarManagerProvider>
          </UnsavedChangesProvider>
        </OpenEntityContext>
      </LexicalComposer>
    </SettingsProvider>
  );
}

export default function DocumentEditor({
  entity,
  iceServers,
  initialLlmConfig,
  signedIn,
  renderMode = "view",
  frame,
}: Props) {
  console.log("🔄 DocumentEditor re-rendered");

  const editorStateRef = useRef<EditorState | undefined>(undefined);
  const setEditorStateRef = useCallback((editorState: EditorState) => {
    editorStateRef.current = editorState;
  }, []);

  const appState = documentSettings(entity.appState);

  const lexicalNodes: Klass<LexicalNode>[] = [
    ...CORE_NODES,
    // The classes below share their types with headless nodes in CORE_NODES.
    // Lexical keeps the last class registered per type and instantiates it
    // everywhere (importJSON, markdown import, $create), so listing the React
    // subclasses after the core set gives every node its component.
    HorizontalRuleNode,
    SlideNode,
    CommentNode,
    ThreadNode,
    ImageNode,
    InlineImageNode,
    VideoNode,
    TweetNode,
    YouTubeNode,
    ExcalidrawNode,
    MermaidNode,
    ChartNode,
    FigmaNode,
    EquationNode,
    PageBreakNode,
    PollNode,
    StickyNode,
    ArticleNode,
  ];

  return (
    <SignedInProvider value={signedIn}>
      <DocumentTitleProvider value={entity.title}>
        <DocumentSettingsProvider
          initialDefaultFontFamily={appState.defaultFontFamily ?? null}
          initialLang={appState.lang ?? null}
        >
          <EditorScaffold
            entity={entity}
            editorStateRef={editorStateRef}
            setEditorStateRef={setEditorStateRef}
            iceServers={iceServers}
            initialLlmConfig={initialLlmConfig}
            nodes={lexicalNodes}
            renderMode={renderMode}
            frame={frame}
          />
        </DocumentSettingsProvider>
      </DocumentTitleProvider>
    </SignedInProvider>
  );
}
