import { INSERT_EMBED_COMMAND } from "@lexical/react/LexicalAutoEmbedPlugin";
import { INSERT_HORIZONTAL_RULE_COMMAND } from "@lexical/react/LexicalHorizontalRuleNode";
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
  Image,
  ImagePlus,
  Info,
  ListCollapse,
  type LucideIcon,
  PencilRuler,
  Plus,
  Presentation,
  SeparatorHorizontal,
  Sigma,
  SquareSplitVertical,
  StickyNote,
  Table,
  VideoIcon,
  Vote,
  Workflow,
} from "lucide-react";
import { Fragment, type JSX, type ReactNode } from "react";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "~/components/ui/dropdown-menu";
import { StickyNode } from "../../nodes/StickyNode";
import { useEmbedConfigs } from "../AutoEmbedPlugin";
import InsertCalloutDialog from "../CalloutPlugin/InsertCalloutDialog";
import { INSERT_CHART_COMMAND } from "../ChartPlugin";
import { INSERT_COLLAPSIBLE_COMMAND } from "../CollapsiblePlugin";
import { InsertEquationDialog } from "../EquationsPlugin";
import { INSERT_EXCALIDRAW_COMMAND } from "../ExcalidrawPlugin";
import { InsertImageDialog } from "../ImagePlugin";
import { INSERT_IMAGE_COMMAND } from "../ImagePlugin/commands";
import { InsertInlineImageDialog } from "../InlineImagePlugin";
import InsertLayoutDialog from "../LayoutPlugin/InsertLayoutDialog";
import { INSERT_MERMAID_COMMAND } from "../MermaidPlugin";
import { INSERT_PAGE_BREAK } from "../PageBreakPlugin";
import { InsertPollDialog } from "../PollPlugin";
import { INSERT_SLIDEDECK_COMMAND } from "../SlidePlugin";
import { InsertTableDialog } from "../TablePlugin";
import { OPEN_INSERT_VIDEO_DIALOG_COMMAND } from "../VideoPlugin";
import { ToolbarMenu } from "./toolbar";

export type ShowModal = (
  title: string,
  content: (onClose: () => void) => JSX.Element,
) => void;

type Insertable = { label: string; icon: ReactNode; insert: () => void };

const EMBED_LABELS: Record<string, string> = {
  "youtube-video": "YouTube",
  tweet: "Tweet",
  figma: "Figma",
  article: "Article",
};
const EMBED_ORDER = Object.keys(EMBED_LABELS);

function icon(Icon: LucideIcon) {
  return <Icon className="size-4" />;
}

