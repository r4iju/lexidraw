"use client";

import { Button } from "~/components/ui/button";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { RefObject } from "react";
import { useIsDarkTheme } from "~/components/theme/theme-provider";
import { toast } from "sonner";
import {
  DownloadIcon,
  FileCheck,
  FolderIcon,
  ImageDownIcon,
  RotateCcwIcon,
  Trash2,
} from "lucide-react";
import {
  exportToBlob,
  loadFromBlob,
  exportToSvg,
  MainMenu,
} from "@excalidraw/excalidraw";

type Props = {
  onSaveAndClose: () => void;
  onSave: () => void;
  onDiscard: () => void;
  excalidrawApi: RefObject<ExcalidrawImperativeAPI>;
};

export const DrawingBoardMenu = ({
  excalidrawApi,
  onSaveAndClose,
  onSave,
  onDiscard,
}: Props) => {
  const isDarkTheme = useIsDarkTheme();
  const CustomMenuItem = MainMenu.ItemCustom;

  const closeMenu = () => {
    excalidrawApi.current?.updateScene({
      elements: excalidrawApi.current?.getSceneElements(),
      appState: {
        ...excalidrawApi.current?.getAppState(),
        openMenu: null,
      },
    });
  };

  const handleLoadScene = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".excalidraw";
    input.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) {
        return;
      }

      const scene = await loadFromBlob(file, null, null);
      console.log(scene);
      if (!scene) {
        toast.error("Invalid file", {
          description: "Please upload a valid Excalidraw file",
        });
        return;
      }
      excalidrawApi.current?.updateScene(scene);
      closeMenu();
    };
    input.click();
  };

  const handleExportAsExcalidrawFile = async () => {
    if (!excalidrawApi.current) return;
    const elements = excalidrawApi.current.getSceneElements();
    const appState = excalidrawApi.current.getAppState();
    const data = JSON.stringify({
      type: "excalidraw",
      version: 2,
      source: window.location.href,
      elements,
      appState,
    });
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `drawing.excalidraw`;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
    closeMenu();
  };

  const handleExportAsPng = async () => {
    if (!excalidrawApi.current) return;
    const blob = await exportToBlob({
      elements: excalidrawApi.current.getSceneElements(),
      appState: {
        ...excalidrawApi.current.getAppState(),
        exportBackground: true,
        exportWithDarkMode: isDarkTheme ? true : false,
      },
      files: null,
      // quality: 100,
      mimeType: "image/png",
      getDimensions(width: number, height: number) {
        return { width: width * 3, height: height * 3, scale: 3 };
      },
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `drawing.png`;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
    closeMenu();
  };

  const handleExportAsSvg = async () => {
    if (!excalidrawApi.current) return;
    const svg = await exportToSvg({
      elements: excalidrawApi.current.getSceneElements(),
      appState: excalidrawApi.current.getAppState(),
      files: null,
      exportPadding: 10,
    });
    const svgString = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([svgString], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `drawing.svg`;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
    closeMenu();
  };

  const handleReset = () => {
    if (!excalidrawApi.current) return;
    excalidrawApi.current.updateScene({
      elements: [],
      appState: {
        ...excalidrawApi.current.getAppState(),
      },
    });
    closeMenu();
  };

  return (
    <>
      {/* save and close */}
      <CustomMenuItem
        style={{
          padding: 0,
          marginTop: 0,
        }}
      >
        <Button
          onClick={onSaveAndClose}
          variant="ghost"
          className="w-full justify-start gap-2 h-8 py-0 px-3 cursor-pointer"
        >
          <FileCheck size={14} strokeWidth={2} />
          Save and close
        </Button>
      </CustomMenuItem>
      {/* save */}
      <CustomMenuItem
        style={{
          padding: 0,
          marginTop: 0,
        }}
      >
        <Button
          onClick={onSave}
          variant="ghost"
          className="w-full justify-start gap-2 h-8 py-0 px-3 cursor-pointer"
        >
          <FileCheck size={14} strokeWidth={2} />
          Save
        </Button>
      </CustomMenuItem>
      {/* discard */}
      <CustomMenuItem
        style={{
          padding: 0,
          marginTop: 0,
        }}
      >
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 h-8 py-0 px-3 cursor-pointer"
          onClick={onDiscard}
        >
          <Trash2 size={14} strokeWidth={2} />
          Discard
        </Button>
      </CustomMenuItem>
      <CustomMenuItem
        style={{
          padding: 0,
          marginTop: 0,
        }}
      >
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 h-8 py-0 px-3 cursor-pointer"
          onClick={handleLoadScene}
        >
          <FolderIcon size={14} strokeWidth={2} />
          Open
        </Button>
      </CustomMenuItem>
      {/* <MainMenu.DefaultItems.LoadScene /> */}
      <CustomMenuItem
        style={{
          padding: 0,
          marginTop: 0,
        }}
      >
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 h-8 py-0 px-3 cursor-pointer"
          onClick={handleExportAsExcalidrawFile}
        >
          <DownloadIcon size={14} strokeWidth={2} />
          Export to file
        </Button>
      </CustomMenuItem>
      {/* <MainMenu.DefaultItems.Export /> */}
      <CustomMenuItem
        style={{
          padding: 0,
          marginTop: 0,
        }}
      >
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 h-8 py-0 px-3 cursor-pointer"
          onClick={handleExportAsPng}
        >
          <ImageDownIcon size={14} strokeWidth={2} />
          Export as PNG
        </Button>
      </CustomMenuItem>
      <CustomMenuItem
        style={{
          padding: 0,
          marginTop: 0,
        }}
      >
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 h-8 py-0 px-3 cursor-pointer"
          onClick={handleExportAsSvg}
        >
          <ImageDownIcon size={14} strokeWidth={2} />
          Export as SVG
        </Button>
      </CustomMenuItem>
      {/* <MainMenu.DefaultItems.SaveAsImage /> */}
      <CustomMenuItem
        style={{
          padding: 0,
          marginTop: 0,
        }}
      >
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 h-8 py-0 px-3 cursor-pointer"
          onClick={handleReset}
        >
          <RotateCcwIcon size={14} strokeWidth={2} />
          Clear canvas
        </Button>
      </CustomMenuItem>
      {/* <MainMenu.DefaultItems.ClearCanvas /> */}
    </>
  );
};
