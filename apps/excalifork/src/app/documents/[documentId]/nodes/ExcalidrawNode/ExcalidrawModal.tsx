import "./ExcalidrawModal.css";
import { Excalidraw } from "@excalidraw/excalidraw";
import {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types/types";
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

export const useCallbackRefState = () => {
  const [refValue, setRefValue] =
    React.useState<ExcalidrawImperativeAPI | null>(null);
  const refCallback = React.useCallback(
    (value: ExcalidrawImperativeAPI | null) => setRefValue(value),
    [],
  );
  return [refValue, refCallback] as const;
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
  const [excalidrawAPI, excalidrawAPIRefCallback] = useCallbackRefState();
  const [discardModalOpen, setDiscardModalOpen] = useState(false);
  const [elements, setElements] =
    useState<ExcalidrawInitialElements>(initialElements);
  const [files, setFiles] = useState<BinaryFiles>(initialFiles);

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
      const appState = excalidrawAPI?.getAppState();
      const partialState: Partial<AppState> = {
        exportBackground: appState?.exportBackground,
        exportScale: appState?.exportScale,
        exportWithDarkMode: appState?.theme === "dark",
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

  function ShowDiscardDialog(): JSX.Element {
    return (
      <Dialog open={discardModalOpen} onOpenChange={setDiscardModalOpen}>
        <DialogOverlay />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard</DialogTitle>
          </DialogHeader>
          Are you sure you want to discard the changes?
          <div className="ExcalidrawModal__discardModal">
            <Button
              onClick={() => {
                setDiscardModalOpen(false);
                onClose();
              }}
            >
              Discard
            </Button>
            <Button
              onClick={() => {
                setDiscardModalOpen(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (!isShown) {
    return null;
  }

  const onChange = (
    els: ExcalidrawInitialElements,
    _: AppState,
    fls: BinaryFiles,
  ) => {
    setElements(els);
    setFiles(fls);
  };

  return createPortal(
    <div className="ExcalidrawModal__overlay" role="dialog">
      <div
        className="ExcalidrawModal__modal"
        ref={excaliDrawModelRef}
        tabIndex={-1}
      >
        <div className="ExcalidrawModal__row">
          {discardModalOpen && <ShowDiscardDialog />}
          <Excalidraw
            onChange={onChange}
            excalidrawAPI={excalidrawAPIRefCallback}
            initialData={{
              appState: initialAppState || { isLoading: false },
              elements: initialElements,
              files: initialFiles,
            }}
          />
          <div className="ExcalidrawModal__actions">
            <button className="action-button" onClick={discard}>
              Discard
            </button>
            <button className="action-button" onClick={save}>
              Save
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
