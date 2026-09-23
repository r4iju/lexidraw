import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  SlideNode as HeadlessSlideNode,
  type SlideDeckData,
} from "@packages/lexical-nodes";
import {
  $createNodeSelection,
  $getNodeByKey,
  $getSelection,
  $isNodeSelection,
  $setSelection,
  type NodeKey,
} from "lexical";
import React, {
  type JSX,
  Suspense,
  useCallback,
  useEffect,
  useState,
} from "react";
import { cn } from "~/lib/utils";
import { MetadataModalProvider } from "./MetadataModalContext";

export type {
  DeckStrategicMetadata,
  SerializedSlideDeckNode,
  SlideData,
  SlideDeckData,
  SlideElementSpec,
  SlideStrategicMetadata,
  ThemeSettings,
} from "@packages/lexical-nodes";
export {
  DeckStrategicMetadataSchema,
  SlideStrategicMetadataSchema,
  ThemeSettingsSchema,
} from "@packages/lexical-nodes";

const SlideView = React.lazy(() => import("./SlideView"));
// SlideModal reaches SlideDeckEditor, which uses next/font at module scope;
// loading it lazily keeps this node module importable without Next.
const SlideModal = React.lazy(() =>
  import("./SlideModal").then((mod) => ({ default: mod.SlideModal })),
);

/** React half of the package's SlideNode; see ImageNode. */
export class SlideNode extends HeadlessSlideNode {
  static getType = HeadlessSlideNode.getType;
  static clone = HeadlessSlideNode.clone;
  static importJSON = HeadlessSlideNode.importJSON;

  decorate(): JSX.Element {
    return (
      <Suspense fallback={<div>Loading Slides...</div>}>
        <SlideNodeInner nodeKey={this.getKey()} initialData={this.__data} />
      </Suspense>
    );
  }
}

function SlideNodeInner({
  nodeKey,
  initialData,
}: {
  nodeKey: NodeKey;
  initialData: SlideDeckData;
}) {
  const [editor] = useLexicalComposerContext();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showSelectionUI, setShowSelectionUI] = useState(false);

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection();
        if ($isNodeSelection(selection)) {
          const selectedNodes = selection.getNodes();
          if (
            selectedNodes.length === 1 &&
            selectedNodes[0] &&
            selectedNodes[0].getKey() === nodeKey
          ) {
            setShowSelectionUI(true);
            return;
          }
        }
        setShowSelectionUI(false);
      });
    });
  }, [editor, nodeKey]);

  const handleOpenModal = useCallback(() => {
    setIsModalOpen(true);
  }, []);

  const handleSelect = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      editor.update(() => {
        editor.focus();
        const selection = $getSelection();
        if (
          !$isNodeSelection(selection) ||
          !selection.getNodes().find((node) => node.getKey() === nodeKey)
        ) {
          const nodeSelection = $createNodeSelection();
          nodeSelection.add(nodeKey);
          $setSelection(nodeSelection);
        }
      });
    },
    [editor, nodeKey],
  );

  const handleSaveModal = useCallback(
    (updatedData: SlideDeckData) => {
      editor.update(() => {
        const node = $getNodeByKey<SlideNode>(nodeKey);
        if (node) {
          try {
            node.setData(updatedData);
          } catch (e) {
            console.error("[SlideNodeInner] Error saving slide data:", e);
          }
        }
      });
      setIsModalOpen(false);
    },
    [editor, nodeKey],
  );

  return (
    <>
      {/** biome-ignore lint/a11y/noStaticElementInteractions: slide node is interactive */}
      {/** biome-ignore lint/a11y/useKeyWithClickEvents: slide node is interactive */}
      <div
        onDoubleClick={handleOpenModal}
        onClick={handleSelect}
        className={cn("cursor-pointer relative", {
          "ring-1 ring-primary box-content": showSelectionUI,
        })}
      >
        <SlideView initialData={initialData} editor={editor} />
      </div>
      {isModalOpen && (
        <MetadataModalProvider>
          <SlideModal
            nodeKey={nodeKey}
            initialData={initialData}
            editor={editor}
            onSave={handleSaveModal}
            onOpenChange={setIsModalOpen}
            isOpen={isModalOpen}
          />
        </MetadataModalProvider>
      )}
    </>
  );
}
