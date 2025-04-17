import "@excalidraw/excalidraw/index.css";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";
import * as React from "react";
import { useEffect, useRef, useState } from "react";

import {
  Dialog,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { useIsDarkTheme } from "~/components/theme/theme-provider";
import { Theme } from "@packages/types";
import { ErrorBoundary } from "next/dist/client/components/error-boundary";
import { Loader2 } from "lucide-react";

const Excalidraw = React.lazy(() =>
  import("@excalidraw/excalidraw").then((module) => ({
    default: module.Excalidraw,
  })),
);

export type ExcalidrawInitialElements = ExcalidrawInitialDataState["elements"];

type Props = {
  initialElements: ExcalidrawInitialElements;
  initialAppState: AppState;
  initialFiles: BinaryFiles;
  isShown?: boolean;
  onClose: () => void;
  onDelete: () => void;
  onSave: (
    elements: ExcalidrawInitialElements,
    appState: Partial<AppState>,
    files: BinaryFiles,
  ) => void;
};

export default function ExcalidrawModal({
  onSave,
  initialElements,
  initialAppState,
  initialFiles,
  isShown = false,
  onDelete,
  onClose,
}: Props) {
  const excaliDrawModelRef = useRef<HTMLDivElement | null>(null);
  const excalidrawApi = useRef<ExcalidrawImperativeAPI>(null);
  const isDarkTheme = useIsDarkTheme();
  const [discardModalOpen, setDiscardModalOpen] = useState(false);
  const [elements, setElements] =
    useState<ExcalidrawInitialElements>(initialElements);
  const [files, setFiles] = useState<BinaryFiles>(initialFiles);

  useEffect(() => {
    if (excaliDrawModelRef.current !== null) {
      excaliDrawModelRef.current.focus();
    }
  }, []);

  const save = () => {
    if (elements && elements.filter((el) => !el.isDeleted).length > 0) {
      const appState = excalidrawApi.current?.getAppState();
      const partialState: Partial<AppState> = {
        exportBackground: appState?.exportBackground,
        exportScale: appState?.exportScale,
        exportWithDarkMode: appState?.theme === Theme.DARK,
        isBindingEnabled: appState?.isBindingEnabled,
        isLoading: appState?.isLoading,
        name: appState?.name,
        theme: appState?.theme,
        viewBackgroundColor: appState?.viewBackgroundColor,
        viewModeEnabled: appState?.viewModeEnabled,
        zenModeEnabled: appState?.zenModeEnabled,
        zoom: appState?.zoom,
      };
      onSave(elements, partialState, files);
    } else {
      onDelete();
    }
  };

  const discard = () => {
    if (JSON.stringify(elements) === JSON.stringify(initialElements)) {
      onClose();
    } else {
      setDiscardModalOpen(true);
    }
  };

  const options = React.useMemo(
    () => ({
      initialData: {
        appState: {
          ...initialAppState,
          theme: isDarkTheme ? Theme.DARK : Theme.LIGHT,
          exportWithDarkMode: false,
          exportBackground: false,
        },
        elements: elements ?? [],
        files: files ?? {},
      },
      UIOptions: {
        canvasActions: {
          toggleTheme: false,
        },
      },
      onChange: (
        els: ExcalidrawInitialElements,
        _state: AppState,
        fls: BinaryFiles,
      ) => {
        setElements(els);
        setFiles(fls);
      },
    }),
    [initialAppState, elements, files, isDarkTheme],
  );

  // update theme on theme change
  useEffect(() => {
    excalidrawApi.current?.updateScene({
      appState: { theme: isDarkTheme ? Theme.DARK : Theme.LIGHT },
    });
  }, [isDarkTheme]);

  return (
    <Dialog open={isShown} onOpenChange={discard}>
      <DialogOverlay onClick={(e) => e.preventDefault()}>
        <DialogContent
          className="p-0 m-0 bg-transparent rounded-lg border-none shadow-none max-w-[100vw] max-h-[100vh] w-[90vw] h-[90vh] "
          onInteractOutside={(e) => {
            e.preventDefault();
            discard();
          }}
        >
          <div
            ref={excaliDrawModelRef}
            tabIndex={-1}
            className="relative flex justify-center rounded-lg items-center bg-card w-full h-full"
          >
            <DiscardDialog
              discardModalOpen={discardModalOpen}
              setDiscardModalOpen={setDiscardModalOpen}
              onDiscardConfirmed={() => {
                setElements(initialElements);
                setFiles(initialFiles);
                setDiscardModalOpen(false);
                onClose();
              }}
            />

            <ErrorBoundary
              errorComponent={({ error }) => (
                <div>Error loading Excalidraw: {error.message}</div>
              )}
            >
              <React.Suspense
                fallback={
                  <div className="w-full h-full flex justify-center items-center">
                    <Loader2 className="size-5 animate-spin" />
                  </div>
                }
              >
                <Excalidraw
                  {...options}
                  excalidrawAPI={(api) => {
                    excalidrawApi.current = api;
                  }}
                />
              </React.Suspense>
            </ErrorBoundary>

            <div className="absolute right-[5px] top-[-45px] z-10 text-end flex gap-2">
              <Button variant="destructive" onClick={discard}>
                Discard
              </Button>
              <Button variant="outline" onClick={save}>
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </DialogOverlay>
    </Dialog>
  );
}

const DiscardDialog = ({
  discardModalOpen,
  setDiscardModalOpen,
  onDiscardConfirmed,
}: {
  discardModalOpen: boolean;
  setDiscardModalOpen: (open: boolean) => void;
  onDiscardConfirmed: () => void;
}): React.JSX.Element => {
  return (
    <Dialog open={discardModalOpen} onOpenChange={setDiscardModalOpen}>
      <DialogOverlay onClick={(e) => e.preventDefault()}>
        <DialogContent className="z-[150]">
          <DialogHeader>
            <DialogTitle>Discard</DialogTitle>
          </DialogHeader>
          Are you sure you want to discard the changes?
          <div className="flex justify-between">
            <Button variant="destructive" onClick={onDiscardConfirmed}>
              Discard
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setDiscardModalOpen(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </DialogContent>
      </DialogOverlay>
    </Dialog>
  );
};
