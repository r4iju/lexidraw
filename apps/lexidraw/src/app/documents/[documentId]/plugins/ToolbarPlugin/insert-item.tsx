import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Button } from "~/components/ui/button";
import { Plus, VideoIcon } from "lucide-react";
import { INSERT_HORIZONTAL_RULE_COMMAND } from "@lexical/react/LexicalHorizontalRuleNode";
import { INSERT_EMBED_COMMAND } from "@lexical/react/LexicalAutoEmbedPlugin";
import { INSERT_PAGE_BREAK } from "../PageBreakPlugin";
import { INSERT_EXCALIDRAW_COMMAND } from "../ExcalidrawPlugin";
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
import { InsertVideoDialog } from "../VideosPlugin";

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
            className="item"
          >
            <i className="icon horizontal-rule" />
            <span className="text">Horizontal Rule</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              activeEditor.dispatchCommand(INSERT_PAGE_BREAK, undefined);
            }}
            className="item"
          >
            <i className="icon page-break" />
            <span className="text">Page Break</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              showModal("Insert Video", (onClose) => (
                <InsertVideoDialog
                  activeEditor={activeEditor}
                  onClose={onClose}
                />
              ));
            }}
            className="item"
          >
            <VideoIcon className="size-4" />
            <span className="text">Video</span>
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
            className="item"
          >
            <i className="icon image" />
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
            className="item"
          >
            Inline Image
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              insertGifOnClick({
                altText: "Cat typing on a laptop",
                src: "/images/cat-typing.gif",
              })
            }
            className="item"
          >
            <i className="icon gif" />
            <span className="text">GIF</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              activeEditor.dispatchCommand(
                INSERT_EXCALIDRAW_COMMAND,
                undefined,
              );
            }}
            className="item"
          >
            <i className="icon diagram-2" />
            <span className="text">Excalidraw</span>
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
            className="item"
          >
            <i className="icon table" />
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
            className="item"
          >
            <i className="icon poll" />
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
            className="item"
          >
            <i className="icon columns" />
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
            className="item"
          >
            <i className="icon equation" />
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
            className="item"
          >
            <i className="icon sticky" />
            <span className="text">Sticky Note</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              editor.dispatchCommand(INSERT_COLLAPSIBLE_COMMAND, undefined);
            }}
            className="item"
          >
            <i className="icon caret-right" />
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
              className="item"
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
