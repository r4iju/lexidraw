import { INSERT_EMBED_COMMAND } from "@lexical/react/LexicalAutoEmbedPlugin";
import { INSERT_HORIZONTAL_RULE_COMMAND } from "@lexical/react/LexicalHorizontalRuleNode";
import type { TOGGLE_LEVELS } from "@packages/types";
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  type LexicalEditor,
} from "lexical";
import {
  ChartColumn,
  Columns3,
  Film,
  Heading1,
  Heading2,
  Heading3,
  Image,
  ImagePlus,
  Info,
  ListCollapse,
  type LucideIcon,
  PencilRuler,
  SeparatorHorizontal,
  Sigma,
  SquareSplitVertical,
  StickyNote,
  Table,
  VideoIcon,
  Vote,
  Workflow,
} from "lucide-react";
import type { JSX } from "react";
import { StickyNode } from "../nodes/StickyNode";
import { useEmbedConfigs } from "./AutoEmbedPlugin";
import type { BlockEntry } from "./block-search";
import InsertCalloutDialog from "./CalloutPlugin/InsertCalloutDialog";
import { INSERT_CHART_COMMAND } from "./ChartPlugin";
import { INSERT_COLLAPSIBLE_COMMAND } from "./CollapsiblePlugin";
import { InsertEquationDialog } from "./EquationsPlugin";
import { INSERT_EXCALIDRAW_COMMAND } from "./ExcalidrawPlugin";
import { InsertImageDialog } from "./ImagePlugin";
import { INSERT_IMAGE_COMMAND } from "./ImagePlugin/commands";
import { InsertInlineImageDialog } from "./InlineImagePlugin";
import InsertLayoutDialog from "./LayoutPlugin/InsertLayoutDialog";
import { INSERT_MERMAID_COMMAND } from "./MermaidPlugin";
import { INSERT_PAGE_BREAK } from "./PageBreakPlugin";
import { InsertPollDialog } from "./PollPlugin";
import { InsertTableDialog } from "./TablePlugin";
import { BLOCK_TYPES, type BlockType } from "./ToolbarPlugin/block-format";
import { OPEN_INSERT_VIDEO_DIALOG_COMMAND } from "./VideoPlugin";

export type ShowModal = (
  title: string,
  content: (onClose: () => void) => JSX.Element,
) => void;

const EMBED_LABELS: Record<string, string> = {
  "youtube-video": "YouTube",
  tweet: "Tweet",
  figma: "Figma",
  article: "Article",
};
const EMBED_ORDER = Object.keys(EMBED_LABELS);

/** Each toggle's own, as no two insert items share an icon. */
const TOGGLE_ICONS = {
  paragraph: ListCollapse,
  h1: Heading1,
  h2: Heading2,
  h3: Heading3,
} satisfies Record<(typeof TOGGLE_LEVELS)[number], LucideIcon>;

/** What else each block type is found by, beyond its label. */
const BLOCK_TYPE_KEYWORDS: Record<BlockType, readonly string[]> = {
  paragraph: ["text", "paragraph", "plain"],
  h1: ["h1", "title", "heading"],
  h2: ["h2", "subtitle", "heading"],
  h3: ["h3", "heading"],
  h4: ["h4", "heading"],
  bullet: ["ul", "unordered", "bullets"],
  number: ["ol", "ordered", "numbers"],
  check: ["todo", "to-do", "task", "checkbox"],
  toggle: ["collapsible", "details", "fold", "expand"],
  "toggle-h1": ["collapsible", "fold"],
  "toggle-h2": ["collapsible", "fold"],
  "toggle-h3": ["collapsible", "fold"],
  quote: ["blockquote", "citation"],
  code: ["snippet", "pre", "programming"],
};

function icon(Icon: LucideIcon) {
  return <Icon className="size-4" />;
}

/**
 * The block types the block holding the caret can become, keeping its text:
 * the slash menu's Text group. `setBlockType` is the toolbar's.
 */
export function turnIntoEntries(
  setBlockType: (type: BlockType) => void,
): BlockEntry[] {
  return BLOCK_TYPES.map(({ type, label, icon: Icon }) => ({
    id: type,
    label,
    group: "Text",
    keywords: BLOCK_TYPE_KEYWORDS[type],
    icon: icon(Icon),
    run: () => setBlockType(type),
  }));
}

/**
 * Every block that can be inserted, in their groups' order: the Insert menu,
 * and the slash menu after its Text group. A toggle's id is its block type's.
 */
