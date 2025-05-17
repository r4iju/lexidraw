import "@excalidraw/excalidraw/index.css";
import { createPortal } from "react-dom";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";
import React, {
  Suspense,
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";

import {
  Dialog,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { useIsDarkTheme } from "~/components/theme/theme-provider";
import { Theme } from "@packages/types";
import { ErrorBoundary } from "next/dist/client/components/error-boundary";
import { Loader2 } from "lucide-react";
import { Excalidraw, MainMenu } from "@excalidraw/excalidraw";
import { DrawingBoardMenu } from "./ExcalidrawMenu";
export type ExcalidrawInitialElements = ExcalidrawInitialDataState["elements"];

type Props = {
  /** Scene elements when the editor opens */
  initialElements: ExcalidrawInitialElements;
  /** App‑level state to seed Excalidraw with */
  initialAppState: AppState;
  /** Binary files belonging to the scene */
  initialFiles: BinaryFiles;
  /** Whether the editor should be shown.  If false nothing is rendered. */
  isShown?: boolean;
  /** Called when the user explicitly finishes the session (save or discard). */
  onClose: () => void;
  /** Called when the user discards an *empty* drawing (nothing to save). */
  onDelete: () => void;
  /** Persist the scene.  Invoked on *Save*. */
  onSave: (
    elements: ExcalidrawInitialElements,
    appState: Partial<AppState>,
    files: BinaryFiles,
  ) => void;
};

/**
 * Inline Excalidraw editor.
 *
 * Renders full‑width/height inside the parent container.  A tiny confirmation
 * dialog (\<Dialog/>) is only used when the user clicks *Discard* – it offers
 * *Cancel*, *Discard* and *Save*.
 */
export default function ExcalidrawInlineEditor({
  onSave,
  initialElements,
  initialAppState,
  initialFiles,
  isShown = false,
  onDelete,
  onClose,
}: Props) {
  // ────────────────────────────────────────────────────────────────────────────
  // refs & state
  // ────────────────────────────────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const isDarkTheme = useIsDarkTheme();
  const [confirmOpen, setConfirmOpen] = useState(false);

  // ────────────────────────────────────────────────────────────────────────────
  // helpers
  // ────────────────────────────────────────────────────────────────────────────
  const buildPartialAppState = (state?: AppState): Partial<AppState> => ({
    exportBackground: state?.exportBackground,
    exportScale: state?.exportScale,
    exportWithDarkMode: state?.theme === Theme.DARK,
    isBindingEnabled: state?.isBindingEnabled,
    isLoading: state?.isLoading,
    name: state?.name,
    theme: state?.theme,
    viewBackgroundColor: state?.viewBackgroundColor,
    viewModeEnabled: state?.viewModeEnabled,
    zenModeEnabled: state?.zenModeEnabled,
    zoom: state?.zoom,
  });

  const save = useCallback(() => {
    if (!apiRef.current) return;

    const els = apiRef.current.getSceneElements();
    const fls = apiRef.current.getFiles();

    // If everything is deleted treat it like discard
    if (!els || els.filter((e) => !e.isDeleted).length === 0) {
      onDelete();
      onClose();
      return;
    }

    const partialState = buildPartialAppState(apiRef.current.getAppState());
    onSave(els, partialState, fls ?? {});
    onClose();
  }, [onSave, onDelete, onClose]);

  const saveAndClose = () => {
    save();
    onClose();
  };

  const closeDiscardConfirm = () => setConfirmOpen(false);

  const handleDiscardConfirmed = () => {
    closeDiscardConfirm();
    onClose();
  };

  // ────────────────────────────────────────────────────────────────────────────
  // Excalidraw options (memoised)
  // ────────────────────────────────────────────────────────────────────────────
  const options = useMemo(
    () => ({
      initialData: {
        appState: {
          ...initialAppState,
          zenModeEnabled: true,
          openMenu: null,
          theme: isDarkTheme ? Theme.DARK : Theme.LIGHT,
          exportWithDarkMode: false,
          exportBackground: false,
        },
        elements: initialElements ?? [],
        files: initialFiles ?? {},
      },
      UIOptions: {
        canvasActions: {
          toggleTheme: false,
        },
      },
    }),
    [initialAppState, initialElements, initialFiles, isDarkTheme],
  );

  // Update theme live
  useEffect(() => {
    if (apiRef.current && isShown) {
      apiRef.current.updateScene({
        appState: { theme: isDarkTheme ? Theme.DARK : Theme.LIGHT },
      });
    }
  }, [isDarkTheme, isShown]);

  const BODY_LOCK = "overflow-hidden";
  useEffect(() => {
    if (isShown) {
      document.documentElement.classList.add(BODY_LOCK);
      return () => document.documentElement.classList.remove(BODY_LOCK);
    }
  }, [isShown]);

  // ────────────────────────────────────────────────────────────────────────────
  // Mount guard
  // ────────────────────────────────────────────────────────────────────────────
  if (!isShown) return null;

  // ────────────────────────────────────────────────────────────────────────────
  // render
  // ────────────────────────────────────────────────────────────────────────────
  return createPortal(
    <div className="fixed inset-0 z-[120] bg-background">
      {/* inline container */}
      <div
        ref={containerRef}
        className="relative size-full bg-background overflow-hidden"
      >
        <ErrorBoundary
          errorComponent={({ error }) => (
            <div className="flex items-center justify-center size-full">
              Error loading Excalidraw: {error.message}
            </div>
          )}
        >
          <Suspense
            fallback={
              <div className="size-full flex justify-center items-center">
                <Loader2 className="size-5 animate-spin" />
              </div>
            }
          >
            <Excalidraw
              {...options}
              excalidrawAPI={(api) => {
                apiRef.current = api;
              }}
            >
              <MainMenu>
                <DrawingBoardMenu
                  excalidrawApi={
                    apiRef as React.RefObject<ExcalidrawImperativeAPI>
                  }
                  onSaveAndClose={saveAndClose}
                  onSave={save}
                  onDiscard={handleDiscardConfirmed}
                />
              </MainMenu>
            </Excalidraw>
          </Suspense>
        </ErrorBoundary>
      </div>

      {/* discard confirmation dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogOverlay>
          <DialogContent aria-describedby="discard-dialog-description">
            <DialogHeader>
              <DialogTitle>Discard changes?</DialogTitle>
            </DialogHeader>
            <DialogDescription id="discard-dialog-description">
              Your drawing has unsaved changes. What would you like to do?
            </DialogDescription>
            <div className="flex justify-between mt-6">
              <Button onClick={closeDiscardConfirm}>Cancel</Button>
              <div className="space-x-2">
                <Button variant="destructive" onClick={handleDiscardConfirmed}>
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
    </div>,
    document.body,
  );
}
