import { createContext, type PropsWithChildren, useContext } from "react";
import { useChatDispatch } from "./llm-chat-context";
import type { RuntimeToolMap } from "../../context/llm-context";
import { useChatTools } from "./tools/agent-helpers";
import { useDocumentEditorTools } from "./tools/document-editor";
import { useSlideTools } from "./tools/slides";
import { useHeadingTools } from "./tools/heading";
import { useTextTools } from "./tools/text";
import { useMarkdownTools } from "./tools/markdown";
import { useListTools } from "./tools/list";
import { useCodeTools } from "./tools/code";
import { useCommentTools } from "./tools/comment";
import { useLinkTools } from "./tools/link";
import { useTableTools } from "./tools/table";
import { useDiagramTools } from "./tools/diagram";
import { useLayoutTools } from "./tools/layout";
import { useCollapsibleTools } from "./tools/collapsible";
import { useEquationTools } from "./tools/equation";
import { useYoutubeTools } from "./tools/youtube";
import { useFigmaTools } from "./tools/figma";
import { usePageBreakTools } from "./tools/pagebreak";
import { useHashtagTools } from "./tools/hashtag";
import { usePollTools } from "./tools/poll";
import { useTweetTools } from "./tools/tweet";
import { useImageTools } from "./tools/image";
import { useCombinedTools } from "./tools/combined-tools";
import { useWebTools } from "./tools/web";
import { WEB_TOOL_LABELS, WEB_TOOL_FORMATTERS } from "./tools/web";
import {
  GLOBAL_TOOL_LABELS,
  GLOBAL_TOOL_FORMATTERS,
  PREFIX_RULES,
} from "./tools-meta";

const RuntimeToolsCtx = createContext<RuntimeToolMap | null>(null);
type ToolMeta = {
  labels: Record<string, string | undefined>;
  formatters: Record<
    string,
    (args: Record<string, unknown>) => string | undefined
  >;
  getDisplay: (
    toolName: string,
    args: Record<string, unknown> | undefined,
  ) => string | null;
};
const ToolMetaCtx = createContext<ToolMeta | null>(null);

