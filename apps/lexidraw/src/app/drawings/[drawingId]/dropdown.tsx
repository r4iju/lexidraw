import {
  MainMenu,
  exportToSvg,
  loadFromBlob,
  exportToBlob,
} from "@excalidraw/excalidraw";
import { Button } from "~/components/ui/button";
import Link from "next/link";
import type {
  AppState,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types/types";
import { RefObject } from "react";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/types/element/types";
import { api } from "~/trpc/react";
import { RouterOutputs } from "~/trpc/shared";
import { useIsDarkTheme } from "~/components/theme/theme-provider";
import { Theme } from "@packages/types";
import { useToast } from "~/components/ui/use-toast";
import {
  DownloadIcon,
  FileCheck,
  FolderIcon,
  ImageDownIcon,
  LayoutDashboardIcon,
  RotateCcwIcon,
} from "lucide-react";

type Props = {
  isMenuOpen: boolean;
  drawing: RouterOutputs["entities"]["load"];
  excalidrawApi: RefObject<ExcalidrawImperativeAPI>;
};

const DrawingBoardMenu = ({ drawing, excalidrawApi }: Props) => {
  const isDarkTheme = useIsDarkTheme();
  const { toast } = useToast();
  const { mutate: save } = api.entities.save.useMutation();
  const { mutate: saveSvg } = api.snapshot.create.useMutation();

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
          toast({
            title: "Saved!",
          });
          await exportDrawingAsSvg({ elements: elements, appState });
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

  type ExportAsSvgProps = {
    elements: readonly ExcalidrawElement[];
    appState: AppState;
  };

  const exportDrawingAsSvg = async ({
    elements,
    appState,
  }: ExportAsSvgProps) => {
    await Promise.all(
      [Theme.DARK, Theme.LIGHT].map(async (theme) => {
        const svg = await exportToSvg({
          elements,
          appState: {
            ...appState,
            theme: theme,
            exportWithDarkMode: theme === Theme.DARK ? true : false,
          },
          files: null,
          exportPadding: 10,
          renderEmbeddables: true,
          exportingFrame: null,
        });

        // convert it to string
        const svgString = new XMLSerializer().serializeToString(svg);
        saveSvg({
          entityId: drawing.id,
          svg: svgString,
          theme: theme,
        });
      }),
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
  };

  const handleExportAsPng = async () => {
    if (!excalidrawApi.current) return;
    const blob = await exportToBlob({
      elements: excalidrawApi.current.getSceneElements(),
      appState: excalidrawApi.current.getAppState(),
      files: null,
      // quality: 100,
      mimeType: "image/png",
      getDimensions(width, height) {
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
  };

  const handleExportAsSvg = async () => {
    if (!excalidrawApi.current) return;
    const svg = await exportToSvg({
      elements: excalidrawApi.current.getSceneElements(),
      appState: excalidrawApi.current.getAppState(),
      files: null,
      exportPadding: 10,
      renderEmbeddables: true,
      exportingFrame: null,
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
  };

  const handleReset = () => {
    if (!excalidrawApi.current) return;
    excalidrawApi.current.updateScene({
      elements: [],
      appState: {
        ...excalidrawApi.current.getAppState(),
      },
    });
  };

  return (
    <>
      <MainMenu.ItemCustom
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
          <Link
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
          </Link>
        </Button>
      </MainMenu.ItemCustom>
      <MainMenu.ItemCustom
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
      </MainMenu.ItemCustom>
      <MainMenu.ItemCustom
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
      </MainMenu.ItemCustom>
      {/* <MainMenu.DefaultItems.LoadScene /> */}
      <MainMenu.ItemCustom
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
      </MainMenu.ItemCustom>
      {/* <MainMenu.DefaultItems.Export /> */}
      <MainMenu.ItemCustom
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
      </MainMenu.ItemCustom>
      <MainMenu.ItemCustom
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
      </MainMenu.ItemCustom>
      {/* <MainMenu.DefaultItems.SaveAsImage /> */}
      <MainMenu.ItemCustom
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
      </MainMenu.ItemCustom>
      {/* <MainMenu.DefaultItems.ClearCanvas /> */}
    </>
  );
};

export default DrawingBoardMenu;
