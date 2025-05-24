import { useState, useLayoutEffect } from "react";
import { useActiveSlideKey, useSlideModal } from "./slide-context";
import { Button } from "~/components/ui/button";
import { INSERT_PAGE_COMMAND } from "../../plugins/SlidePlugin";
import { $getNodeByKey } from "lexical";
import { SlidePageNode, type SlideElementSpec } from "./SlidePageNode";
import { cn } from "~/lib/utils";

const createUID = (): string => Math.random().toString(36).substring(2, 9);

export interface SlideControlsProps {
  deckElement?: HTMLElement | null;
  isModalContext?: boolean;
  onAddTextBoxInModal?: (newElement: SlideElementSpec) => void;
  onAddSlideInModal?: () => void;
  // The activeKey, slideKeys, deckEditor, setSelectedElementId will be sourced from context
  // but if we want modal to operate entirely independently, they could be props too.
  // For now, modal controls will reflect global active slide for nav, but add text locally.
}

export const SlideControls: React.FC<SlideControlsProps> = ({
  deckElement,
  isModalContext = false,
  onAddTextBoxInModal,
  onAddSlideInModal,
}) => {
  const {
    activeKey,
    setActiveKey,
    slideKeys,
    setSelectedElementId,
    deckEditor,
  } = useActiveSlideKey();
  const {
    isModalOpen: isGlobalModalOpen,
    setIsModalOpen: setGlobalIsModalOpen,
  } = useSlideModal();

  // Controls should always render if in modal. If not in modal, then behavior depends on deckElement.
  // shouldAlwaysRender is for the main UI context where controls might be statically placed.
  const shouldAlwaysRenderStatically =
    deckElement === undefined && !isModalContext;

  const [style, setStyle] = useState<React.CSSProperties>(() => {
    if (isModalContext || shouldAlwaysRenderStatically) {
      return { position: "relative", opacity: 1 };
    }
    return { opacity: 0, pointerEvents: "none" };
  });

  useLayoutEffect(() => {
    // No dynamic positioning if in modal or statically rendered in main UI.
    if (isModalContext || shouldAlwaysRenderStatically) {
      // Ensure style is relative if it was initially something else then props changed.
      setStyle({ position: "relative", opacity: 1, zIndex: 20 }); // zIndex for modal context
      return;
    }

    if (deckElement && activeKey) {
      const rect = deckElement.getBoundingClientRect();
      setStyle({
        position: "absolute",
        left: `${rect.left + rect.width / 2}px`,
        top: `${rect.bottom - 8}px`,
        transform: "translate(-50%, -100%)",
        zIndex: 20,
        opacity: 1,
        transition: "opacity 150ms ease-in-out",
      });
    } else {
      setStyle((prev) => ({ ...prev, opacity: 0, pointerEvents: "none" }));
    }
  }, [deckElement, activeKey, isModalContext, shouldAlwaysRenderStatically]);

  const navigate = (direction: "prev" | "next") => {
    // Prev/Next in modal context will still navigate the main deck's active slide.
    // This is often the desired behavior if the modal is for editing the *current* slide.
    if (!deckEditor || !activeKey || !slideKeys || slideKeys.length <= 1)
      return;
    const currentIndex = slideKeys.indexOf(activeKey);
    if (currentIndex === -1) return;

    const newIndex = direction === "prev" ? currentIndex - 1 : currentIndex + 1;

    if (newIndex >= 0 && newIndex < slideKeys.length) {
      const newKey = slideKeys[newIndex];
      if (newKey) {
        setActiveKey(newKey, null);
      }
    }
  };

  const addTextBoxToMainEditor = () => {
    if (!deckEditor || !activeKey) return;
    deckEditor.update(() => {
      const node = $getNodeByKey(activeKey);
      if (SlidePageNode.$isSlidePageNode(node)) {
        const newId = createUID();
        const newElement: SlideElementSpec = {
          kind: "box",
          id: newId,
          x: 100,
          y: 100,
          width: 300,
          height: 100,
          editorStateJSON: null,
        };
        node.addElement(newElement);
        setSelectedElementId(newId);
      }
    });
  };

  const handleAddTextBox = () => {
    if (isModalContext) {
      if (onAddTextBoxInModal) {
        const newId = createUID();
        const newElement: SlideElementSpec = {
          kind: "box",
          id: newId,
          x: 100,
          y: 100,
          width: 300,
          height: 100,
          editorStateJSON: null,
        };
        onAddTextBoxInModal(newElement);
      } else {
        console.warn(
          "Add text in modal context: onAddTextBoxInModal not provided.",
        );
      }
    } else {
      addTextBoxToMainEditor();
    }
  };

  const currentSlideIndex = activeKey ? slideKeys.indexOf(activeKey) : -1;

  // In main UI (not modal), if no active slide and not statically placed, hide controls.
  if (!isModalContext && !activeKey && !shouldAlwaysRenderStatically)
    return null;

  // If in modal context, but the global activeKey (which modal is supposed to represent) is null,
  // it might be an edge case. For now, let modal controls render if isModalContext is true.
  // The disabled states should handle functionality.

  return (
    <div
      id={isModalContext ? "slide-controls-modal" : "slide-controls-main"}
      style={style}
      data-lexical-ignore="true"
      className={cn(
        "slide-controls z-20 flex gap-2 p-2 bg-card/80 backdrop-blur-md border border-border rounded-lg shadow-xl",
        // conditional positioning is now handled by the style state directly based on context
      )}
    >
      <Button
        type="button"
        onClick={() => navigate("prev")}
        variant="outline"
        size="sm"
        // Disable navigation if no active slide (relevant for both contexts if activeKey is null)
        disabled={
          !activeKey || slideKeys.length <= 1 || currentSlideIndex === 0
        }
      >
        Prev
      </Button>
      <Button
        type="button"
        onClick={() => navigate("next")}
        variant="outline"
        size="sm"
        disabled={
          !activeKey ||
          slideKeys.length <= 1 ||
          currentSlideIndex === slideKeys.length - 1
        }
      >
        Next
      </Button>
      <Button
        type="button"
        onClick={handleAddTextBox}
        variant="default"
        size="sm"
        // Disable if in modal and no handler, or if not in modal and no active slide.
        disabled={
          (isModalContext && !onAddTextBoxInModal) ||
          (!isModalContext && !activeKey)
        }
      >
        Add Text
      </Button>
      <Button
        variant="default"
        size="sm"
        onClick={() => {
          if (isModalContext && onAddSlideInModal) {
            onAddSlideInModal();
          } else if (!isModalContext && deckEditor) {
            deckEditor.dispatchCommand(INSERT_PAGE_COMMAND, undefined);
          }
        }}
        disabled={
          (isModalContext && !onAddSlideInModal) ||
          (!isModalContext && !deckEditor)
        }
      >
        Add Slide
      </Button>
      {/* Only show "Open Modal" button if NOT in modal context and global modal isn't already open */}
      {!isModalContext && !isGlobalModalOpen && (
        <Button
          variant="default"
          size="sm"
          onClick={() => setGlobalIsModalOpen(true)}
          // Disable if no active slide to open modal for
          disabled={!activeKey}
        >
          Open Modal
        </Button>
      )}
    </div>
  );
};
