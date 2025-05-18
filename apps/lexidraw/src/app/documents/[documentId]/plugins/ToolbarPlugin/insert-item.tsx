import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Button } from "~/components/ui/button";
import {
  Plus,
  VideoIcon,
  Minus,
  FileText,
  Image,
  Gift,
  PencilRuler,
  Table,
  Vote,
  Columns,
  Sigma,
  StickyNote,
  ChevronRight,
  Settings,
  ChartScatter,
} from "lucide-react";
import { INSERT_HORIZONTAL_RULE_COMMAND } from "@lexical/react/LexicalHorizontalRuleNode";
import { INSERT_EMBED_COMMAND } from "@lexical/react/LexicalAutoEmbedPlugin";
import { INSERT_PAGE_BREAK } from "../PageBreakPlugin";
import { INSERT_EXCALIDRAW_COMMAND } from "../ExcalidrawPlugin";
import { INSERT_MERMAID_COMMAND } from "../MermaidPlugin";
import { INSERT_COLLAPSIBLE_COMMAND } from "../CollapsiblePlugin";
import { $getRoot, LexicalEditor } from "lexical";
import { InsertImageDialog, InsertImagePayload } from "../ImagesPlugin";
import useModal from "~/hooks/useModal";
import { InsertInlineImageDialog } from "../InlineImagePlugin";
import { InsertTableDialog } from "../TablePlugin";
import { InsertPollDialog } from "../PollPlugin";
import InsertLayoutDialog from "../LayoutPlugin/InsertLayoutDialog";
import { InsertEquationDialog } from "../EquationsPlugin";
import { StickyNode } from "../../nodes/StickyNode";
import { useEmbedConfigs } from "../AutoEmbedPlugin";
import { INSERT_IMAGE_COMMAND } from "../ImagesPlugin/commands";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  OPEN_INSERT_VIDEO_DIALOG_COMMAND,
  InsertVideoSettingsDialog,
} from "../VideosPlugin";

// -------------------------------------------------------------------------------------------------
// TODO: fix style
// -------------------------------------------------------------------------------------------------

type InsertItemProps = {
  activeEditor: LexicalEditor;
  isEditable: boolean;
};

export function InsertItem({ activeEditor, isEditable }: InsertItemProps) {
  const [modal, showModal] = useModal();
  const EmbedConfigs = useEmbedConfigs();
  const [editor] = useLexicalComposerContext();

  const insertGifOnClick = (payload: InsertImagePayload) => {
    activeEditor.dispatchCommand(INSERT_IMAGE_COMMAND, payload);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            disabled={!isEditable}
            variant="outline"
            className="flex gap-1 h-12 md:h-10 rounded-r-none border-r-0"
            aria-label="Insert specialized editor node"
          >
            Insert
            <Plus className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem
            onClick={() => {
              activeEditor.dispatchCommand(
                INSERT_HORIZONTAL_RULE_COMMAND,
                undefined,
              );
            }}
            className="flex gap-2"
          >
            <Minus className="size-4" />
            <span className="text">Horizontal Rule</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              activeEditor.dispatchCommand(INSERT_PAGE_BREAK, undefined);
            }}
            className="flex gap-2"
          >
            <FileText className="size-4" />
            <span className="text">Page Break</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="flex items-center justify-between gap-2"
            onClick={() => {
              console.log("should fire OPEN_INSERT_VIDEO_DIALOG_COMMAND");
              activeEditor.dispatchCommand(
                OPEN_INSERT_VIDEO_DIALOG_COMMAND,
                undefined,
              );
            }}
          >
            <div className="flex items-center gap-2">
              <VideoIcon className="size-4" />
              <span className="text">Video</span>
            </div>
            <button
              type="button"
              className="p-1 rounded-sm hover:bg-accent focus:outline-none"
              onClick={(e) => {
                e.stopPropagation();
                showModal("Video Download Settings", (onClose) => (
                  <InsertVideoSettingsDialog
                    onClose={() => {
                      onClose();
                    }}
                  />
                ));
              }}
              aria-label="Video settings"
            >
              <Settings className="size-4" />
            </button>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              showModal("Insert Image", (onClose) => (
                <InsertImageDialog
                  activeEditor={activeEditor}
                  onClose={onClose}
                />
              ));
            }}
            className="flex gap-2"
          >
            <Image className="size-4" />
            <span className="text">Image</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              showModal("Insert Inline Image", (onClose) => (
                <InsertInlineImageDialog
                  activeEditor={activeEditor}
                  onClose={onClose}
                />
              ));
            }}
            className="flex gap-2"
          >
            <Image className="size-4" />
            <span className="text">Inline Image</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              insertGifOnClick({
                altText: "Cat typing on a laptop",
                src: "/images/cat-typing.gif",
              })
            }
            className="flex gap-2"
          >
            <Gift className="size-4" />
            <span className="text">GIF</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              activeEditor.dispatchCommand(
                INSERT_EXCALIDRAW_COMMAND,
                undefined,
              );
            }}
            className="flex gap-2"
          >
            <PencilRuler className="size-4" />
            <span className="text">Excalidraw</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              activeEditor.dispatchCommand(
                INSERT_MERMAID_COMMAND,
                undefined,
              );
            }}
            className="flex gap-2"
          >
            <ChartScatter className="size-4" />
            <span className="text">Mermaid</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              showModal("Insert Table", (onClose) => (
                <InsertTableDialog
                  activeEditor={activeEditor}
                  onClose={onClose}
                />
              ));
            }}
            className="flex gap-2"
          >
            <Table className="size-4" />
            <span className="text">Table</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              showModal("Insert Poll", (onClose) => (
                <InsertPollDialog
                  activeEditor={activeEditor}
                  onClose={onClose}
                />
              ));
            }}
            className="flex gap-2"
          >
            <Vote className="size-4" />
            <span className="text">Poll</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              showModal("Insert Columns Layout", (onClose) => (
                <InsertLayoutDialog
                  activeEditor={activeEditor}
                  onClose={onClose}
                />
              ));
            }}
            className="flex gap-2"
          >
            <Columns className="size-4" />
            <span className="text">Columns Layout</span>
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={() => {
              showModal("Insert Equation", (onClose) => (
                <InsertEquationDialog
                  activeEditor={activeEditor}
                  onClose={onClose}
                />
              ));
            }}
            className="flex gap-2"
          >
            <Sigma className="size-4" />
            <span className="text">Equation</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              editor.update(() => {
                const root = $getRoot();
                const stickyNode = StickyNode.$createStickyNode(0, 0);
                root.append(stickyNode);
              });
            }}
            className="flex gap-2"
          >
            <StickyNote className="size-4" />
            <span className="text">Sticky Note</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              editor.dispatchCommand(INSERT_COLLAPSIBLE_COMMAND, undefined);
            }}
            className="flex gap-2"
          >
            <ChevronRight className="size-4" />
            <span className="text">Collapsible container</span>
          </DropdownMenuItem>
          {EmbedConfigs.map((embedConfig) => (
            <DropdownMenuItem
              key={embedConfig.type}
              onClick={() => {
                activeEditor.dispatchCommand(
                  INSERT_EMBED_COMMAND,
                  embedConfig.type,
                );
              }}
              className="flex gap-2"
            >
              {embedConfig.icon}
              <span className="text">{embedConfig.contentName}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {modal}
    </>
  );
}
