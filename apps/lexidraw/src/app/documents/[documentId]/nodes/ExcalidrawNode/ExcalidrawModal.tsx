import "@excalidraw/excalidraw/index.css";
import { createPortal } from "react-dom";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";
import { Suspense, useEffect, useRef, useState, useCallback } from "react";

import { Button } from "~/components/ui/button";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { useIsDarkTheme } from "~/components/theme/theme-provider";
import { Theme } from "@packages/types";
import { ErrorBoundary } from "next/dist/client/components/error-boundary";
import { Loader2 } from "lucide-react";
import { Excalidraw } from "@excalidraw/excalidraw";
import { useSyncedExcalidraw } from "~/app/drawings/[drawingId]/use-synced-excalidraw";
import { useFitOnOpen } from "~/app/drawings/[drawingId]/use-fit-on-open";
import { useDocumentTitle } from "../../context/document-title-context";
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
 * Whether Escape is Excalidraw's: it finishes a shape or text, puts the tool
 * down, and closes its own menus and dialogs. A selection it keeps.
 */
function escapeIsExcalidraws(state: AppState): boolean {
  return (
    state.openMenu !== null ||
    state.openSidebar !== null ||
    state.editingLinearElement !== null ||
    state.openDialog !== null ||
    state.openPopup !== null ||
    state.editingTextElement !== null ||
    state.newElement !== null ||
    state.multiElement !== null ||
    state.activeTool.type !== "selection"
  );
}

/**
 * The drawing editor a document opens over one of its drawings, full screen.
 * Leaving without saving asks first when there is anything to lose.
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
  const [excalidraw, setExcalidraw] = useState<ExcalidrawImperativeAPI | null>(
    null,
  );
  const isDarkTheme = useIsDarkTheme();
  const documentTitle = useDocumentTitle();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { needsSave } = useSyncedExcalidraw(excalidraw);
  const changed = useRef(false);
  useFitOnOpen(excalidraw);

  const buildPartialAppState = useCallback(
    (state?: AppState): Partial<AppState> => ({
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
    }),
    [],
  );

  const saveAndClose = () => {
    if (excalidraw) {
      onSave(
        excalidraw.getSceneElements(),
        buildPartialAppState(excalidraw.getAppState()),
        excalidraw.getFiles() ?? {},
      );
    }
    onClose();
  };

  const discard = useCallback(() => {
    // A drawing left empty is no drawing: the node goes with it.
    if (!excalidraw?.getSceneElements().some((element) => !element.isDeleted))
      onDelete();
    onClose();
  }, [excalidraw, onClose, onDelete]);

  const leave = useCallback(() => {
    if (changed.current) setConfirmOpen(true);
    else discard();
  }, [discard]);

  // External system: the keyboard, before Excalidraw acts on Escape.
  useEffect(() => {
    if (!isShown || !excalidraw || confirmOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const state = excalidraw.getAppState();
      if (escapeIsExcalidraws(state)) return;
      event.preventDefault();
      event.stopPropagation();
      // A step back at a time: first out of the selection, then out of here.
      if (Object.keys(state.selectedElementIds).length > 0)
        excalidraw.updateScene({
          appState: { selectedElementIds: {}, selectedGroupIds: {} },
        });
      else leave();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [isShown, excalidraw, confirmOpen, leave]);

  const BODY_LOCK = "overflow-hidden";
  useEffect(() => {
    if (isShown) {
      document.documentElement.classList.add(BODY_LOCK);
      return () => document.documentElement.classList.remove(BODY_LOCK);
    }
  }, [isShown]);

  if (!isShown) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex flex-col bg-background"
      data-component-name="DrawingEditor"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card pl-[max(--spacing(4),env(safe-area-inset-left))] pr-[max(--spacing(4),env(safe-area-inset-right))]">
        <h2 className="min-w-0 flex-1 truncate text-sm">
          <span className="text-muted-foreground">Drawing in </span>
          <span className="font-medium">{documentTitle || "Untitled"}</span>
        </h2>
        <Button variant="ghost" size="sm" onClick={leave}>
          Cancel
        </Button>
        <Button size="sm" onClick={saveAndClose}>
          Save &amp; close
        </Button>
      </header>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <ErrorBoundary
          errorComponent={({ error }) => (
            <div className="flex items-center justify-center size-full">
              Error loading Excalidraw:{" "}
              {error instanceof Error ? error.message : String(error)}
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
            <div className="absolute inset-0">
              <Excalidraw
                initialData={{
                  appState: {
                    ...initialAppState,
                    openMenu: null,
                    exportWithDarkMode: false,
                    exportBackground: false,
                  },
                  elements: initialElements ?? [],
                  files: initialFiles ?? {},
                }}
                theme={isDarkTheme ? Theme.DARK : Theme.LIGHT}
                UIOptions={{
                  canvasActions: {
                    toggleTheme: false,
                    loadScene: false,
                    clearCanvas: false,
                    saveToActiveFile: false,
                  },
                }}
                onChange={(elements, state) => {
                  changed.current = needsSave(elements, state);
                }}
                excalidrawAPI={setExcalidraw}
              >
                <DrawingBoardMenu excalidrawApi={excalidraw} />
              </Excalidraw>
            </div>
          </Suspense>
        </ErrorBoundary>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        className="z-[130]"
        title="Discard changes?"
        description="This drawing has changes that aren't saved to the document."
        confirmLabel="Discard"
        onConfirm={discard}
      />
    </div>,
    document.body,
  );
}