/** Everything that can be inserted, in labelled groups. */
export function InsertItems({
  editor,
  showModal,
  query = "",
}: {
  editor: LexicalEditor;
  showModal: ShowModal;
  /** Leaves out what doesn't match. */
  query?: string;
}) {
  const embeds = useEmbedConfigs();
  const dialog =
    (title: string, render: (onClose: () => void) => JSX.Element) => () =>
      showModal(title, render);

  const groups: [string, Insertable[]][] = [
    [
      "Basic",
      [
        {
          label: "Divider",
          icon: icon(SeparatorHorizontal),
          insert: () =>
            editor.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined),
        },
        {
          label: "Page break",
          icon: icon(SquareSplitVertical),
          insert: () => editor.dispatchCommand(INSERT_PAGE_BREAK, undefined),
        },
        {
          label: "Table",
          icon: icon(Table),
          insert: dialog("Insert table", (onClose) => (
            <InsertTableDialog activeEditor={editor} onClose={onClose} />
          )),
        },
        {
          label: "Columns",
          icon: icon(Columns3),
          insert: dialog("Insert columns", (onClose) => (
            <InsertLayoutDialog activeEditor={editor} onClose={onClose} />
          )),
        },
        {
          label: "Collapsible",
          icon: icon(ListCollapse),
          insert: () =>
            editor.dispatchCommand(INSERT_COLLAPSIBLE_COMMAND, undefined),
        },
        {
          label: "Callout",
          icon: icon(Info),
          insert: dialog("Insert callout", (onClose) => (
            <InsertCalloutDialog activeEditor={editor} onClose={onClose} />
          )),
        },
      ],
    ],
    [
      "Media",
      [
        {
          label: "Image",
          icon: icon(Image),
          insert: dialog("Insert image", (onClose) => (
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
          label: "Inline image",
          icon: icon(ImagePlus),
          insert: dialog("Insert inline image", (onClose) => (
            <InsertInlineImageDialog activeEditor={editor} onClose={onClose} />
          )),
        },
        {
          label: "GIF",
          icon: icon(Film),
          insert: () =>
            editor.dispatchCommand(INSERT_IMAGE_COMMAND, {
              altText: "Cat typing on a laptop",
              src: "/images/cat-typing.gif",
            }),
        },
        {
          label: "Video",
          icon: icon(VideoIcon),
          insert: () =>
            editor.dispatchCommand(OPEN_INSERT_VIDEO_DIALOG_COMMAND, undefined),
        },
      ],
    ],
    [
      "Diagrams and data",
      [
        {
          label: "Excalidraw",
          icon: icon(PencilRuler),
          insert: () =>
            editor.dispatchCommand(INSERT_EXCALIDRAW_COMMAND, undefined),
        },
        {
          label: "Mermaid",
          icon: icon(Workflow),
          insert: () =>
            editor.dispatchCommand(INSERT_MERMAID_COMMAND, undefined),
        },
        {
          label: "Chart",
          icon: icon(ChartColumn),
          insert: () =>
            editor.dispatchCommand(INSERT_CHART_COMMAND, {
              type: "bar",
              data: "[]",
              config: "{}",
              width: "inherit",
              height: "inherit",
            }),
        },
        {
          label: "Equation",
          icon: icon(Sigma),
          insert: dialog("Insert equation", (onClose) => (
            <InsertEquationDialog activeEditor={editor} onClose={onClose} />
          )),
        },
        {
          label: "Slide deck",
          icon: icon(Presentation),
          insert: () =>
            editor.dispatchCommand(INSERT_SLIDEDECK_COMMAND, undefined),
        },
      ],
    ],
    [
      "Embeds",
      embeds
        .filter((embed) => embed.type in EMBED_LABELS)
        .sort(
          (a, b) => EMBED_ORDER.indexOf(a.type) - EMBED_ORDER.indexOf(b.type),
        )
        .map((embed) => ({
          label: EMBED_LABELS[embed.type] ?? embed.contentName,
          icon: embed.icon,
          insert: () =>
            editor.dispatchCommand(INSERT_EMBED_COMMAND, embed.type),
        })),
    ],
    [
      "Interactive",
      [
        {
          label: "Poll",
          icon: icon(Vote),
          insert: dialog("Insert poll", (onClose) => (
            <InsertPollDialog activeEditor={editor} onClose={onClose} />
          )),
        },
        {
          label: "Sticky note",
          icon: icon(StickyNote),
          insert: () =>
            editor.update(() => {
              const selection = $getSelection();
              const sticky = StickyNode.$createStickyNode(0, 0);
              if ($isRangeSelection(selection)) selection.insertNodes([sticky]);
              else $getRoot().append(sticky);
            }),
        },
      ],
    ],
  ];

  const wanted = query.trim().toLowerCase();
  const shown = groups
    .map(
      ([label, items]) =>
        [
          label,
          items.filter((item) => item.label.toLowerCase().includes(wanted)),
        ] as const,
    )
    .filter(([, items]) => items.length > 0);
  if (shown.length === 0)
    return (
      <p className="px-2 py-3 text-sm text-muted-foreground">
        Nothing to insert matches “{query.trim()}”.
      </p>
    );
  return shown.map(([label, items], index) => (
    <Fragment key={label}>
      {index > 0 && <DropdownMenuSeparator />}
      <DropdownMenuGroup aria-label={label}>
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {label}
        </DropdownMenuLabel>
        {items.map((item) => (
          <DropdownMenuItem
            key={item.label}
            className="gap-2"
            onSelect={item.insert}
          >
            {item.icon}
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuGroup>
    </Fragment>
  ));
}

export function InsertMenu({
  editor,
  disabled,
  showModal,
}: {
  editor: LexicalEditor;
  disabled?: boolean;
  showModal: ShowModal;
}) {
  return (
    <ToolbarMenu
      label="Insert"
      icon={Plus}
      trigger={<span className="hidden sm:inline">Insert</span>}
      disabled={disabled}
      contentClassName="min-w-52"
    >
      <InsertItems editor={editor} showModal={showModal} />
    </ToolbarMenu>
  );
}
