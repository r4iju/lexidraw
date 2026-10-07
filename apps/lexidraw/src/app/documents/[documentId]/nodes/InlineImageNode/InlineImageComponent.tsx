import type { Position, UpdateInlineImagePayload } from "./InlineImageNode";
import type { BaseSelection, LexicalEditor, NodeKey } from "lexical";

import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalEditable } from "@lexical/react/useLexicalEditable";
import { useLexicalNodeSelection } from "@lexical/react/useLexicalNodeSelection";
import { mergeRegister } from "@lexical/utils";
import {
  $getNodeByKey,
  $getSelection,
  $isNodeSelection,
  $setSelection,
  CLICK_COMMAND,
  COMMAND_PRIORITY_LOW,
  DRAGSTART_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  SELECTION_CHANGE_COMMAND,
} from "lexical";
import type * as React from "react";
import {
  Suspense,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import LinkPlugin from "../../plugins/LinkPlugin";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { InlineImageNode, inlineImagePlacement } from "./InlineImageNode";
import { NodeEditButton } from "../common/NodeEditButton";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { cn } from "~/lib/utils";
import ImageResizer from "~/components/ui/image-resizer";
import { Switch } from "~/components/ui/switch";
import { SwitchThumb } from "@radix-ui/react-switch";
import ImageCaption, { useCaptionJustShown } from "../common/ImageCaption";
import KeywordsPlugin from "../../plugins/KeywordsPlugin";
import { HashtagPlugin } from "@lexical/react/LexicalHashtagPlugin";
import EmojisPlugin from "../../plugins/EmojisPlugin";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import MentionsPlugin from "../../plugins/MentionsPlugin";
import TreeViewPlugin from "../../plugins/TreeViewPlugin";
import { useSharedHistoryContext } from "../../context/shared-history-context";
import { useSettings } from "../../context/settings-context";

/**
 * The picture of an inline image: the size it was given, scaled down to fit
 * where it sits, or the column's width when it is placed full.
 */
function InlineImagePicture({
  src,
  altText,
  width,
  height,
  full,
  className,
  onDoubleClick,
}: {
  src: string;
  altText: string;
  width: number | "inherit";
  height: number | "inherit";
  /** Placed full, it takes the column's width whatever size it was given. */
  full: boolean;
  className?: string;
  onDoubleClick: (event: React.MouseEvent) => void;
}): React.JSX.Element {
  return (
    <img
      src={src}
      alt={altText}
      draggable={false}
      style={{
        width: typeof width === "number" && !full ? width : undefined,
        aspectRatio:
          typeof width === "number" && typeof height === "number"
            ? `${width} / ${height}`
            : undefined,
      }}
      onDoubleClick={onDoubleClick}
      className={cn(
        "block h-auto max-w-full rounded-xs object-contain",
        full && "w-full",
        className,
      )}
    />
  );
}

export function UpdateInlineImageDialog({
  activeEditor,
  nodeKey,
  onClose,
}: {
  activeEditor: LexicalEditor;
  nodeKey: NodeKey;
  onClose: () => void;
}): React.JSX.Element {
  const editorState = activeEditor.getEditorState();
  const node = editorState.read(
    () => $getNodeByKey(nodeKey) as InlineImageNode,
  );
  const [altText, setAltText] = useState(node.getAltText());
  const [showCaption, setShowCaption] = useState(node.getShowCaption());
  const [position, setPosition] = useState<Position>(node.getPosition());
  const [widthAndHeight, setWidthAndHeight] = useState<{
    width: string;
    height: string;
  }>({
    width: node.getWidth().toString(),
    height: node.getHeight().toString(),
  });

  const handleAltTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAltText(e.target.value);
  };

  const handleWidthOrHeightChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    key: "width" | "height",
  ) => {
    const value = e.target.value;
    setWidthAndHeight((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  const toWidthOrHeight = (value: string): "inherit" | number => {
    return value === "inherit" ? "inherit" : parseInt(value, 10) || "inherit";
  };

  const widthId = useId();
  const heightId = useId();
  const captionSwitchId = useId();

  const handleOnConfirm = (event: React.FormEvent) => {
    event.preventDefault();
    const width = toWidthOrHeight(widthAndHeight.width);
    const height = toWidthOrHeight(widthAndHeight.height);
    const payload = {
      altText,
      position,
      showCaption,
      width,
      height,
    } satisfies UpdateInlineImagePayload;
    if (node) {
      activeEditor.update(() => {
        node.update(payload);
      });
    }
    onClose();
  };

  return (
    <DialogContent>
      <form onSubmit={handleOnConfirm} className="contents">
        <DialogHeader>
          <DialogTitle>Update Inline Image</DialogTitle>
        </DialogHeader>
        <div style={{ marginBottom: "1em" }}>
          <Label htmlFor={`inline-alt-${nodeKey}`}>Alt Text</Label>
          <Input
            id={`inline-alt-${nodeKey}`}
            placeholder="Descriptive alternative text"
            onChange={handleAltTextChange}
            value={altText}
          />
        </div>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <Label htmlFor={widthId}>Width</Label>
            <Input
              id={widthId}
              placeholder="auto"
              type="number"
              step="50"
              onChange={(e) => handleWidthOrHeightChange(e, "width")}
              value={widthAndHeight.width}
              min="0"
              data-testid="image-modal-width-input"
            />
          </div>
          <div>
            <Label htmlFor={heightId}>Height</Label>
            <Input
              id={heightId}
              placeholder="auto"
              type="number"
              step="50"
              onChange={(e) => handleWidthOrHeightChange(e, "height")}
              value={widthAndHeight.height}
              min="0"
              data-testid="image-modal-height-input"
            />
          </div>
        </div>
        <Select
          value={position}
          name="position"
          onValueChange={(val) => setPosition(val as Position)}
        >
          <SelectTrigger className="w-[208px] mb-1" aria-label="Position">
            <SelectValue placeholder="Position" />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={"left" satisfies Position}>Left</SelectItem>
              <SelectItem value={"right" satisfies Position}>Right</SelectItem>
              <SelectItem value={"full" satisfies Position}>
                Full Width
              </SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Switch
            id={captionSwitchId}
            checked={showCaption}
            onCheckedChange={setShowCaption}
          >
            <SwitchThumb />
          </Switch>
          <Label htmlFor={captionSwitchId}>Show Caption</Label>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit">Update image</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

export default function InlineImageComponent({
  src,
  altText,
  nodeKey,
  width,
  height,
  showCaption,
  caption,
  position,
  captionsEnabled,
}: {
  altText: string;
  caption: LexicalEditor;
  height: "inherit" | number;
  nodeKey: NodeKey;
  showCaption: boolean;
  src: string;
  width: "inherit" | number;
  position: Position;
  captionsEnabled: boolean;
}): React.JSX.Element {
  const captionJustShown = useCaptionJustShown(showCaption);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [currentDimensions, setCurrentDimensions] = useState({
    width,
    height,
  });
  const [editor] = useLexicalComposerContext();
  const isEditable = useLexicalEditable();
  const [selection, setSelection] = useState<BaseSelection | null>(null);
  const { historyState } = useSharedHistoryContext();
  const {
    settings: { showNestedEditorTreeView },
  } = useSettings();

  const [isSelected, setSelected, clearSelection] =
    useLexicalNodeSelection(nodeKey);

  const activeEditorRef = useRef<LexicalEditor | null>(null);
  const pictureRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const nestedEditorContainerRef = useRef<HTMLDivElement>(null);

  // Keydown logic
  const $onDelete = useCallback(
    (payload: KeyboardEvent) => {
      if (isSelected && $isNodeSelection($getSelection())) {
        payload.preventDefault();
        const node = $getNodeByKey(nodeKey);
        if (InlineImageNode.$isInlineImageNode(node)) {
          node.remove();
          return true;
        }
      }
      return false;
    },
    [isSelected, nodeKey],
  );

  const $onEnter = useCallback(
    (event: KeyboardEvent | null) => {
      const latestSelection = $getSelection();
      if (isSelected && $isNodeSelection(latestSelection)) {
        if (showCaption) {
          $setSelection(null);
          event?.preventDefault();
          caption.focus();
          return true;
        } else if (
          buttonRef.current !== null &&
          buttonRef.current !== document.activeElement
        ) {
          event?.preventDefault();
          buttonRef.current.focus();
          return true;
        }
      }
      return false;
    },
    [caption, isSelected, showCaption],
  );

  const $onEscape = useCallback(
    (event: KeyboardEvent) => {
      if (
        activeEditorRef.current === caption ||
        buttonRef.current === event.target
      ) {
        $setSelection(null);
        editor.update(() => {
          setSelected(true);
          editor.getRootElement()?.focus();
        });
        return true;
      }
      return false;
    },
    [caption, editor, setSelected],
  );

  useEffect(() => {
    // keep state in sync with node updates
    setCurrentDimensions({ width, height });
  }, [width, height]);

  // Register commands
  useEffect(() => {
    let isMounted = true;
    const unregister = mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        if (isMounted) {
          setSelection(editorState.read(() => $getSelection()));
        }
      }),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        (_, activeEditor) => {
          activeEditorRef.current = activeEditor;
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand<MouseEvent>(
        CLICK_COMMAND,
        (event) => {
          if (pictureRef.current?.contains(event.target as Node)) {
            if (event.shiftKey) {
              setSelected(!isSelected);
            } else {
              clearSelection();
              setSelected(true);
            }
            return true;
          }
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        DRAGSTART_COMMAND,
        (event) => {
          if (pictureRef.current?.contains(event.target as Node)) {
            event.preventDefault();
            return true;
          }
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_DELETE_COMMAND,
        $onDelete,
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_BACKSPACE_COMMAND,
        $onDelete,
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(KEY_ENTER_COMMAND, $onEnter, COMMAND_PRIORITY_LOW),
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        $onEscape,
        COMMAND_PRIORITY_LOW,
      ),
    );
    return () => {
      isMounted = false;
      unregister();
    };
  }, [
    clearSelection,
    editor,
    $onDelete,
    $onEnter,
    $onEscape,
    isSelected,
    setSelected,
  ]);

  const draggable = isEditable && isSelected && $isNodeSelection(selection);
  const isFocused = isEditable && isSelected;

  const onDimensionsChange = (dimensions: {
    width: number | "inherit";
    height: number | "inherit";
  }) => {
    setCurrentDimensions(dimensions);
  };

  // Callback to update the node's showCaption state
  const updateShowCaption = (show: boolean) => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (InlineImageNode.$isInlineImageNode(node)) {
        node.setShowCaption(show);
      }
    });
  };

  // Callback to hide the caption
  const handleHideCaption = () => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (InlineImageNode.$isInlineImageNode(node)) {
        node.setShowCaption(false);
      }
    });
  };

  return (
    <Suspense fallback={null}>
      <div
        draggable={draggable}
        data-inline-image=""
        data-position={position}
        className={inlineImagePlacement(position)}
      >
        <div ref={pictureRef} className="relative">
          <InlineImagePicture
            className={isFocused ? "ring-1 ring-muted-foreground" : undefined}
            src={src}
            altText={altText}
            width={currentDimensions.width}
            height={currentDimensions.height}
            full={position === "full"}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setIsLightboxOpen(true);
            }}
          />
          {isEditable && (
            <NodeEditButton
              ref={buttonRef}
              label="Edit inline image"
              iconOnly
              visible={isFocused}
              onClick={() => setIsDialogOpen(true)}
            />
          )}
          {isEditable && isSelected && (
            <ImageResizer
              imageRef={pictureRef as React.RefObject<HTMLImageElement>}
              editor={editor}
              buttonRef={buttonRef as React.RefObject<HTMLButtonElement>}
              showCaption={showCaption}
              setShowCaption={updateShowCaption}
              // The edit dialog offers the caption.
              captionsEnabled={false}
              onResizeEnd={(newWidth, newHeight) => {
                editor.update(() => {
                  const node = $getNodeByKey(nodeKey);
                  if (InlineImageNode.$isInlineImageNode(node)) {
                    node.setWidthAndHeight(newWidth, newHeight);
                  }
                });
              }}
              onDimensionsChange={onDimensionsChange}
            />
          )}
        </div>
        {showCaption && captionsEnabled && (
          // A block of its own, so the caption takes the picture's width.
          <div>
            <ImageCaption
              containerRef={nestedEditorContainerRef}
              caption={caption}
              placeholder="Enter a caption..."
              autoFocus={captionJustShown}
              onHideCaption={handleHideCaption}
            >
              <MentionsPlugin />
              <LinkPlugin />
              <EmojisPlugin />
              <HashtagPlugin />
              <KeywordsPlugin />
              <HistoryPlugin externalHistoryState={historyState} />
              {showNestedEditorTreeView && <TreeViewPlugin />}
            </ImageCaption>
          </div>
        )}
      </div>

      {/* The "Update Inline Image" dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <UpdateInlineImageDialog
          activeEditor={editor}
          nodeKey={nodeKey}
          onClose={() => setIsDialogOpen(false)}
        />
      </Dialog>

      <Dialog open={isLightboxOpen} onOpenChange={setIsLightboxOpen}>
        <DialogContent size="full" className="flex items-center justify-center">
          <DialogTitle className="sr-only">Image Lightbox</DialogTitle>
          <img
            src={src}
            alt={altText}
            className="max-h-full max-w-full object-contain"
          />
        </DialogContent>
      </Dialog>
    </Suspense>
  );
}