export function useInsertEntries(
  editor: LexicalEditor,
  showModal: ShowModal,
): BlockEntry[] {
  const embeds = useEmbedConfigs();
  const dialog =
    (title: string, render: (onClose: () => void) => JSX.Element) => () =>
      showModal(title, render);

  return [
    {
      id: "divider",
      label: "Divider",
      group: "Basic",
      keywords: ["hr", "horizontal rule", "line", "separator"],
      icon: icon(SeparatorHorizontal),
      run: () =>
        editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined),
    },
    {
      id: "page-break",
      label: "Page break",
      group: "Basic",
      keywords: ["print", "new page"],
      icon: icon(SquareSplitVertical),
      run: () => editor.dispatchCommand(INSERT_PAGE_BREAK, undefined),
    },
    {
      id: "table",
      label: "Table",
      group: "Basic",
      keywords: ["grid", "rows", "spreadsheet"],
      icon: icon(Table),
      run: dialog("Insert table", (onClose) => (
        <InsertTableDialog activeEditor={editor} onClose={onClose} />
      )),
    },
    {
      id: "columns",
      label: "Columns",
      group: "Basic",
      keywords: ["layout", "side by side"],
      icon: icon(Columns3),
      run: dialog("Insert columns", (onClose) => (
        <InsertLayoutDialog activeEditor={editor} onClose={onClose} />
      )),
    },
    ...BLOCK_TYPES.flatMap((option): BlockEntry[] =>
      "toggle" in option
        ? [
            {
              id: option.type,
              label: option.label,
              group: "Basic",
              keywords: BLOCK_TYPE_KEYWORDS[option.type],
              icon: icon(TOGGLE_ICONS[option.toggle]),
              run: () =>
                editor.dispatchCommand(
                  INSERT_COLLAPSIBLE_COMMAND,
                  option.toggle,
                ),
            },
          ]
        : [],
    ),
    {
      id: "callout",
      label: "Callout",
      group: "Basic",
      keywords: ["note", "info", "tip", "warning", "admonition"],
      icon: icon(Info),
      run: dialog("Insert callout", (onClose) => (
        <InsertCalloutDialog activeEditor={editor} onClose={onClose} />
      )),
    },
    {
      id: "image",
      label: "Image",
      group: "Media",
      keywords: ["picture", "photo", "upload"],
      icon: icon(Image),
      run: dialog("Insert image", (onClose) => (
        <InsertImageDialog
          activeEditor={editor}
          onClose={onClose}
          onInsert={(payload) => {
            editor.dispatchCommand(INSERT_IMAGE_COMMAND, payload);
            onClose();
          }}
        />
      )),
    },
    {
      id: "inline-image",
      label: "Inline image",
      group: "Media",
      keywords: ["picture", "photo"],
      icon: icon(ImagePlus),
      run: dialog("Insert inline image", (onClose) => (
        <InsertInlineImageDialog activeEditor={editor} onClose={onClose} />
      )),
    },
    {
      id: "gif",
      label: "GIF",
      group: "Media",
      keywords: ["animation"],
      icon: icon(Film),
      run: () =>
        editor.dispatchCommand(INSERT_IMAGE_COMMAND, {
          altText: "Cat typing on a laptop",
          src: "/images/cat-typing.gif",
        }),
    },
    {
      id: "video",
      label: "Video",
      group: "Media",
      keywords: ["movie", "film", "mp4"],
      icon: icon(VideoIcon),
      run: () =>
        editor.dispatchCommand(OPEN_INSERT_VIDEO_DIALOG_COMMAND, undefined),
    },
    {
      id: "excalidraw",
      label: "Excalidraw",
      group: "Diagrams and data",
      keywords: ["drawing", "sketch", "whiteboard"],
      icon: icon(PencilRuler),
      run: () => editor.dispatchCommand(INSERT_EXCALIDRAW_COMMAND, undefined),
    },
    {
      id: "mermaid",
      label: "Mermaid",
      group: "Diagrams and data",
      keywords: ["diagram", "flowchart", "sequence"],
      icon: icon(Workflow),
      run: () => editor.dispatchCommand(INSERT_MERMAID_COMMAND, undefined),
    },
    {
      id: "chart",
      label: "Chart",
      group: "Diagrams and data",
      keywords: ["graph", "plot", "bar"],
      icon: icon(ChartColumn),
      run: () =>
        editor.dispatchCommand(INSERT_CHART_COMMAND, {
          type: "bar",
          data: "[]",
          config: "{}",
          width: "inherit",
          height: "inherit",
        }),
    },
    {
      id: "equation",
      label: "Equation",
      group: "Diagrams and data",
      keywords: ["math", "latex", "katex", "formula"],
      icon: icon(Sigma),
      run: dialog("Insert equation", (onClose) => (
        <InsertEquationDialog activeEditor={editor} onClose={onClose} />
      )),
    },
    ...embeds
      .filter((embed) => embed.type in EMBED_LABELS)
      .sort((a, b) => EMBED_ORDER.indexOf(a.type) - EMBED_ORDER.indexOf(b.type))
      .map(
        (embed): BlockEntry => ({
          id: embed.type,
          label: EMBED_LABELS[embed.type] ?? embed.contentName,
          group: "Embeds",
          keywords: ["embed", ...embed.keywords],
          icon: embed.icon,
          run: () => editor.dispatchCommand(INSERT_EMBED_COMMAND, embed.type),
        }),
      ),
    {
      id: "poll",
      label: "Poll",
      group: "Interactive",
      keywords: ["vote", "survey"],
      icon: icon(Vote),
      run: dialog("Insert poll", (onClose) => (
        <InsertPollDialog activeEditor={editor} onClose={onClose} />
      )),
    },
    {
      id: "sticky-note",
      label: "Sticky note",
      group: "Interactive",
      keywords: ["note", "post-it"],
      icon: icon(StickyNote),
      run: () =>
        editor.update(() => {
          const selection = $getSelection();
          const sticky = StickyNode.$createStickyNode(0, 0);
          if ($isRangeSelection(selection)) selection.insertNodes([sticky]);
          else $getRoot().append(sticky);
        }),
    },
  ];
}
