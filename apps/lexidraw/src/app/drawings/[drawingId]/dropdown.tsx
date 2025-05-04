"use client";

import { Button } from "~/components/ui/button";
import type {
  AppState,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import { RefObject } from "react";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { api } from "~/trpc/react";
import { RouterOutputs } from "~/trpc/shared";
import { useIsDarkTheme } from "~/components/theme/theme-provider";
import { Theme } from "@packages/types";
import { useToast } from "~/components/ui/toast-provider";
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

type Props = {
  drawing: RouterOutputs["entities"]["load"];
  excalidrawApi: RefObject<ExcalidrawImperativeAPI>;
};

export const DrawingBoardMenu = ({ drawing, excalidrawApi }: Props) => {
  const isDarkTheme = useIsDarkTheme();
  const { toast } = useToast();
  const { mutate: save } = api.entities.save.useMutation();
  const { mutate: generateUploadUrls } =
    api.snapshot.generateUploadUrls.useMutation();
  const { markPristine } = useUnsavedChanges();

  const CustomMenuItem = MainMenu.ItemCustom;

  const uploadToS3 = async ({
    uploadUrl,
    file: blob,
  }: {
    uploadUrl: string;
    file: Blob;
  }) => {
    try {
      await fetch(uploadUrl, {
        method: "PUT",
        body: blob, // File object from input
        headers: {
          "Content-Type": blob.type,
        },
      });
    } catch (error) {
      console.error("Error uploading to S3", error);
    }
  };

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
          toast({
            title: "Saved!",
          });
          await exportDrawingAsSvg();
        },
        onError: (err) => {
          toast({
            title: "Something went wrong!",
            description: err.message,
            variant: "destructive",
          });
        },
      },
    );
  };

  const exportDrawingAsSvg = async () => {
    generateUploadUrls(
      {
        entityId: drawing.id,
        contentType: "image/svg+xml",
      },
      {
        onSuccess: async (uploadParams) => {
          const promises: Promise<void>[] = [];
          for (const param of uploadParams) {
            const svg = await exportToSvg({
              elements: excalidrawApi.current.getSceneElements(),
              appState: {
                ...excalidrawApi.current.getAppState(),
                theme: param.theme,
                exportWithDarkMode: param.theme === Theme.DARK ? true : false,
                exportBackground: true,
              },
              files: null,
              exportPadding: 10,
            });

            const svgString = new XMLSerializer().serializeToString(svg);
            const blob = new Blob([svgString], { type: "image/svg+xml" });
            promises.push(
              uploadToS3({
                uploadUrl: param.signedUploadUrl,
                file: blob,
              }),
            );
          }
          await Promise.all(promises);
          closeMenu();
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
        toast({
          title: "Invalid file",
          description: "Please upload a valid Excalidraw file",
          variant: "destructive",
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
