"use client";

import { Button } from "~/components/ui/button";
import type {
  AppState,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import { RefObject, useState } from "react";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { api } from "~/trpc/react";
import { RouterOutputs } from "~/trpc/shared";
import { useIsDarkTheme } from "~/components/theme/theme-provider";
import { Theme } from "@packages/types";
import { toast } from "sonner";
import {
  DownloadIcon,
  FileCheck,
  FolderIcon,
  ImageDownIcon,
  LayoutDashboardIcon,
  RotateCcwIcon,
} from "lucide-react";
import {
  exportToBlob,
  loadFromBlob,
  exportToSvg,
  MainMenu,
} from "@excalidraw/excalidraw";
import { GuardedLink, useUnsavedChanges } from "~/hooks/use-unsaved-changes";
import { put } from "@vercel/blob/client";

type Props = {
  drawing: RouterOutputs["entities"]["load"];
  excalidrawApi: RefObject<ExcalidrawImperativeAPI>;
};

export const DrawingBoardMenu = ({ drawing, excalidrawApi }: Props) => {
  const isDarkTheme = useIsDarkTheme();
  const { mutate: save } = api.entities.save.useMutation();
  const { mutate: generateTokens } =
    api.snapshot.generateClientUploadTokens.useMutation();
  const { mutate: saveUploadedUrl } =
    api.snapshot.saveUploadedUrl.useMutation();
  const [isUploading, setIsUploading] = useState(false);
  const { markPristine } = useUnsavedChanges();

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

  const saveToBackend = async () => {
    if (!excalidrawApi.current) return;
    const elements =
      excalidrawApi.current.getSceneElements() as ExcalidrawElement[];
    const appState: AppState = excalidrawApi.current.getAppState();

    save(
      {
        id: drawing.id,
        entityType: "drawing",
        appState: JSON.stringify({
          ...appState,
          openDialog: null,
          theme: isDarkTheme ? Theme.DARK : Theme.LIGHT,
        } satisfies AppState),
        elements: JSON.stringify(elements),
      },
      {
        onSuccess: async () => {
          markPristine();
          toast.success("Saved!");
          await exportDrawingAsSvg();
        },
        onError: (err) =>
          toast.error("Something went wrong!", { description: err.message }),
      },
    );
  };

  const exportDrawingAsSvg = async () => {
    setIsUploading(true);

    generateTokens(
      { entityId: drawing.id, contentType: "image/svg+xml" },
      {
        onError: (e) => {
          toast.error("Failed preparing upload", { description: e.message });
          setIsUploading(false);
        },
        onSuccess: async (tokens) => {
          try {
            await Promise.all(
              tokens.map(async ({ token, pathname, theme }) => {
                const svg = await exportToSvg({
                  elements: excalidrawApi.current.getSceneElements(),
                  appState: {
                    ...excalidrawApi.current.getAppState(),
                    theme,
                    exportWithDarkMode: theme === Theme.DARK,
                    exportBackground: true,
                  },
                  files: null,
                  exportPadding: 10,
                });

                const svgString = new XMLSerializer().serializeToString(svg);
                const blob = new Blob([svgString], {
                  type: "image/svg+xml",
                });

                const { url } = await put(pathname, blob, {
                  access: "public",
                  multipart: true,
                  contentType: blob.type,
                  token,
                });

                // persist URL so the dashboard shows the new thumbnail
                saveUploadedUrl({ entityId: drawing.id, theme, url });
              }),
            );
            toast.success("Exported thumbnails!");
          } catch (e) {
            console.error(
              "Error exporting thumbnails in drawing-dropdown.tsx",
              e,
            );
            toast.error("Upload failed", { description: (e as Error).message });
          } finally {
            setIsUploading(false);
            closeMenu();
          }
        },
      },
    );
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
    a.download = `${drawing.title}.excalidraw`;
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
    a.download = `${drawing.title}.png`;
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
    a.download = `${drawing.title}.svg`;
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
      <CustomMenuItem
        style={{
          padding: 0,
          marginTop: 0,
        }}
      >
        <Button
          asChild
          variant="ghost"
          className="w-full justify-start gap-2 h-8 py-0 px-3 cursor-pointer"
        >
          <GuardedLink
            href="/dashboard"
            style={{
              textDecoration: "none",
              color: "inherit",
              display: "flex",
              alignItems: "center",
            }}
          >
            {" "}
            <LayoutDashboardIcon size={14} strokeWidth={2} />
            Go to dashboard
          </GuardedLink>
        </Button>
      </CustomMenuItem>
      <CustomMenuItem
        style={{
          padding: 0,
          marginTop: 0,
        }}
      >
        <Button
          onClick={saveToBackend}
          disabled={isUploading}
          variant="ghost"
          className="w-full justify-start gap-2 h-8 py-0 px-3 cursor-pointer"
        >
          <FileCheck size={14} strokeWidth={2} />
          Save
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
