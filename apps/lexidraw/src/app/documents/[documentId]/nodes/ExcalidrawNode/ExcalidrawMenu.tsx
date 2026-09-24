"use client";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { DownloadIcon, ImageDownIcon } from "lucide-react";
import { MainMenu } from "@excalidraw/excalidraw";
import { downloadScene } from "~/app/drawings/[drawingId]/download-scene";

type Props = {
  excalidrawApi: ExcalidrawImperativeAPI | null;
};

/**
 * The main menu of a drawing inside a document. Saving and leaving live in
 * the editor's header; nothing here replaces the drawing wholesale.
 */
export const DrawingBoardMenu = ({ excalidrawApi }: Props) => {
  const downloadFile = () => {
    if (excalidrawApi) downloadScene(excalidrawApi, "drawing");
  };

  return (
    <MainMenu>
      <MainMenu.Item icon={<DownloadIcon size={16} />} onSelect={downloadFile}>
        Download .excalidraw file
      </MainMenu.Item>
      <MainMenu.Item
        icon={<ImageDownIcon size={16} />}
        onSelect={() =>
          excalidrawApi?.updateScene({
            appState: { openDialog: { name: "imageExport" } },
          })
        }
      >
        Export image…
      </MainMenu.Item>
    </MainMenu>
  );
};
