import { Excalidraw } from "@excalidraw/excalidraw";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";
import * as React from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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

export type ExcalidrawInitialElements = ExcalidrawInitialDataState["elements"];

type Props = {
  closeOnClickOutside?: boolean;
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
  closeOnClickOutside = false,
  onSave,
  initialElements,
  initialAppState,
  initialFiles,
  isShown = false,
  onDelete,
  onClose,
}: Props): React.ReactPortal | null {
  const excaliDrawModelRef = useRef<HTMLDivElement | null>(null);
  // excalidraw api
  const excalidrawApi = useRef<ExcalidrawImperativeAPI>(null);

  const isDarkTheme = useIsDarkTheme();

  const [discardModalOpen, setDiscardModalOpen] = useState(false);
  const [elements, setElements] =
    useState<ExcalidrawInitialElements>(initialElements);
  const [files, setFiles] = useState<BinaryFiles>(initialFiles);

  useEffect(() => {
    console.log("initialElements", initialElements);
    console.log("initialAppState", initialAppState);
    console.log("initialFiles", initialFiles);
  }, [initialElements, initialAppState, initialFiles]);

  useEffect(() => {
    if (excaliDrawModelRef.current !== null) {
      excaliDrawModelRef.current.focus();
    }
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        excaliDrawModelRef.current &&
        !excaliDrawModelRef.current.contains(event.target as Node) &&
        closeOnClickOutside
      ) {
        onDelete();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [closeOnClickOutside, onDelete]);

  useLayoutEffect(() => {
    const currentModalRef = excaliDrawModelRef.current;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onDelete();
      }
    };

    if (currentModalRef !== null) {
      currentModalRef.addEventListener("keydown", onKeyDown);
    }

    return () => {
      if (currentModalRef !== null) {
        currentModalRef.removeEventListener("keydown", onKeyDown);
      }
    };
  }, [onDelete]);

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
    if (elements && elements.filter((el) => !el.isDeleted).length === 0) {
      onDelete();
    } else {
      setDiscardModalOpen(true);
    }
  };

  function ShowDiscardDialog(): React.JSX.Element {
    return (
      <Dialog open={discardModalOpen} onOpenChange={setDiscardModalOpen}>
        <DialogOverlay>
          <DialogContent className="z-[150]">
            <DialogHeader>
              <DialogTitle>Discard</DialogTitle>
            </DialogHeader>
            Are you sure you want to discard the changes?
            <div className="flex justify-between">
              <Button
                variant="destructive"
                onClick={() => {
                  setDiscardModalOpen(false);
                  onClose();
                }}
              >
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
  }

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

  // Update theme on theme change
  useEffect(() => {
    excalidrawApi.current?.updateScene({
      appState: { theme: isDarkTheme ? Theme.DARK : Theme.LIGHT },
    });
  }, [isDarkTheme]);

  if (!isShown) {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 flex flex-col items-center z-[100] bg-background/60"
      role="dialog"
    >
      <div
        className="relative z-10 top-[50px] left-0 flex justify-center items-center rounded-lg bg-card"
        ref={excaliDrawModelRef}
        tabIndex={-1}
      >
        <div className="relative p-[40px_5px_5px] w-[70vw] h-[70vh] max-w-[1200px] max-h-[800px] rounded-lg shadow-[0_12px_28px_0_rgba(0,0,0,0.2),0_2px_4px_0_rgba(0,0,0,0.1),inset_0_0_0_1px_rgba(255,255,255,0.5)] border border-border">
          {discardModalOpen && <ShowDiscardDialog />}
          <Excalidraw
            {...options}
            excalidrawAPI={(api) => {
              excalidrawApi.current = api;
              console.log("excalidraw api set");
            }}
          />
          <div className="absolute right-[5px] top-[5px] z-10 text-end flex gap-2">
            <Button variant="outline" onClick={discard}>
              Discard
            </Button>
            <Button variant="outline" onClick={save}>
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
