"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { setLeaveGuard } from "~/lib/leave-guard";
import { useAutoSave } from "./use-auto-save";
import { leaveChoice } from "./leave-choice";
import { OpenEntityContext } from "./use-open-entity-sync";

type Ctx = {
  markDirty(): void;
  markPristine(): void;
  dirty: React.RefObject<boolean>;
};

const UnsavedCtx = createContext<Ctx | null>(null);
/**
 * Whether the editor holds edits not saved yet, for what says so; null where
 * nothing is saved, so there is nothing to say.
 */
const UnsavedStateCtx = createContext<boolean | null>(null);

/** What the app bar says about the open entity's edits. */
export type SaveStatus = "saved" | "saving" | "unsaved";

/** The question leaving puts, and how the user answers it. */
type Question = {
  savesHeld: boolean;
  answer(choice: "leave" | "save" | "stay"): void;
};

/**
 * Asks before the page leaves an editor with unsaved edits, or with a write
 * made elsewhere still waiting for an answer; see `lib/leave-guard.ts` for
 * the ways out it covers. Edits count as unsaved when the editor marked them
 * dirty or when the open entity holds edits the server does not store.
 *
 * `saveBeforeLeaving` is how this viewer's edits are saved on the way out,
 * answering whether the save landed; null when this viewer cannot save at all
 * (a reader, signed in or not), who is then told nothing about saving.
 */
export function UnsavedChangesProvider({
  children,
  saveBeforeLeaving,
}: {
  children: ReactNode;
  saveBeforeLeaving: (() => Promise<boolean>) | null;
}) {
  const dirty = useRef(false);
  const [unsaved, setUnsaved] = useState(false);
  const open = useContext(OpenEntityContext);
  const { enabled: autoSave } = useAutoSave();
  const [question, setQuestion] = useState<Question | null>(null);

  // What leaving reads when it happens: a registration made anew for each
  // would answer "stay" to a question it left open.
  const latest = useRef({ autoSave, saveBeforeLeaving });
  useEffect(() => {
    latest.current = { autoSave, saveBeforeLeaving };
  }, [autoSave, saveBeforeLeaving]);

  // External system: the app-wide leave guard.
  useEffect(() => {
    const choice = () =>
      leaveChoice({
        unsaved: dirty.current || (open?.sync.hasLocalEdits() ?? false),
        autoSave: latest.current.autoSave,
        savesHeld: open?.sync.holdsSaves() ?? false,
      });
    const save = () =>
      latest.current.saveBeforeLeaving?.() ?? Promise.resolve(true);
    return setLeaveGuard({
      mustAsk: () => choice() !== "leave",
      ask: async () => {
        const decided = choice();
        if (decided === "leave") return true;
        if (decided === "save" && latest.current.saveBeforeLeaving)
          return save();
        const savesHeld = open?.sync.holdsSaves() ?? false;
        const answered = await new Promise<"leave" | "save" | "stay">(
          (answer) => setQuestion({ savesHeld, answer }),
        );
        setQuestion(null);
        if (answered !== "save") return answered === "leave";
        // Saving is the user's answer to the write elsewhere: theirs go.
        if (savesHeld) open?.sync.keep();
        return save();
      },
    });
  }, [open]);

  const markDirty = useCallback(() => {
    dirty.current = true;
    setUnsaved(true);
  }, []);
  const markPristine = useCallback(() => {
    dirty.current = false;
    setUnsaved(false);
  }, []);

  const value = useMemo<Ctx>(
    () => ({ markDirty, markPristine, dirty }),
    [markDirty, markPristine],
  );

  return (
    <UnsavedCtx.Provider value={value}>
      <UnsavedStateCtx.Provider value={saveBeforeLeaving ? unsaved : null}>
        <Dialog
          open={question !== null}
          onOpenChange={(isOpen) => {
            if (!isOpen) question?.answer("stay");
          }}
        >
          <DialogContent size="sm">
            <DialogHeader>
              <DialogTitle>Unsaved changes</DialogTitle>
              <DialogDescription>
                {question?.savesHeld
                  ? "This changed elsewhere since you opened it, and your edits here are not saved. Saving them will overwrite the other changes. Leave anyway?"
                  : "You have unsaved changes. Leave anyway?"}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => question?.answer("stay")}>
                Stay
              </Button>
              <Button
                variant={
                  saveBeforeLeaving ? "destructive" : "destructive-confirm"
                }
                onClick={() => question?.answer("leave")}
              >
                Leave
              </Button>
              {saveBeforeLeaving && (
                <Button onClick={() => question?.answer("save")}>
                  Save and leave
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
        {children}
      </UnsavedStateCtx.Provider>
    </UnsavedCtx.Provider>
  );
}

export function useUnsavedChanges() {
  const ctx = useContext(UnsavedCtx);
  if (!ctx) {
    throw new Error("useUnsavedChanges must be inside UnsavedChangesProvider");
  }
  return ctx;
}

/**
 * "saving" while a save of the open entity is under way, "unsaved" while it
 * holds edits no save has taken yet, "saved" otherwise; null outside an
 * editor, or for a viewer who cannot save, where there is nothing to say.
 */
export function useSaveStatus(): SaveStatus | null {
  const unsaved = useContext(UnsavedStateCtx);
  const open = useContext(OpenEntityContext);
  const subscribe = useCallback(
    (listener: () => void) => open?.sync.subscribe(listener) ?? (() => {}),
    [open],
  );
  const saving = useSyncExternalStore(
    subscribe,
    () => open?.sync.isSaving() ?? false,
    () => false,
  );
  if (unsaved === null) return null;
  if (saving) return "saving";
  return unsaved ? "unsaved" : "saved";
}