export function RuntimeToolsProvider({ children }: PropsWithChildren) {
  const dispatch = useChatDispatch();

  const { requestClarificationOrPlan, summarizeExecution, sendReply } =
    useChatTools({ dispatch });

  const { patchNodeByJSON, removeNode, moveNode } = useDocumentEditorTools();

  const {
    insertSlideDeckNode,
    setDeckMetadata,
    setSlideMetadata,
    addSlidePage,
    addBoxToSlidePage,
    removeSlidePage,
    reorderSlidePage,
    setSlidePageBackground,
    updateElementProperties,
    addImageToSlidePage,
    addChartToSlidePage,
    saveStoryboardOutput,
    saveSlideContentAndMetadata,
    saveDeckTheme,
    saveAudienceDataTool,
    generateAndAddImageToSlidePage,
    searchAndAddImageToSlidePage,
  } = useSlideTools();
  const { insertLayout } = useLayoutTools();
  const { insertCollapsibleSection } = useCollapsibleTools();
  const { insertHeadingNode } = useHeadingTools();
  const { insertTextNode, applyTextStyle } = useTextTools();
  const { insertMarkdown } = useMarkdownTools();
  const { insertListNode, insertListItemNode } = useListTools();
  const { insertCodeBlock, insertCodeHighlightNode } = useCodeTools();
  const {
    findAndSelectTextForComment,
    addCommentThread,
    addReplyToThread,
    removeCommentFromThread,
    removeCommentThread,
  } = useCommentTools();
  const { insertLinkNode } = useLinkTools();
  const { insertTable } = useTableTools();
  const { insertEquationNode } = useEquationTools();
  const { insertExcalidrawDiagram, insertMermaidDiagram } = useDiagramTools();
  const { insertYouTubeNode } = useYoutubeTools();
  const { insertFigmaNode } = useFigmaTools();
  const { insertPageBreakNode } = usePageBreakTools();
  const { insertHashtag } = useHashtagTools();
  const { insertPollNode } = usePollTools();
  const { insertTweetNode } = useTweetTools();
  const { searchAndInsertImage, generateAndInsertImage } = useImageTools();
  const { googleSearch, extractWebpageContent } = useWebTools();

  const individualTools = {
    ...(patchNodeByJSON && { patchNodeByJSON }),
    ...(insertTextNode && { insertTextNode }),
    ...(insertHeadingNode && { insertHeadingNode }),
    ...(insertLinkNode && { insertLinkNode }),
    ...(insertEquationNode && { insertEquationNode }),
    ...(insertFigmaNode && { insertFigmaNode }),
    ...(insertCollapsibleSection && { insertCollapsibleSection }),
    ...(insertExcalidrawDiagram && { insertExcalidrawDiagram }),
    ...(insertMermaidDiagram && { insertMermaidDiagram }),
    ...(insertLayout && { insertLayout }),
    ...(insertPageBreakNode && { insertPageBreakNode }),
    ...(insertPollNode && { insertPollNode }),
    ...(insertTweetNode && { insertTweetNode }),
    ...(insertYouTubeNode && { insertYouTubeNode }),
    ...(insertSlideDeckNode && { insertSlideDeckNode }),
    ...(addSlidePage && { addSlidePage }),
    ...(removeSlidePage && { removeSlidePage }),
    ...(reorderSlidePage && { reorderSlidePage }),
    ...(addBoxToSlidePage && { addBoxToSlidePage }),
    ...(setSlidePageBackground && { setSlidePageBackground }),
    ...(addImageToSlidePage && { addImageToSlidePage }),
    ...(addChartToSlidePage && { addChartToSlidePage }),
    ...(insertListNode && { insertListNode }),
    ...(insertListItemNode && { insertListItemNode }),
    ...(insertCodeBlock && { insertCodeBlock }),
    ...(insertCodeHighlightNode && { insertCodeHighlightNode }),
    ...(insertMarkdown && { insertMarkdown }),
    ...(insertTable && { insertTable }),
    ...(insertHashtag && { insertHashtag }),
    ...(applyTextStyle && { applyTextStyle }),
    ...(removeNode && { removeNode }),
    ...(moveNode && { moveNode }),
    ...(requestClarificationOrPlan && { requestClarificationOrPlan }),
    ...(summarizeExecution && { summarizeExecution }),
    ...(searchAndInsertImage && { searchAndInsertImage }),
    ...(generateAndInsertImage && { generateAndInsertImage }),
    ...(googleSearch && { googleSearch }),
    ...(extractWebpageContent && { extractWebpageContent }),
    ...(sendReply && { sendReply }),
    ...(addCommentThread && { addCommentThread }),
    ...(addReplyToThread && { addReplyToThread }),
    ...(findAndSelectTextForComment && { findAndSelectTextForComment }),
    ...(removeCommentFromThread && { removeCommentFromThread }),
    ...(removeCommentThread && { removeCommentThread }),
    ...(setDeckMetadata && { setDeckMetadata }),
    ...(setSlideMetadata && { setSlideMetadata }),
    ...(saveStoryboardOutput && { saveStoryboardOutput }),
    ...(updateElementProperties && { updateElementProperties }),
    ...(addImageToSlidePage && { addImageToSlidePage }),
    ...(addChartToSlidePage && { addChartToSlidePage }),
    ...(generateAndAddImageToSlidePage && { generateAndAddImageToSlidePage }),
    ...(searchAndAddImageToSlidePage && { searchAndAddImageToSlidePage }),
    ...(saveStoryboardOutput && { saveStoryboardOutput }),
    ...(saveSlideContentAndMetadata && { saveSlideContentAndMetadata }),
    ...(saveDeckTheme && { saveDeckTheme }),
    ...(saveAudienceDataTool && { saveAudienceDataTool }),
  } as unknown as RuntimeToolMap;

  const { combinedTools, webResearch } = useCombinedTools(individualTools);

  const tools = {
    ...individualTools,
    combinedTools,
    webResearch,
  } as unknown as RuntimeToolMap;

  // Aggregate global + per-module tool labels/formatters.
  const labels: Record<string, string | undefined> = {
    ...GLOBAL_TOOL_LABELS,
    ...WEB_TOOL_LABELS,
  };
  const formatters: Record<
    string,
    (args: Record<string, unknown>) => string | undefined
  > = {
    ...GLOBAL_TOOL_FORMATTERS,
    ...WEB_TOOL_FORMATTERS,
  };

  const getDisplay = (
    toolName: string,
    args: Record<string, unknown> | undefined,
  ): string | null => {
    // If explicitly undefined label, suppress chat surfacing for this tool
    if (toolName in labels && labels[toolName] === undefined) {
      return null;
    }
    const fmt = formatters[toolName];
    if (typeof fmt === "function") {
      const out = fmt(args ?? {});
      if (out === undefined) return null;
      return out;
    }
    const label = labels[toolName];
    if (typeof label === "string") return label;
    // Prefix rules to render generic names
    const rule = PREFIX_RULES.find((r) => r.test(toolName));
    if (rule) return rule.render(toolName);
    // Fallback: convert camelCase/PascalCase to Title Case
    const title = toolName
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      .replace(/^\w/, (m) => m.toUpperCase());
    return title;
  };

  return (
    <RuntimeToolsCtx.Provider value={tools}>
      <ToolMetaCtx.Provider value={{ labels, formatters, getDisplay }}>
        {children}
      </ToolMetaCtx.Provider>
    </RuntimeToolsCtx.Provider>
  );
}

export function useRuntimeTools() {
  const tools = useContext(RuntimeToolsCtx);
  if (!tools) {
    throw new Error("RuntimeToolsProvider not found");
  }
  return tools;
}

export function useToolMeta() {
  const meta = useContext(ToolMetaCtx);
  if (!meta) throw new Error("ToolMeta context not found");
  return meta;
}
