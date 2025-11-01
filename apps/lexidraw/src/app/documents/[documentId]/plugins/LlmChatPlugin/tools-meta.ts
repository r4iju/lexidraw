// Central registry for tool labels/formatters and naming heuristics.
// Setting a label to undefined suppresses chat surfacing for that tool.

export const GLOBAL_TOOL_LABELS: Record<string, string | undefined> = {
  // Chat-producing or terminal tools — suppress surfacing
  sendReply: undefined,
  summarizeAfterToolCallExecution: undefined,
  planNextToolSelection: undefined,

  // General tools
  requestClarificationOrPlan: "Request clarification",
  combinedTools: "Batch tools",
  webResearch: "Web research",

  // Editor insert/manipulation
  insertTextNode: "Insert text",
  insertHeadingNode: "Insert heading",
  insertMarkdown: "Insert Markdown",
  insertListNode: "Insert list",
  insertListItemNode: "Insert list item",
  insertTable: "Insert table",
  insertLinkNode: "Insert link",
  insertCodeBlock: "Insert code block",
  insertCodeHighlightNode: "Insert code snippet",
  insertEquationNode: "Insert equation",
  insertCollapsibleSection: "Insert collapsible section",
  insertLayout: "Insert layout",
  insertPageBreakNode: "Insert page break",
  insertFigmaNode: "Insert Figma embed",
  insertYouTubeNode: "Insert YouTube embed",
  insertExcalidrawDiagram: "Insert Excalidraw diagram",
  insertMermaidDiagram: "Insert Mermaid diagram",
  insertHashtag: "Insert hashtag",

  // Slide tools
  insertSlideDeckNode: "Insert slide deck",
  addSlidePage: "Add slide page",
  removeSlidePage: "Remove slide page",
  reorderSlidePage: "Reorder slide pages",
  addBoxToSlidePage: "Add box to slide",
  setSlidePageBackground: "Set slide background",
  addImageToSlidePage: "Add image to slide",
  generateAndAddImageToSlidePage: "Generate image for slide",
  searchAndAddImageToSlidePage: "Search image for slide",
  addChartToSlidePage: "Add chart to slide",
  setDeckMetadata: "Update deck metadata",
  setSlideMetadata: "Update slide metadata",
  saveStoryboardOutput: "Save storyboard",
  saveSlideContentAndMetadata: "Save slide content",
  saveDeckTheme: "Save deck theme",
  saveAudienceDataTool: "Save audience data",
  updateElementProperties: "Update element properties",

  // Document editing
  patchNodeByJSON: "Patch node",
  removeNode: "Remove node",
  moveNode: "Move node",
  applyTextStyle: "Apply text style",

  // Comments
  addCommentThread: "Add comment thread",
  addReplyToThread: "Add comment reply",
  findAndSelectTextForComment: "Select text for comment",
  removeCommentFromThread: "Remove comment",
  removeCommentThread: "Remove comment thread",

  // Images/search (if not covered by slide-specific tools)
  searchAndInsertImage: "Search image",
  generateAndInsertImage: "Generate image",
};

export const GLOBAL_TOOL_FORMATTERS: Record<
  string,
  (args: Record<string, unknown>) => string | undefined
> = {
  insertHeadingNode: (args) => {
    const tagVal = (args as Record<string, unknown>)?.tag;
    const tag = typeof tagVal === "string" ? tagVal : undefined;
    if (!tag) return "Insert heading";
    return `Insert ${tag.toUpperCase()} heading`;
  },
  insertMarkdown: (args) => {
    const textVal = (args as Record<string, unknown>)?.markdownText;
    const text = typeof textVal === "string" ? textVal : undefined;
    if (typeof text === "string") {
      const len = text.length;
      return `Insert Markdown (${len} chars)`;
    }
    return "Insert Markdown";
  },
};

// Heuristic prefix rules to generate a nice label when no explicit one is present.
export const PREFIX_RULES: Array<{
  test: (name: string) => boolean;
  render: (name: string) => string;
}> = [
  {
    test: (n) => n.startsWith("insert"),
    render: (n) => `Insert ${stripAffixes(n.slice("insert".length))}`,
  },
  {
    test: (n) => n.startsWith("add"),
    render: (n) => `Add ${stripAffixes(n.slice("add".length))}`,
  },
  {
    test: (n) => n.startsWith("set"),
    render: (n) => `Update ${stripAffixes(n.slice("set".length))}`,
  },
  {
    test: (n) => n.startsWith("remove"),
    render: (n) => `Remove ${stripAffixes(n.slice("remove".length))}`,
  },
  {
    test: (n) => n.startsWith("search"),
    render: (n) => `Search ${stripAffixes(n.slice("search".length))}`,
  },
];

function stripAffixes(raw: string): string {
  const s = raw.replace(/^(Node|Tool)/i, "").replace(/(Node|Tool)$/i, "");
  // camelCase to words, trim & Title Case first letter
  const spaced = s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  if (!spaced.length) return spaced;
  const first = spaced.charAt(0);
  return first.toUpperCase() + spaced.slice(1);
}
