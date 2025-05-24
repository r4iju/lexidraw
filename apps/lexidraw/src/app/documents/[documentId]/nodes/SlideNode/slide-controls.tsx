import { useState, useLayoutEffect } from "react";
import { useActiveSlideKey } from "./slide-context";
import { Button } from "~/components/ui/button";
import { INSERT_PAGE_COMMAND } from "../../plugins/SlidePlugin";
import { $getNodeByKey } from "lexical";
import { SlidePageNode } from "./SlidePageNode";

export const SlideControls: React.FC<{ deckElement?: HTMLElement | null }> = ({
  deckElement,
}) => {
  const {
    activeKey,
    setActiveKey,
    slideKeys,
    setSelectedElementId,
    deckEditor,
  } = useActiveSlideKey();

  const [style, setStyle] = useState<React.CSSProperties>({
    opacity: 0,
    pointerEvents: "none", // Start hidden and non-interactive
  });

  useLayoutEffect(() => {
    if (deckElement && activeKey) {
      // Get the position and size of the deck on the screen.
      const rect = deckElement.getBoundingClientRect();

      // We want to position the controls at the bottom-center of the deck.
      setStyle({
        position: "fixed", // Use fixed positioning to escape parent containers.
        left: `${rect.left + rect.width / 2}px`, // Horizontally center on the deck.
        top: `${rect.bottom - 8}px`, // Position near the bottom edge of the deck.
        transform: "translate(-50%, -100%)", // Adjust for centering and positioning above the bottom edge.
        zIndex: 100, // Ensure it's on top of other UI.
        opacity: 1,
        transition: "opacity 150ms ease-in-out",
      });
    } else {
      // If there's no deck or active slide, make it invisible.
      setStyle((prev) => ({ ...prev, opacity: 0, pointerEvents: "none" }));
    }

    // This effect should re-run if the deck appears/disappears or if the window is resized.
  }, [deckElement, activeKey]);

  const navigate = (direction: "prev" | "next") => {
    if (!deckEditor || !activeKey || !slideKeys || slideKeys.length <= 1)
      return;
    const currentIndex = slideKeys.indexOf(activeKey);
    if (currentIndex === -1) return; // Should not happen

    let newIndex;
    if (direction === "prev") {
      newIndex = currentIndex - 1;
    } else {
      newIndex = currentIndex + 1;
    }

    // Check bounds for disabling logic, actual navigation is simpler if buttons are correctly disabled
    if (newIndex >= 0 && newIndex < slideKeys.length) {
      const newKey = slideKeys[newIndex];
      if (newKey) {
        setActiveKey(newKey, null);
      }
    }
  };

  const createUID = (): string => Math.random().toString(36).substring(2, 9);

  const addTextBox = () => {
    if (!deckEditor || !activeKey) return;
    deckEditor.update(() => {
      const node = $getNodeByKey(activeKey);
      if (SlidePageNode.$isSlidePageNode(node)) {
        const newId = createUID();
        node.addElement({
          kind: "box",
          id: newId,
          x: 100,
          y: 100,
          width: 300,
          height: 100,
          editorStateJSON: null,
        });
        setSelectedElementId(newId); // Select the new box
      }
    });
  };

  const currentSlideIndex = activeKey ? slideKeys.indexOf(activeKey) : -1;

  if (!activeKey) return null;

  console.log("render slide controls");

  return (
    <div
      id="slide-controls"
      style={style}
      data-lexical-ignore="true"
      className="slide-controls absolute top-2 z-50 flex gap-2 p-2 bg-card/80 backdrop-blur-sm border border-border rounded-lg shadow-xl"
    >
      <Button
        type="button"
        onClick={() => navigate("prev")}
        variant="outline"
        size="sm"
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
        onClick={addTextBox}
        variant="default"
        size="sm"
        disabled={!activeKey}
      >
        Add Text
      </Button>
      <Button
        variant="default"
        size="sm"
        onClick={() => {
          if (deckEditor) {
            deckEditor.dispatchCommand(INSERT_PAGE_COMMAND, undefined);
          }
        }}
        disabled={!deckEditor}
      >
        Add Slide
      </Button>
    </div>
  );
};
