import { useActiveSlideKey } from "./slide-context";
import { Button } from "~/components/ui/button";
import { INSERT_PAGE_COMMAND } from "../../plugins/SlidePlugin";
import { $getNodeByKey } from "lexical";
import { SlidePageNode } from "./SlidePageNode";

export const Controls: React.FC = () => {
  const {
    activeKey,
    setActiveKey,
    slideKeys,
    deckEditor,
    setSelectedElementId,
  } = useActiveSlideKey();

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
          kind: "text",
          id: newId,
          x: 100,
          y: 100,
          width: 300,
          height: 100,
          editorStateJSON: null,
        });
        setSelectedElementId(newId); // Select the new text box
      }
    });
  };

  const currentSlideIndex = activeKey ? slideKeys.indexOf(activeKey) : -1;

  return (
    <div className="slide-controls absolute bottom-2 left-1/2 -translate-x-1/2 z-50 flex gap-2 p-2 bg-card/80 backdrop-blur-sm border border-border rounded-lg shadow-xl">
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
