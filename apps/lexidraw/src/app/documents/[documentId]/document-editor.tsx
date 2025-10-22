"use client";

import { z } from "zod";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { debounce } from "@packages/lib";
import { type MessageStructure, PublicAccess } from "@packages/types";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { AutoLinkNode, LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { HorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { MarkNode } from "@lexical/mark";
import { CodeNode, CodeHighlightNode } from "@lexical/code";
import CommentPluginProvider, {
  CommentUI,
  useCommentPlugin,
} from "./plugins/CommentPlugin";
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
import type { EditorState, Klass, LexicalNode } from "lexical";
import { $getRoot } from "lexical";
import { useWebRtcService } from "~/hooks/communication-service/use-web-rtc";
import type { RouterOutputs } from "~/trpc/shared";
import { useUserIdOrGuestId } from "~/hooks/use-user-id-or-guest-id";
import FloatingLinkEditorPlugin from "./plugins/FloatingLinkEditorPlugin";
import AutoEmbedPlugin from "./plugins/AutoEmbedPlugin";
import FloatingTextFormatToolbarPlugin from "./plugins/FloatingTextFormatToolbarPlugin";
import { TableCellNode, TableNode, TableRowNode } from "@lexical/table";
import { TableContext } from "./plugins/TablePlugin";
import TableCellResizer from "./plugins/TableCellResizer";
import TableActionMenuPlugin from "./plugins/TableActionMenuPlugin";
import { ImageNode } from "./nodes/ImageNode/ImageNode";
import ImagePlugin from "./plugins/ImagePlugin";
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
import { CollapsibleContainerNode } from "./plugins/CollapsiblePlugin/CollapsibleContainerNode";
import { CollapsibleContentNode } from "./plugins/CollapsiblePlugin/CollapsibleContentNode";
import { CollapsibleTitleNode } from "./plugins/CollapsiblePlugin/CollapsibleTitleNode";
import { LayoutContainerNode } from "./nodes/LayoutContainerNode";
import { LayoutItemNode } from "./nodes/LayoutItemNode";
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
import {
  LexicalImageProvider,
  ImageProvider,
} from "~/hooks/use-image-insertion";
import VideoPlugin from "./plugins/VideoPlugin";
import { VideoNode } from "./nodes/VideoNode/VideoNode";
import {
  Noto_Sans_JP,
  Inter,
  Ubuntu_Mono,
  M_PLUS_Rounded_1c,
  Yusei_Magic,
  Kosugi_Maru,
  Sawarabi_Mincho,
} from "next/font/google";
import { cn } from "~/lib/utils";
import { useSaveAndExportDocument } from "./context/save-and-export";
import { SidebarWrapper } from "~/components/ui/sidebar-wrapper";
import { CommentInputBox } from "./plugins/CommentPlugin";
import MermaidPlugin from "./plugins/MermaidPlugin";
import { MermaidNode } from "./nodes/MermaidNode";
import {
  DocumentSettingsProvider,
  useDocumentSettings,
} from "./context/document-settings-context";
import { EditorRegistryProvider } from "./context/editors-context";
import ChartPlugin from "./plugins/ChartPlugin";
import { ChartNode } from "./nodes/ChartNode";
import MobileCheckListPlugin from "./plugins/MobileCheckListPlugin";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const mono = Ubuntu_Mono({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-mono",
});

const mplus = M_PLUS_Rounded_1c({
  weight: ["400", "700"],
  subsets: [
    "latin",
    "latin-ext",
    "cyrillic",
    "cyrillic-ext",
    "greek",
    "greek-ext",
    "hebrew",
    "vietnamese",
  ],
  variable: "--font-mplus",
  display: "swap",
});

const noto = Noto_Sans_JP({
  weight: ["400", "700"],
  subsets: ["latin", "latin-ext", "cyrillic", "vietnamese"],
  variable: "--font-noto",
  display: "swap",
});

const yusei = Yusei_Magic({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-yusei",
  display: "swap",
});

const kosugi = Kosugi_Maru({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-kosugi",
  display: "swap",
});

const sawarabi = Sawarabi_Mincho({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-sawarabi",
  display: "swap",
});

type EditorProps = {
  entity: RouterOutputs["entities"]["load"];
  iceServers: RTCIceServer[];
  initialLlmConfig: StoredLlmConfig;
};

type ExtendedEditorProps = EditorProps & {
  handleSave: (onSuccessCallback?: () => void) => void;
  isUploading: boolean;
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

function EditorHandler({
  entity,
  iceServers,
  initialLlmConfig,
  handleSave,
  isUploading,
  editorStateRef,
  setEditorStateRef,
}: ExtendedEditorProps) {
  const canCollaborate =
    entity.sharedWith.length > 0 ||
    entity.publicAccess !== PublicAccess.PRIVATE;
  const userId = useUserIdOrGuestId();
  const [isCollaborating, setIsCollaborating] = useState(false);
  const [isRemoteUpdate, setIsRemoteUpdate] = useState(false);
  const [editor] = useLexicalComposerContext();

  const [isLinkEditMode, setIsLinkEditMode] = useState<boolean>(false);
  const {
    settings: { autocomplete },
  } = useSettings();

  const isEditable = useLexicalEditable();

  const [floatingAnchorElem, setFloatingAnchorElem] =
    useState<HTMLDivElement | null>(null);

  const { activeSidebar, setActiveSidebar } = useSidebarManager();
  const [currentSidebarWidth, setCurrentSidebarWidth] = useState(360);
  const sidebarRef = useRef<HTMLElement>(null);

  const { markDirty } = useUnsavedChanges();
  const { defaultFontFamily } = useDocumentSettings();
  const [dynamicPageStyle, setDynamicPageStyle] = useState<React.CSSProperties>(
    {},
  );
  const [previousDefaultFontFamily, setPreviousDefaultFontFamily] = useState<
    string | null
  >(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

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
    setEditorStateRef(editorState);
    debouncedSendUpdateRef.current(parsedState);
  };

  const applyUpdate = useCallback(
    (message: MessageStructure) => {
      if (message.entityType === "document") {
        setIsRemoteUpdate(true);
        const editorState = editor.parseEditorState(message.payload.elements);
        setEditorStateRef(editorState);
        editor.setEditorState(editorState);
        setIsRemoteUpdate(false);
      }
    },
    [editor, setEditorStateRef],
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

  useEffect(() => {
    if (defaultFontFamily) {
      if (
        previousDefaultFontFamily &&
        previousDefaultFontFamily !== defaultFontFamily
      ) {
        const oldFontSlug = previousDefaultFontFamily
          .trim()
          .toLowerCase()
          .replace(/\s+/g, "-");
        const oldLinkId = `google-font-link-doc-default-${oldFontSlug}`;
        const oldLinkElement = document.getElementById(oldLinkId);
        if (oldLinkElement) {
          oldLinkElement.remove();
        }
      }

      const fontSlug = defaultFontFamily
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "-");
      const linkId = `google-font-link-doc-default-${fontSlug}`;

      if (!document.getElementById(linkId)) {
        const link = document.createElement("link");
        link.id = linkId;
        link.rel = "stylesheet";
        link.href = `https://fonts.googleapis.com/css2?family=${defaultFontFamily.trim().replace(/\s+/g, "+")}:wght@400;700&display=swap`;
        document.head.appendChild(link);
      }
      setDynamicPageStyle({
        fontFamily: `'${defaultFontFamily.trim()}', sans-serif`,
      });
      setPreviousDefaultFontFamily(defaultFontFamily);
    } else {
      if (previousDefaultFontFamily) {
        const oldFontSlug = previousDefaultFontFamily
          .trim()
          .toLowerCase()
          .replace(/\s+/g, "-");
        const oldLinkId = `google-font-link-doc-default-${oldFontSlug}`;
        const oldLinkElement = document.getElementById(oldLinkId);
        if (oldLinkElement) {
          oldLinkElement.remove();
        }
      }
      setDynamicPageStyle({});
      setPreviousDefaultFontFamily(null);
    }
  }, [defaultFontFamily, previousDefaultFontFamily]);

  // Default viewport and caret to the top on initial open (unless deep-linked)
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.location.hash && scrollRef.current) {
      scrollRef.current.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }
    editor.update(() => {
      $getRoot().selectStart();
    });
  }, [editor]);

  return (
    <FlashMessageContext>
      <EditorRegistryProvider>
        <TableContext>
          <ToolbarContext>
            <LLMProvider initialConfig={initialLlmConfig}>
              <ImageGenerationProvider
                initialConfig={initialLlmConfig}
                entityId={entity.id}
              >
                <LexicalImageGenerationProvider>
                  <ImageProvider>
                    <LexicalImageProvider>
                      <CommentPluginProvider>
                        <SlidePlugin />
                        <div
                          style={dynamicPageStyle}
                          className={cn(
                            "page-frame z-0 flex flex-col h-screen overflow-hidden",
                            inter.variable,
                            mono.variable,
                            mplus.variable,
                            noto.variable,
                            yusei.variable,
                            kosugi.variable,
                            sawarabi.variable,
                          )}
                        >
                          {/* toolbar */}
                          <div
                            className="sticky top-0 left-0 z-10 w-full shrink-0 bg-white dark:bg-card shadow-xs flex items-start gap-2 overflow-x-auto whitespace-nowrap px-4 md:px-8 py-2 justify-center border-b border-border"
                            data-component-name="Toolbar"
                          >
                            <OptionsDropdown
                              className="flex h-12 md:h-10 min-w-12 md:min-w-10"
                              onSaveDocument={handleSave}
                              isSavingDocument={isUploading}
                              entity={{
                                id: entity.id,
                                title: entity.title,
                                accessLevel: entity.accessLevel,
                              }}
                            />
                            <ShortcutsPlugin
                              editor={editor}
                              setIsLinkEditMode={setIsLinkEditMode}
                            />
                            <TooltipProvider>
                              <ToolbarPlugin
                                setIsLinkEditMode={setIsLinkEditMode}
                              />
                            </TooltipProvider>
                            <ModeToggle className="hidden md:flex h-12 md:h-10 min-w-12 md:min-w-10" />
                          </div>

                          {/* editor + sidebar container */}
                          <div className="flex flex-1 overflow-hidden bg-muted">
                            {/* editor */}
                            <div
                              ref={scrollRef}
                              className="min-w-0 min-h-0 flex-1 flex flex-col w-full max-w-(--breakpoint-lg) mx-auto overflow-y-auto bg-background border-x border-border"
                            >
                              <DisableChecklistSpacebarPlugin />
                              <EmojiPickerPlugin />
                              <LayoutPlugin />
                              <LLMWidget />
                              <ListPlugin />
                              <ListMaxIndentLevelPlugin />
                              <CheckListPlugin />
                              <MobileCheckListPlugin />
                              <MarkdownShortcutPlugin />
                              <PageBreakPlugin />
                              <CollapsiblePlugin />
                              <PollPlugin />
                              <CodeHighlightPlugin />
                              <TabIndentationPlugin />
                              {autocomplete && (
                                <SessionUUIDProvider>
                                  <AutocompletePlugin />
                                </SessionUUIDProvider>
                              )}
                              <AutoEmbedPlugin />
                              <AutoLinkPlugin />
                              <HorizontalRulePlugin />
                              <TablePlugin
                                hasCellMerge
                                hasCellBackgroundColor
                              />
                              <TableCellResizer />
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
                              <RichTextPlugin
                                contentEditable={
                                  <article ref={onRef} className="relative">
                                    <ContentEditable
                                      id={`lexical-content-${entity.id}`}
                                      className="py-4 px-4 md:px-8 text-foreground outline-muted outline-2 outline-offset-12 min-h-[calc(100svh-4rem)]"
                                    />
                                  </article>
                                }
                                placeholder={<Placeholder />}
                                ErrorBoundary={LexicalErrorBoundary}
                              />
                              <OnChangePlugin onChange={onChange} />
                              <HistoryPlugin />
                              <AutoFocusPlugin />
                              {/* plugins */}
                              {floatingAnchorElem && (
                                <>
                                  <DraggableBlockPlugin
                                    anchorElem={floatingAnchorElem}
                                  />
                                  <CodeActionMenuPlugin
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
                              <ContextMenuPlugin />
                            </div>
                            {activeSidebar && (
                              <SidebarWrapper
                                ref={sidebarRef}
                                className="shadow-lg"
                                onClose={() => {
                                  setActiveSidebar(null);
                                }}
                                title={getSidebarTitle(activeSidebar)}
                                initialWidth={currentSidebarWidth}
                                minWidth={200}
                                maxWidth={800}
                                onWidthChange={setCurrentSidebarWidth}
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

                          <ConditionalCommentInputBoxRenderer />
                        </div>
                      </CommentPluginProvider>
                    </LexicalImageProvider>
                  </ImageProvider>
                </LexicalImageGenerationProvider>
              </ImageGenerationProvider>
            </LLMProvider>
          </ToolbarContext>
        </TableContext>
      </EditorRegistryProvider>
    </FlashMessageContext>
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
  initialLlmConfig: StoredLlmConfig;
};

function EditorScaffold({
  entity,
  editorStateRef,
  setEditorStateRef,
  iceServers,
  initialLlmConfig,
  nodes,
}: {
  entity: RouterOutputs["entities"]["load"];
  editorStateRef: RefObject<EditorState | undefined>;
  setEditorStateRef: (editorState: EditorState) => void;
  iceServers: RTCIceServer[];
  initialLlmConfig: StoredLlmConfig;
  nodes: Klass<LexicalNode>[];
}) {
  const { handleSaveAndLeave, handleSave, isUploading } =
    useSaveAndExportDocument({ entity, editorStateRef });

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
        }}
      >
        <UnsavedChangesProvider onSaveAndLeave={handleSaveAndLeave}>
          <SidebarManagerProvider>
            <EditorHandler
              entity={entity}
              iceServers={iceServers}
              initialLlmConfig={initialLlmConfig}
              handleSave={handleSave}
              isUploading={isUploading}
              editorStateRef={editorStateRef}
              setEditorStateRef={setEditorStateRef}
            />
          </SidebarManagerProvider>
        </UnsavedChangesProvider>
      </LexicalComposer>
    </SettingsProvider>
  );
}

export default function DocumentEditor({
  entity,
  iceServers,
  initialLlmConfig,
}: Props) {
  console.log("🔄 DocumentEditor re-rendered");

  const editorStateRef = useRef<EditorState | undefined>(undefined);
  const setEditorStateRef = useCallback((editorState: EditorState) => {
    editorStateRef.current = editorState;
  }, []);

  const appStateSchema = z.object({
    defaultFontFamily: z.string().optional().nullable(),
  });

  const appState = appStateSchema.parse(JSON.parse(entity.appState ?? "{}"));

  const lexicalNodes: Klass<LexicalNode>[] = [
    SlideNode,
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
    VideoNode,
    AutocompleteNode,
    LinkNode,
    AutoLinkNode,
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
    CollapsibleContainerNode,
    CollapsibleContentNode,
    CollapsibleTitleNode,
    LayoutContainerNode,
    LayoutItemNode,
  ];

  return (
    <DocumentSettingsProvider
      initialDefaultFontFamily={appState.defaultFontFamily ?? null}
    >
      <EditorScaffold
        entity={entity}
        editorStateRef={editorStateRef}
        setEditorStateRef={setEditorStateRef}
        iceServers={iceServers}
        initialLlmConfig={initialLlmConfig}
        nodes={lexicalNodes}
      />
    </DocumentSettingsProvider>
  );
}
